import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateQuizDto, CreateQuestionDto } from './dto/create-quiz.dto';
import { UpdateQuizDto } from './dto/update-quiz.dto';

// Full quiz graph. `author` is restricted to non-sensitive fields (never email / passwordHash).
const QUIZ_INCLUDE = {
  questions: {
    include: { options: true },
    orderBy: { orderIndex: 'asc' },
  },
  author: { select: { id: true, name: true } },
} satisfies Prisma.QuizInclude;

// Up to 100 questions x 4 options are re-created on update: Prisma's 5 s interactive default is too tight.
const UPDATE_TRANSACTION_TIMEOUT_MS = 15_000;

type OptionRecord = { id: string; text: string; isCorrect: boolean; colorIndex: number };
type QuizGraph = { shareToken: string | null; questions: Array<{ options: OptionRecord[] }> };

@Injectable()
export class QuizService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateQuizDto) {
    return this.prisma.quiz.create({
      data: {
        title: dto.title,
        description: dto.description,
        authorId: userId,
        questions: { create: dto.questions.map((q, index) => this.toQuestionCreateInput(q, index)) },
      },
      include: QUIZ_INCLUDE,
    });
  }

  // Always scoped to the caller: there is no "list another user's quizzes" use case (IDOR fix, T-010 S3).
  async findAll(userId: string) {
    return this.prisma.quiz.findMany({
      where: { authorId: userId },
      include: QUIZ_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Owner: full quiz (with isCorrect). Non-owner: public quizzes only, answers stripped.
   * A private quiz of someone else is reported as not found so its existence is not revealed.
   */
  async findOne(id: string, userId: string) {
    const quiz = await this.prisma.quiz.findUnique({ where: { id }, include: QUIZ_INCLUDE });

    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }
    if (quiz.authorId === userId) {
      return quiz;
    }
    if (quiz.isPublic) {
      return this.toPublicView(quiz);
    }
    throw new NotFoundException('Quiz not found');
  }

  /**
   * Ownership check, question replacement and quiz update run in ONE transaction:
   * a failure anywhere leaves the quiz untouched. Questions are replaced only when provided.
   */
  async update(userId: string, id: string, dto: UpdateQuizDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertOwner(tx, userId, id, 'You can only update your own quizzes');

      // Absent (or null) questions = keep the existing ones; a partial update must never wipe content.
      const questions = dto.questions ?? null;
      if (questions) {
        await tx.question.deleteMany({ where: { quizId: id } });
      }

      return tx.quiz.update({
        where: { id },
        data: {
          // `title: null` passes the partial DTO (@IsOptional) but the column is NOT NULL: treat as absent.
          title: dto.title ?? undefined,
          description: dto.description,
          ...(questions
            ? { questions: { create: questions.map((q, index) => this.toQuestionCreateInput(q, index)) } }
            : {}),
        },
        include: QUIZ_INCLUDE,
      });
    }, { timeout: UPDATE_TRANSACTION_TIMEOUT_MS });
  }

  async delete(userId: string, id: string) {
    await this.assertOwner(this.prisma, userId, id, 'You can only delete your own quizzes');
    await this.prisma.quiz.delete({ where: { id } });
    return { message: 'Quiz deleted successfully' };
  }

  /**
   * Unauthenticated endpoint: public quizzes only. A private quiz is reported as not found, so access
   * cannot bypass ownership or survive a share-link revocation (ADR 0001 section 5).
   */
  async getQuizForGame(id: string) {
    const quiz = await this.prisma.quiz.findUnique({ where: { id }, include: QUIZ_INCLUDE });

    if (!quiz || !quiz.isPublic) {
      throw new NotFoundException('Quiz not found');
    }

    return this.toPublicView(quiz);
  }

  // ========== SHARE FUNCTIONALITY ==========
  async togglePublic(userId: string, id: string) {
    const quiz = await this.assertOwner(this.prisma, userId, id, 'You can only update your own quizzes');

    return this.prisma.quiz.update({
      where: { id },
      data: { isPublic: !quiz.isPublic },
      include: QUIZ_INCLUDE,
    });
  }

  async generateShareToken(userId: string, id: string) {
    await this.assertOwner(this.prisma, userId, id, 'You can only share your own quizzes');

    return this.prisma.quiz.update({
      where: { id },
      data: { shareToken: this.generateShareTokenValue() },
      include: QUIZ_INCLUDE,
    });
  }

  async revokeShareToken(userId: string, id: string) {
    await this.assertOwner(this.prisma, userId, id, 'You can only update your own quizzes');

    return this.prisma.quiz.update({
      where: { id },
      data: { shareToken: null },
      include: QUIZ_INCLUDE,
    });
  }

  async getQuizByShareToken(shareToken: string) {
    const quiz = await this.prisma.quiz.findUnique({ where: { shareToken }, include: QUIZ_INCLUDE });

    if (!quiz) {
      throw new NotFoundException('Quiz not found or share link expired');
    }

    return this.toPublicView(quiz);
  }

  async findPublic() {
    const quizzes = await this.prisma.quiz.findMany({
      where: { isPublic: true },
      include: QUIZ_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return quizzes.map((quiz) => this.toPublicView(quiz));
  }

  /**
   * Internal ownership lookup. Deliberately NOT based on findOne(): the non-owner view of findOne()
   * is stripped / hidden, which must not leak into authorization decisions.
   */
  private async assertOwner(client: Prisma.TransactionClient, userId: string, id: string, forbiddenMessage: string) {
    const quiz = await client.quiz.findUnique({
      where: { id },
      select: { id: true, authorId: true, isPublic: true },
    });

    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }
    if (quiz.authorId !== userId) {
      throw new ForbiddenException(forbiddenMessage);
    }
    return quiz;
  }

  /**
   * View served to anyone who is not the owner (public list, non-owner GET, share link, game).
   * Drops `isCorrect` from every option and `shareToken` (a leaked token would keep granting
   * access after the owner makes the quiz private).
   */
  private toPublicView<T extends QuizGraph>(quiz: T) {
    const { shareToken: _omitted, questions, ...rest } = quiz;
    return {
      ...rest,
      questions: questions.map(({ options, ...question }) => ({
        ...question,
        options: options.map(({ id, text, colorIndex }) => ({ id, text, colorIndex })),
      })),
    };
  }

  private toQuestionCreateInput(q: CreateQuestionDto, index: number) {
    return {
      text: q.text,
      imageUrl: q.imageUrl,
      timeLimit: q.timeLimit ?? 20,
      pointsMultiplier: q.pointsMultiplier ?? 1.0,
      orderIndex: index,
      options: {
        create: q.options.map((o) => ({
          text: o.text,
          isCorrect: o.isCorrect,
          colorIndex: o.colorIndex,
        })),
      },
    };
  }

  private generateShareTokenValue(): string {
    // Generate a URL-safe token: 24 chars = ~144 bits of entropy
    const array = new Uint8Array(18);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(36).padStart(2, '0')).join('').substring(0, 24);
  }
}
