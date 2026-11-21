import { GUARDS_METADATA } from '@nestjs/common/constants';
import { QuizController } from './quiz.controller';
import { QuizService } from './quiz.service';
import { QuizImportService } from './quiz-import.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('QuizController', () => {
  const quizService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
  };
  const quizImportService = { preview: jest.fn() };
  const controller = new QuizController(
    quizService as unknown as QuizService,
    quizImportService as unknown as QuizImportService,
  );

  beforeEach(() => jest.clearAllMocks());

  describe('GET /quizzes', () => {
    it("lists the caller's quizzes and ignores any authorId query parameter (IDOR)", async () => {
      quizService.findAll.mockResolvedValue([]);
      const req = { user: { sub: 'user-123' }, query: { authorId: 'victim-456' } };

      await controller.findAll(req);

      expect(quizService.findAll).toHaveBeenCalledWith('user-123');
      expect(quizService.findAll).not.toHaveBeenCalledWith('victim-456');
    });
  });

  describe('GET /quizzes/:id', () => {
    it('requires a JWT', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, QuizController.prototype.findOne);
      expect(guards).toContain(JwtAuthGuard);
    });

    it('passes the caller id to the service for the owner / public / private decision', async () => {
      quizService.findOne.mockResolvedValue({});

      await controller.findOne({ user: { sub: 'user-123' } }, 'quiz-1');

      expect(quizService.findOne).toHaveBeenCalledWith('quiz-1', 'user-123');
    });
  });
});
