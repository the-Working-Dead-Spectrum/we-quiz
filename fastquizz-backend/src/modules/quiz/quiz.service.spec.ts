import { Test, TestingModule } from '@nestjs/testing';
import { QuizService } from './quiz.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

// Fails if any answer flag or sensitive author field appears anywhere in the payload.
function expectNoSecrets(payload: unknown) {
  const json = JSON.stringify(payload);
  expect(json).not.toContain('"isCorrect"');
  expect(json).not.toContain('"email"');
  expect(json).not.toContain('"passwordHash"');
  expect(json).not.toContain('"shareToken"');
}

describe('QuizService', () => {
  let service: QuizService;
  let prisma: any;

  const ownerId = 'user-123';
  const otherUserId = 'user-999';

  const mockQuiz = {
    id: 'quiz-123',
    title: 'Test Quiz',
    description: 'Test Description',
    isPublic: false,
    shareToken: null as string | null,
    authorId: ownerId,
    createdAt: new Date(),
    updatedAt: new Date(),
    questions: [] as any[],
    author: { id: ownerId, name: 'TestUser' },
  };

  const mockQuizWithQuestions = {
    ...mockQuiz,
    shareToken: 'secret-share-token-000000',
    questions: [
      {
        id: 'q1',
        text: 'Question 1',
        imageUrl: null,
        timeLimit: 30,
        pointsMultiplier: 1,
        orderIndex: 0,
        quizId: 'quiz-123',
        options: [
          { id: 'o1', text: 'Option A', isCorrect: true, colorIndex: 0, questionId: 'q1' },
          { id: 'o2', text: 'Option B', isCorrect: false, colorIndex: 1, questionId: 'q1' },
          { id: 'o3', text: 'Option C', isCorrect: false, colorIndex: 2, questionId: 'q1' },
          { id: 'o4', text: 'Option D', isCorrect: false, colorIndex: 3, questionId: 'q1' },
        ],
      },
    ],
  };

  const ownershipRow = (overrides: Partial<{ authorId: string; isPublic: boolean }> = {}) => ({
    id: mockQuiz.id,
    authorId: ownerId,
    isPublic: false,
    ...overrides,
  });

  beforeEach(async () => {
    const mockPrisma: any = {
      quiz: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      question: {
        deleteMany: jest.fn(),
      },
    };
    // Interactive transaction: run the callback with the same mock acting as the tx client.
    mockPrisma.$transaction = jest.fn((callback: (tx: unknown) => unknown) => callback(mockPrisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [QuizService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<QuizService>(QuizService);
    prisma = module.get(PrismaService);

    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create quiz with questions and options for the caller', async () => {
      prisma.quiz.create.mockResolvedValue(mockQuizWithQuestions);

      const result = await service.create(ownerId, {
        title: 'Test Quiz',
        description: 'Test Description',
        questions: [
          {
            text: 'Question 1',
            timeLimit: 30,
            pointsMultiplier: 1,
            options: [
              { text: 'Option A', isCorrect: true, colorIndex: 0 },
              { text: 'Option B', isCorrect: false, colorIndex: 1 },
            ],
          },
        ],
      });

      const args = prisma.quiz.create.mock.calls[0][0];
      expect(args.data.authorId).toBe(ownerId);
      expect(args.data.questions.create[0]).toMatchObject({ text: 'Question 1', orderIndex: 0, timeLimit: 30 });
      expect(args.data.questions.create[0].options.create).toHaveLength(2);
      expect(result).toEqual(mockQuizWithQuestions);
    });
  });

  describe('findAll', () => {
    it('should always filter by the given user id', async () => {
      prisma.quiz.findMany.mockResolvedValue([mockQuiz]);

      const result = await service.findAll(ownerId);

      expect(prisma.quiz.findMany).toHaveBeenCalledWith({
        where: { authorId: ownerId },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([mockQuiz]);
    });
  });

  describe('findOne', () => {
    it('owner gets the full quiz, including isCorrect', async () => {
      prisma.quiz.findUnique.mockResolvedValue(mockQuizWithQuestions);

      const result = await service.findOne(mockQuiz.id, ownerId);

      expect(prisma.quiz.findUnique).toHaveBeenCalledWith({ where: { id: mockQuiz.id }, include: expect.any(Object) });
      expect(result).toEqual(mockQuizWithQuestions);
      expect(result.questions[0].options[0]).toHaveProperty('isCorrect', true);
    });

    it('non-owner gets a public quiz without isCorrect nor shareToken', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ ...mockQuizWithQuestions, isPublic: true });

      const result = await service.findOne(mockQuiz.id, otherUserId);

      expectNoSecrets(result);
      expect(result.questions[0].options).toEqual([
        { id: 'o1', text: 'Option A', colorIndex: 0 },
        { id: 'o2', text: 'Option B', colorIndex: 1 },
        { id: 'o3', text: 'Option C', colorIndex: 2 },
        { id: 'o4', text: 'Option D', colorIndex: 3 },
      ]);
      expect(result.title).toBe('Test Quiz');
    });

    it('non-owner gets 404 for a private quiz (existence not revealed)', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ ...mockQuizWithQuestions, isPublic: false });

      await expect(service.findOne(mockQuiz.id, otherUserId)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for non-existent quiz', async () => {
      prisma.quiz.findUnique.mockResolvedValue(null);

      await expect(service.findOne('non-existent', ownerId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const questionsDto = [
      {
        text: 'Updated Question',
        timeLimit: 20,
        pointsMultiplier: 1.5,
        options: [
          { text: 'Option A', isCorrect: true, colorIndex: 0 },
          { text: 'Option B', isCorrect: false, colorIndex: 1 },
        ],
      },
    ];

    it('replaces questions and updates the quiz inside one transaction for the owner', async () => {
      prisma.quiz.findUnique.mockResolvedValue(ownershipRow());
      prisma.question.deleteMany.mockResolvedValue({ count: 1 });
      prisma.quiz.update.mockResolvedValue(mockQuizWithQuestions);

      const result = await service.update(ownerId, mockQuiz.id, { title: 'Updated Quiz', questions: questionsDto });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Ownership lookup uses a narrow select, not the stripped findOne() view.
      expect(prisma.quiz.findUnique).toHaveBeenCalledWith({
        where: { id: mockQuiz.id },
        select: { id: true, authorId: true, isPublic: true },
      });
      expect(prisma.question.deleteMany).toHaveBeenCalledWith({ where: { quizId: mockQuiz.id } });
      const updateArgs = prisma.quiz.update.mock.calls[0][0];
      expect(updateArgs.data.title).toBe('Updated Quiz');
      expect(updateArgs.data.questions.create).toHaveLength(1);
      expect(updateArgs.data.questions.create[0].options.create).toHaveLength(2);
      // deleteMany must run before the re-creation.
      expect(prisma.question.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.quiz.update.mock.invocationCallOrder[0],
      );
      expect(result).toEqual(mockQuizWithQuestions);
    });

    it('keeps existing questions when the payload has no questions', async () => {
      prisma.quiz.findUnique.mockResolvedValue(ownershipRow());
      prisma.quiz.update.mockResolvedValue(mockQuizWithQuestions);

      await service.update(ownerId, mockQuiz.id, { title: 'Only the title' });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.question.deleteMany).not.toHaveBeenCalled();
      const updateArgs = prisma.quiz.update.mock.calls[0][0];
      expect(updateArgs.data).not.toHaveProperty('questions');
      expect(updateArgs.data.title).toBe('Only the title');
    });

    it('treats title: null as absent (NOT NULL column, no Prisma 500)', async () => {
      prisma.quiz.findUnique.mockResolvedValue(ownershipRow());
      prisma.quiz.update.mockResolvedValue(mockQuizWithQuestions);

      await service.update(ownerId, mockQuiz.id, { title: null as unknown as string });

      expect(prisma.quiz.update.mock.calls[0][0].data.title).toBeUndefined();
    });

    it('owner can update a private quiz (ownership check is not affected by the public view)', async () => {
      prisma.quiz.findUnique.mockResolvedValue(ownershipRow({ isPublic: false }));
      prisma.quiz.update.mockResolvedValue(mockQuizWithQuestions);

      await expect(service.update(ownerId, mockQuiz.id, { title: 'x' })).resolves.toBeDefined();
    });

    it('throws ForbiddenException for non-owner and writes nothing', async () => {
      prisma.quiz.findUnique.mockResolvedValue(ownershipRow());

      await expect(service.update(otherUserId, mockQuiz.id, { questions: questionsDto })).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.question.deleteMany).not.toHaveBeenCalled();
      expect(prisma.quiz.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a missing quiz', async () => {
      prisma.quiz.findUnique.mockResolvedValue(null);

      await expect(service.update(ownerId, 'missing', { title: 'x' })).rejects.toThrow(NotFoundException);
      expect(prisma.quiz.update).not.toHaveBeenCalled();
    });

    it('propagates a failure from the transaction (no partial success reported)', async () => {
      prisma.quiz.findUnique.mockResolvedValue(ownershipRow());
      prisma.question.deleteMany.mockResolvedValue({ count: 1 });
      prisma.quiz.update.mockRejectedValue(new Error('db down'));

      await expect(service.update(ownerId, mockQuiz.id, { questions: questionsDto })).rejects.toThrow('db down');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('delete', () => {
    it('should delete quiz for owner', async () => {
      prisma.quiz.findUnique.mockResolvedValue(ownershipRow());
      prisma.quiz.delete.mockResolvedValue(mockQuiz);

      await service.delete(ownerId, mockQuiz.id);

      expect(prisma.quiz.delete).toHaveBeenCalledWith({ where: { id: mockQuiz.id } });
    });

    it('should throw ForbiddenException for non-owner', async () => {
      prisma.quiz.findUnique.mockResolvedValue(ownershipRow());

      await expect(service.delete(otherUserId, mockQuiz.id)).rejects.toThrow(ForbiddenException);
      expect(prisma.quiz.delete).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for a missing quiz', async () => {
      prisma.quiz.findUnique.mockResolvedValue(null);

      await expect(service.delete(ownerId, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('togglePublic', () => {
    it('should toggle public status for owner', async () => {
      const publicQuiz = { ...mockQuiz, isPublic: true };
      prisma.quiz.findUnique.mockResolvedValue(ownershipRow({ isPublic: false }));
      prisma.quiz.update.mockResolvedValue(publicQuiz);

      const result = await service.togglePublic(ownerId, mockQuiz.id);

      expect(prisma.quiz.update).toHaveBeenCalledWith({
        where: { id: mockQuiz.id },
        data: { isPublic: true },
        include: expect.any(Object),
      });
      expect(result).toEqual(publicQuiz);
    });

    it('should throw ForbiddenException for non-owner', async () => {
      prisma.quiz.findUnique.mockResolvedValue(ownershipRow());

      await expect(service.togglePublic(otherUserId, mockQuiz.id)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('generateShareToken', () => {
    it('should generate and save a 24-char share token for owner', async () => {
      prisma.quiz.findUnique.mockResolvedValue(ownershipRow());
      prisma.quiz.update.mockImplementation((args: any) => Promise.resolve({ ...mockQuiz, ...args.data }));

      const result = await service.generateShareToken(ownerId, mockQuiz.id);

      expect(prisma.quiz.update).toHaveBeenCalled();
      expect(result.shareToken).toHaveLength(24);
    });

    it('should throw ForbiddenException for non-owner', async () => {
      prisma.quiz.findUnique.mockResolvedValue(ownershipRow());

      await expect(service.generateShareToken(otherUserId, mockQuiz.id)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('revokeShareToken', () => {
    it('should revoke share token for owner', async () => {
      prisma.quiz.findUnique.mockResolvedValue(ownershipRow());
      prisma.quiz.update.mockResolvedValue({ ...mockQuiz, shareToken: null });

      const result = await service.revokeShareToken(ownerId, mockQuiz.id);

      expect(prisma.quiz.update).toHaveBeenCalledWith({
        where: { id: mockQuiz.id },
        data: { shareToken: null },
        include: expect.any(Object),
      });
      expect(result.shareToken).toBeNull();
    });

    it('should throw ForbiddenException for non-owner', async () => {
      prisma.quiz.findUnique.mockResolvedValue(ownershipRow());

      await expect(service.revokeShareToken(otherUserId, mockQuiz.id)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getQuizByShareToken', () => {
    it('should return the quiz without answers for a valid share token', async () => {
      prisma.quiz.findUnique.mockResolvedValue(mockQuizWithQuestions);

      const result = await service.getQuizByShareToken('secret-share-token-000000');

      expect(prisma.quiz.findUnique).toHaveBeenCalledWith({
        where: { shareToken: 'secret-share-token-000000' },
        include: expect.any(Object),
      });
      expectNoSecrets(result);
      expect(result.questions[0].options).toHaveLength(4);
    });

    it('should throw NotFoundException for invalid token', async () => {
      prisma.quiz.findUnique.mockResolvedValue(null);

      await expect(service.getQuizByShareToken('invalid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getQuizForGame', () => {
    it('should return a public quiz without isCorrect', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ ...mockQuizWithQuestions, isPublic: true });

      const result = await service.getQuizForGame(mockQuiz.id);

      expectNoSecrets(result);
      expect(result.questions[0].options[0]).toEqual({ id: 'o1', text: 'Option A', colorIndex: 0 });
    });

    it('should throw NotFoundException for a private quiz (even one with a share token)', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ ...mockQuizWithQuestions, isPublic: false });

      await expect(service.getQuizForGame(mockQuiz.id)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for a missing quiz', async () => {
      prisma.quiz.findUnique.mockResolvedValue(null);

      await expect(service.getQuizForGame('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findPublic', () => {
    it('should return public quizzes without answers and with a restricted author', async () => {
      prisma.quiz.findMany.mockResolvedValue([{ ...mockQuizWithQuestions, isPublic: true }]);

      const result = await service.findPublic();

      expect(prisma.quiz.findMany).toHaveBeenCalledWith({
        where: { isPublic: true },
        include: expect.objectContaining({ author: { select: { id: true, name: true } } }),
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(1);
      expectNoSecrets(result);
      expect(result[0].questions[0].options).toHaveLength(4);
    });
  });
});
