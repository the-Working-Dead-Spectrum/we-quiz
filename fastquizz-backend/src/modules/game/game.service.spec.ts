import { Test, TestingModule } from '@nestjs/testing';
import { GameService } from './game.service';
import { GameRedisService, GameState, PlayerData } from '../../common/redis/game-redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RoomService } from './room.service';
import { GameIdentifierService } from './game-identifier.service';
import { GameError } from './game-errors';

describe('GameService', () => {
  let service: GameService;
  let redis: any;
  let prisma: any;
  let roomService: any;
  let identifiers: any;

  const HOST_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  const playableQuestion = (id: string) => ({
    id,
    text: id,
    imageUrl: null,
    timeLimit: 20,
    pointsMultiplier: 1,
    orderIndex: 0,
    options: [
      { id: `${id}-a`, text: 'A', isCorrect: true, colorIndex: 0 },
      { id: `${id}-b`, text: 'B', isCorrect: false, colorIndex: 1 },
    ],
  });

  const mockQuiz = {
    id: 'quiz-123',
    title: 'Test Quiz',
    authorId: 'author-1',
    isPublic: false,
    shareToken: 'share-token-abc',
    questions: [playableQuestion('q1'), playableQuestion('q2')],
  };

  const mockGameState: GameState = {
    status: 'LOBBY',
    currentQuestionIndex: -1,
    questionStartTime: 0,
    quizId: 'quiz-123',
    quizTitle: 'Test Quiz',
    questionCount: 2,
    hostId: 'host-123',
    roomId: null,
    maxPlayers: 500,
    startedAt: null,
  };

  const mockPlayers: PlayerData[] = [
    { id: 'p1', nickname: 'Player1', score: 100, streak: 2, correctAnswersCount: 5, connected: true, joinedAt: 1 },
    { id: 'p2', nickname: 'Player2', score: 50, streak: 1, correctAnswersCount: 3, connected: true, joinedAt: 2 },
  ];

  beforeEach(async () => {
    const mockRedis = {
      createGameState: jest.fn().mockResolvedValue(undefined),
      getGameState: jest.fn(),
      getPlayerCount: jest.fn(),
      getAllPlayers: jest.fn(),
      getHostToken: jest.fn(),
      deleteGame: jest.fn().mockResolvedValue(undefined),
    };

    const mockPrisma = {
      quiz: { findUnique: jest.fn() },
      question: { findFirst: jest.fn() },
      gameSession: {
        create: jest.fn().mockResolvedValue({ id: 'session-1' }),
        update: jest.fn().mockReturnValue('session-update-op'),
      },
      room: { updateMany: jest.fn().mockReturnValue('room-update-op') },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameService,
        { provide: GameRedisService, useValue: mockRedis },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: RoomService,
          useValue: { createRoom: jest.fn(), abandonRoom: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: GameIdentifierService, useValue: { allocateNumericPin: jest.fn().mockResolvedValue('123456') } },
      ],
    }).compile();

    service = module.get<GameService>(GameService);
    redis = module.get(GameRedisService);
    prisma = module.get(PrismaService);
    roomService = module.get(RoomService);
    identifiers = module.get(GameIdentifierService);
  });

  describe('createAnonymousGame (WS host:create_game)', () => {
    it('creates a game for a public quiz: Redis state with host token, GameSession with null host', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ ...mockQuiz, isPublic: true });

      const result = await service.createAnonymousGame('quiz-123');

      expect(identifiers.allocateNumericPin).toHaveBeenCalled();
      expect(result).toEqual({
        pin: '123456',
        quizTitle: 'Test Quiz',
        questionCount: 2,
        hostToken: expect.stringMatching(HOST_TOKEN_PATTERN),
      });
      expect(redis.createGameState).toHaveBeenCalledWith('123456', {
        quizId: 'quiz-123',
        quizTitle: 'Test Quiz',
        questionCount: 2,
        hostId: null,
        roomId: null,
        maxPlayers: 500,
        hostToken: result.hostToken,
      });
      expect(prisma.gameSession.create).toHaveBeenCalledWith({
        data: { quizId: 'quiz-123', hostId: null, pin: '123456', status: 'LOBBY', roomId: null },
      });
    });

    it('accepts a private quiz with the matching share token', async () => {
      prisma.quiz.findUnique.mockResolvedValue(mockQuiz);

      await expect(service.createAnonymousGame('quiz-123', 'share-token-abc')).resolves.toHaveProperty('pin', '123456');
    });

    it.each([
      ['no share token', undefined],
      ['a wrong share token', 'share-token-xyz'],
    ])('rejects a private quiz with %s as QUIZ_NOT_FOUND', async (_label, shareToken) => {
      prisma.quiz.findUnique.mockResolvedValue(mockQuiz);

      await expect(service.createAnonymousGame('quiz-123', shareToken)).rejects.toMatchObject({ code: 'QUIZ_NOT_FOUND' });
      expect(redis.createGameState).not.toHaveBeenCalled();
    });

    it('rejects a missing quiz as QUIZ_NOT_FOUND', async () => {
      prisma.quiz.findUnique.mockResolvedValue(null);
      await expect(service.createAnonymousGame('missing')).rejects.toMatchObject({ code: 'QUIZ_NOT_FOUND' });
    });

    it('rejects an unplayable quiz as QUIZ_INVALID', async () => {
      const broken = playableQuestion('q3');
      broken.options[1].isCorrect = true; // two correct options
      prisma.quiz.findUnique.mockResolvedValue({ ...mockQuiz, isPublic: true, questions: [broken] });

      const error = await service.createAnonymousGame('quiz-123').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(GameError);
      expect((error as GameError).code).toBe('QUIZ_INVALID');
      expect(redis.createGameState).not.toHaveBeenCalled();
    });

    it('rolls back the Redis state when the GameSession cannot be created', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ ...mockQuiz, isPublic: true });
      prisma.gameSession.create.mockRejectedValue(new Error('db down'));

      await expect(service.createAnonymousGame('quiz-123')).rejects.toThrow('db down');
      expect(redis.deleteGame).toHaveBeenCalledWith('123456');
    });
  });

  describe('createRoomGame (REST POST /api/games)', () => {
    it('uses the room code as pin and stores roomId, maxPlayers and the host user id', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ ...mockQuiz, authorId: 'user-1' });
      roomService.createRoom.mockResolvedValue({ id: 'room-1', code: 'AB3XYZ', maxPlayers: 50 });

      const result = await service.createRoomGame('user-1', 'quiz-123');

      expect(result.pin).toBe('AB3XYZ');
      expect(roomService.createRoom).toHaveBeenCalledWith({ quizId: 'quiz-123', hostId: 'user-1' });
      expect(redis.createGameState).toHaveBeenCalledWith(
        'AB3XYZ',
        expect.objectContaining({ hostId: 'user-1', roomId: 'room-1', maxPlayers: 50 }),
      );
      expect(prisma.gameSession.create).toHaveBeenCalledWith({
        data: { quizId: 'quiz-123', hostId: 'user-1', pin: 'AB3XYZ', status: 'LOBBY', roomId: 'room-1' },
      });
    });

    it('rejects a private quiz of another user as QUIZ_NOT_FOUND', async () => {
      prisma.quiz.findUnique.mockResolvedValue(mockQuiz);

      await expect(service.createRoomGame('user-1', 'quiz-123')).rejects.toMatchObject({ code: 'QUIZ_NOT_FOUND' });
      expect(roomService.createRoom).not.toHaveBeenCalled();
    });

    it('accepts a public quiz of another user', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ ...mockQuiz, isPublic: true });
      roomService.createRoom.mockResolvedValue({ id: 'room-1', code: 'AB3XYZ', maxPlayers: 500 });

      await expect(service.createRoomGame('user-1', 'quiz-123')).resolves.toHaveProperty('pin', 'AB3XYZ');
    });

    it('abandons the room when the game cannot be created', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ ...mockQuiz, authorId: 'user-1' });
      roomService.createRoom.mockResolvedValue({ id: 'room-1', code: 'AB3XYZ', maxPlayers: 500 });
      redis.createGameState.mockRejectedValue(new Error('redis down'));

      await expect(service.createRoomGame('user-1', 'quiz-123')).rejects.toThrow('redis down');
      expect(roomService.abandonRoom).toHaveBeenCalledWith('AB3XYZ');
    });
  });

  describe('verifyHostToken', () => {
    const token = '0f8fad5b-d9cb-469f-a165-70867728950e';

    it('accepts the right token', async () => {
      redis.getHostToken.mockResolvedValue(token);
      await expect(service.verifyHostToken('123456', token)).resolves.toBeUndefined();
    });

    it('rejects a wrong token with HOST_UNAUTHORIZED', async () => {
      redis.getHostToken.mockResolvedValue(token);
      await expect(service.verifyHostToken('123456', '7c9e6679-7425-40de-944b-e07fc1f90ae7')).rejects.toMatchObject({
        code: 'HOST_UNAUTHORIZED',
      });
    });

    it('rejects a token of a different length with HOST_UNAUTHORIZED (no timingSafeEqual crash)', async () => {
      redis.getHostToken.mockResolvedValue(token);
      await expect(service.verifyHostToken('123456', 'short')).rejects.toMatchObject({ code: 'HOST_UNAUTHORIZED' });
    });

    it('rejects any token when the game has no stored token (unknown / expired game)', async () => {
      redis.getHostToken.mockResolvedValue(null);
      await expect(service.verifyHostToken('123456', token)).rejects.toMatchObject({ code: 'HOST_UNAUTHORIZED' });
    });
  });

  describe('getQuestion', () => {
    it('reads the question at the given position, ordered by orderIndex', async () => {
      prisma.question.findFirst.mockResolvedValue(playableQuestion('q2'));

      await service.getQuestion('quiz-123', 1);

      expect(prisma.question.findFirst).toHaveBeenCalledWith({
        where: { quizId: 'quiz-123' },
        orderBy: { orderIndex: 'asc' },
        skip: 1,
        include: { options: true },
      });
    });
  });

  describe('persistence', () => {
    it('markGameStarted updates the session and moves the room to IN_PROGRESS', async () => {
      await service.markGameStarted('AB3XYZ', { ...mockGameState, roomId: 'room-1', startedAt: 1000 });

      expect(prisma.gameSession.update).toHaveBeenCalledWith({
        where: { pin: 'AB3XYZ' },
        data: { status: 'QUESTION_ACTIVE', startedAt: new Date(1000) },
      });
      expect(prisma.room.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-1', status: 'LOBBY' },
        data: { status: 'IN_PROGRESS', startedAt: new Date(1000) },
      });
      expect(prisma.$transaction).toHaveBeenCalledWith(['session-update-op', 'room-update-op']);
    });

    it('finalizeGame ends the session with one PlayerResult per player (anonymous game, no room)', async () => {
      const leaderboard = [
        { playerId: 'p1', nickname: 'Player1', score: 100, rank: 1, correctAnswersCount: 5 },
        { playerId: 'p2', nickname: 'Player2', score: 50, rank: 2, correctAnswersCount: 3 },
      ];

      await service.finalizeGame('123456', { ...mockGameState, hostId: null, startedAt: 1000 }, leaderboard);

      expect(prisma.gameSession.update).toHaveBeenCalledWith({
        where: { pin: '123456' },
        data: expect.objectContaining({
          status: 'ENDED',
          startedAt: new Date(1000),
          endedAt: expect.any(Date),
          results: {
            create: [
              { userId: null, nickname: 'Player1', finalScore: 100, rank: 1, correctAnswersCount: 5 },
              { userId: null, nickname: 'Player2', finalScore: 50, rank: 2, correctAnswersCount: 3 },
            ],
          },
        }),
      });
      expect(prisma.room.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledWith(['session-update-op']);
    });

    it('finalizeGame moves the room to ENDED for a room game', async () => {
      await service.finalizeGame('AB3XYZ', { ...mockGameState, roomId: 'room-1' }, []);

      expect(prisma.room.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { status: 'ENDED', endedAt: expect.any(Date) },
      });
    });
  });

  describe('read-only helpers', () => {
    it('getGameState returns the Redis state', async () => {
      redis.getGameState.mockResolvedValue(mockGameState);
      expect(await service.getGameState('123456')).toEqual(mockGameState);
    });

    it('getPlayers returns the Redis players', async () => {
      redis.getAllPlayers.mockResolvedValue(mockPlayers);
      expect(await service.getPlayers('123456')).toEqual(mockPlayers);
    });
  });

  describe('startGame (legacy REST pre-check)', () => {
    it('validates host can start game in lobby with players', async () => {
      redis.getGameState.mockResolvedValue(mockGameState);
      redis.getPlayerCount.mockResolvedValue(1);
      await expect(service.startGame('host-123', '123456')).resolves.toBeUndefined();
    });

    it('throws if game not in lobby', async () => {
      redis.getGameState.mockResolvedValue({ ...mockGameState, status: 'QUESTION_ACTIVE', currentQuestionIndex: 0 });
      await expect(service.startGame('host-123', '123456')).rejects.toThrow('INVALID_STATE');
    });

    it('throws if no players', async () => {
      redis.getGameState.mockResolvedValue(mockGameState);
      redis.getPlayerCount.mockResolvedValue(0);
      await expect(service.startGame('host-123', '123456')).rejects.toThrow('NO_PLAYERS');
    });

    it('throws if not host', async () => {
      redis.getGameState.mockResolvedValue({ ...mockGameState, hostId: 'other-host' });
      await expect(service.startGame('host-123', '123456')).rejects.toThrow('UNAUTHORIZED');
    });
  });
});
