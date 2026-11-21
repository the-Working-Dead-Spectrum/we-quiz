import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { setupTestApp, teardownTestApp, getPrisma } from './setup';

describe('Quiz CRUD (e2e)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    app = await setupTestApp();
    prisma = getPrisma();
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
    await prisma.quiz.deleteMany();

    // Create user and get token
    const registerResponse = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'password123',
        nickname: 'TestUser',
      });
    accessToken = registerResponse.body.accessToken;
    userId = registerResponse.body.user.id;
  });

  describe('POST /api/quiz', () => {
    it('should create quiz with questions', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/quiz')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Test Quiz',
          description: 'Test Description',
          questions: [
            {
              text: 'What is 2+2?',
              timeLimit: 30,
              pointsMultiplier: 1,
              options: [
                { text: '3', isCorrect: false, colorIndex: 0 },
                { text: '4', isCorrect: true, colorIndex: 1 },
                { text: '5', isCorrect: false, colorIndex: 2 },
                { text: '6', isCorrect: false, colorIndex: 3 },
              ],
            },
          ],
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.title).toBe('Test Quiz');
      expect(response.body.questions).toHaveLength(1);
      expect(response.body.questions[0].options).toHaveLength(4);
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/quiz')
        .send({ title: 'Test' })
        .expect(401);
    });

    it('should validate required fields', async () => {
      await request(app.getHttpServer())
        .post('/api/quiz')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: '' })
        .expect(400);
    });

    it('should validate question options (exactly 4, one correct)', async () => {
      await request(app.getHttpServer())
        .post('/api/quiz')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Test Quiz',
          questions: [
            {
              text: 'Question?',
              timeLimit: 30,
              pointsMultiplier: 1,
              options: [
                { text: 'A', isCorrect: true, colorIndex: 0 },
                { text: 'B', isCorrect: true, colorIndex: 1 }, // Two correct - invalid
                { text: 'C', isCorrect: false, colorIndex: 2 },
                { text: 'D', isCorrect: false, colorIndex: 3 },
              ],
            },
          ],
        })
        .expect(400);
    });
  });

  describe('GET /api/quiz', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/api/quiz')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Quiz 1',
          questions: [{ text: 'Q1?', timeLimit: 30, pointsMultiplier: 1, options: [{ text: 'A', isCorrect: true, colorIndex: 0 }, { text: 'B', isCorrect: false, colorIndex: 1 }, { text: 'C', isCorrect: false, colorIndex: 2 }, { text: 'D', isCorrect: false, colorIndex: 3 }] }],
        });
      await request(app.getHttpServer())
        .post('/api/quiz')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Quiz 2',
          questions: [{ text: 'Q1?', timeLimit: 30, pointsMultiplier: 1, options: [{ text: 'A', isCorrect: true, colorIndex: 0 }, { text: 'B', isCorrect: false, colorIndex: 1 }, { text: 'C', isCorrect: false, colorIndex: 2 }, { text: 'D', isCorrect: false, colorIndex: 3 }] }],
        });
    });

    it('should return user quizzes', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/quiz')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0].title).toBe('Quiz 2'); // Most recent first
    });
  });

  describe('GET /api/quiz/:id', () => {
    let quizId: string;

    beforeEach(async () => {
      const response = await request(app.getHttpServer())
        .post('/api/quiz')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Test Quiz',
          questions: [{ text: 'Q1?', timeLimit: 30, pointsMultiplier: 1, options: [{ text: 'A', isCorrect: true, colorIndex: 0 }, { text: 'B', isCorrect: false, colorIndex: 1 }, { text: 'C', isCorrect: false, colorIndex: 2 }, { text: 'D', isCorrect: false, colorIndex: 3 }] }],
        });
      quizId = response.body.id;
    });

    it('should return quiz with questions for owner', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/quiz/${quizId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(quizId);
      expect(response.body.questions).toHaveLength(1);
      expect(response.body.questions[0].options).toHaveLength(4);
    });

    it('should return 404 for non-existent quiz', async () => {
      await request(app.getHttpServer())
        .get('/api/quiz/non-existent')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });

    it('should return 403 for other user quiz', async () => {
      // Create another user
      const otherRegister = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email: 'other@example.com', password: 'password123', nickname: 'OtherUser' });
      const otherToken = otherRegister.body.accessToken;

      await request(app.getHttpServer())
        .get(`/api/quiz/${quizId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);
    });
  });

  describe('PATCH /api/quiz/:id', () => {
    let quizId: string;

    beforeEach(async () => {
      const response = await request(app.getHttpServer())
        .post('/api/quiz')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Original Title',
          questions: [{ text: 'Q1?', timeLimit: 30, pointsMultiplier: 1, options: [{ text: 'A', isCorrect: true, colorIndex: 0 }, { text: 'B', isCorrect: false, colorIndex: 1 }, { text: 'C', isCorrect: false, colorIndex: 2 }, { text: 'D', isCorrect: false, colorIndex: 3 }] }],
        });
      quizId = response.body.id;
    });

    it('should update quiz', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/quiz/${quizId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Updated Title',
          description: 'Updated Description',
        })
        .expect(200);

      expect(response.body.title).toBe('Updated Title');
      expect(response.body.description).toBe('Updated Description');
    });
  });

  describe('DELETE /api/quiz/:id', () => {
    let quizId: string;

    beforeEach(async () => {
      const response = await request(app.getHttpServer())
        .post('/api/quiz')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'To Delete',
          questions: [{ text: 'Q1?', timeLimit: 30, pointsMultiplier: 1, options: [{ text: 'A', isCorrect: true, colorIndex: 0 }, { text: 'B', isCorrect: false, colorIndex: 1 }, { text: 'C', isCorrect: false, colorIndex: 2 }, { text: 'D', isCorrect: false, colorIndex: 3 }] }],
        });
      quizId = response.body.id;
    });

    it('should delete quiz for owner', async () => {
      await request(app.getHttpServer())
        .delete(`/api/quiz/${quizId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/quiz/${quizId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });

  describe('Share functionality', () => {
    let quizId: string;

    beforeEach(async () => {
      const response = await request(app.getHttpServer())
        .post('/api/quiz')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Shareable Quiz',
          questions: [{ text: 'Q1?', timeLimit: 30, pointsMultiplier: 1, options: [{ text: 'A', isCorrect: true, colorIndex: 0 }, { text: 'B', isCorrect: false, colorIndex: 1 }, { text: 'C', isCorrect: false, colorIndex: 2 }, { text: 'D', isCorrect: false, colorIndex: 3 }] }],
        });
      quizId = response.body.id;
    });

    it('should toggle public status', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/quiz/${quizId}/public`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.isPublic).toBe(true);

      const response2 = await request(app.getHttpServer())
        .patch(`/api/quiz/${quizId}/public`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response2.body.isPublic).toBe(false);
    });

    it('should generate share token', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/quiz/${quizId}/share`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.shareToken).toBeDefined();
      expect(response.body.shareToken).toHaveLength(24);
    });

    it('should revoke share token', async () => {
      await request(app.getHttpServer())
        .post(`/api/quiz/${quizId}/share`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const response = await request(app.getHttpServer())
        .delete(`/api/quiz/${quizId}/share`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.shareToken).toBeNull();
    });

    it('should get quiz by share token (no auth required)', async () => {
      await request(app.getHttpServer())
        .post(`/api/quiz/${quizId}/share`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const quizResponse = await request(app.getHttpServer())
        .get(`/api/quiz/share/${quizId}`)
        .expect(200);

      expect(quizResponse.body.title).toBe('Shareable Quiz');
    });
  });
});