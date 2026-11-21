import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestApp, teardownTestApp, getPrisma } from './setup';

/**
 * REST e2e for `POST /api/games` (ADR 0001 section 10).
 * Requires a real PostgreSQL + Redis (see README "Testing").
 */
describe('Game REST Endpoints (e2e)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let accessToken: string;
  let quizId: string;

  const playableQuestions = [
    {
      text: 'Q1?',
      timeLimit: 30,
      pointsMultiplier: 1,
      options: [
        { text: 'A', isCorrect: true, colorIndex: 0 },
        { text: 'B', isCorrect: false, colorIndex: 1 },
        { text: 'C', isCorrect: false, colorIndex: 2 },
        { text: 'D', isCorrect: false, colorIndex: 3 },
      ],
    },
    {
      text: 'Q2?',
      timeLimit: 20,
      pointsMultiplier: 1.5,
      options: [
        { text: 'A', isCorrect: false, colorIndex: 0 },
        { text: 'B', isCorrect: true, colorIndex: 1 },
      ],
    },
  ];

  beforeAll(async () => {
    app = await setupTestApp();
    prisma = getPrisma();
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  beforeEach(async () => {
    await prisma.gameSession.deleteMany();
    await prisma.room.deleteMany();
    await prisma.quiz.deleteMany();
    await prisma.user.deleteMany();

    const registerResponse = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'password123', name: 'TestUser' });
    accessToken = registerResponse.body.token;

    const quizResponse = await request(app.getHttpServer())
      .post('/api/quizzes')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Game Quiz', questions: playableQuestions });
    quizId = quizResponse.body.id;
  });

  describe('POST /api/games', () => {
    it('creates a room game whose pin equals the room code and returns a host token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/games')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ quizId })
        .expect(201);

      expect(response.body).toEqual({
        roomCode: expect.stringMatching(/^[A-HJ-NP-Z2-9]{6}$/),
        pin: response.body.roomCode,
        quizTitle: 'Game Quiz',
        questionCount: 2,
        hostToken: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });

      const session = await prisma.gameSession.findUnique({ where: { pin: response.body.pin } });
      expect(session).toMatchObject({ status: 'LOBBY', quizId });
      expect(session?.roomId).toBeTruthy();
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).post('/api/games').send({ quizId }).expect(401);
    });

    it('returns 400 for a malformed quizId or an extra field', async () => {
      await request(app.getHttpServer())
        .post('/api/games')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ quizId: 'not-a-uuid' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/games')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ quizId, hostId: randomUUID() })
        .expect(400);
    });

    it('returns 404 for a non-existent quiz', async () => {
      await request(app.getHttpServer())
        .post('/api/games')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ quizId: randomUUID() })
        .expect(404);
    });
  });

  describe('GET /api/games/:code/players', () => {
    it('returns an empty player list for a new game', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/games')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ quizId })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/api/games/${created.body.pin}/players`)
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });
});
