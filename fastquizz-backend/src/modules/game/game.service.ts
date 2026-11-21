import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GameStatus as PrismaGameStatus, RoomStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GameRedisService, GameState, PlayerData } from '../../common/redis/game-redis.service';
import { safeEqual } from '../../common/security/safe-equal';
import { RoomService } from './room.service';
import { GameIdentifierService } from './game-identifier.service';
import { GameError } from './game-errors';
import { DEFAULT_MAX_PLAYERS, isPlayableQuiz, MIN_PLAYERS_TO_START } from './game-rules';
import { LeaderboardEntry } from './dto/game-events.dto';

export interface GameOption {
  id: string;
  text: string;
  isCorrect: boolean;
  colorIndex: number;
}

export interface GameQuestion {
  id: string;
  text: string;
  imageUrl: string | null;
  timeLimit: number; // seconds
  pointsMultiplier: number;
  options: GameOption[];
}

interface HostableQuiz {
  id: string;
  title: string;
  authorId: string;
  isPublic: boolean;
  shareToken: string | null;
  questions: GameQuestion[];
}

export interface CreatedGame {
  pin: string;
  quizTitle: string;
  questionCount: number;
  hostToken: string;
}

interface CreateGameInput {
  quiz: HostableQuiz;
  pin: string;
  hostUserId: string | null;
  roomId: string | null;
  maxPlayers: number;
}

@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: GameRedisService,
    private readonly roomService: RoomService,
    private readonly identifiers: GameIdentifierService,
  ) {}

  // ========== GAME CREATION (single path, ADR 0001 sections 2, 3, 8, 10) ==========

  /**
   * WS `host:create_game` (anonymous host): quiz must be public or `shareToken` must match.
   * Throws GameError QUIZ_NOT_FOUND / QUIZ_INVALID.
   */
  async createAnonymousGame(quizId: string, shareToken?: string): Promise<CreatedGame> {
    const quiz = await this.loadPlayableQuiz(
      quizId,
      (q) => q.isPublic || (!!shareToken && !!q.shareToken && safeEqual(shareToken, q.shareToken)),
    );
    const pin = await this.identifiers.allocateNumericPin();
    return this.createGame({ quiz, pin, hostUserId: null, roomId: null, maxPlayers: DEFAULT_MAX_PLAYERS });
  }

  /**
   * REST `POST /api/games` (authenticated host): quiz must belong to the caller or be public.
   * The Room code is the game pin. Throws GameError QUIZ_NOT_FOUND / QUIZ_INVALID.
   */
  async createRoomGame(userId: string, quizId: string): Promise<CreatedGame> {
    const quiz = await this.loadPlayableQuiz(quizId, (q) => q.authorId === userId || q.isPublic);
    const room = await this.roomService.createRoom({ quizId: quiz.id, hostId: userId });
    try {
      return await this.createGame({
        quiz,
        pin: room.code,
        hostUserId: userId,
        roomId: room.id,
        maxPlayers: room.maxPlayers,
      });
    } catch (error) {
      await this.roomService.abandonRoom(room.code).catch((rollbackError: unknown) =>
        this.logger.error(`Failed to abandon room ${room.code} after a creation failure`, describe(rollbackError)),
      );
      throw error;
    }
  }

  /** Writes the Redis state (incl. hostToken, maxPlayers, roomId) and the GameSession row (status LOBBY). */
  private async createGame(input: CreateGameInput): Promise<CreatedGame> {
    const { quiz, pin } = input;
    const hostToken = randomUUID();

    await this.redis.createGameState(pin, {
      quizId: quiz.id,
      quizTitle: quiz.title,
      questionCount: quiz.questions.length,
      hostId: input.hostUserId,
      roomId: input.roomId,
      maxPlayers: input.maxPlayers,
      hostToken,
    });

    try {
      await this.prisma.gameSession.create({
        data: {
          quizId: quiz.id,
          hostId: input.hostUserId,
          pin,
          status: PrismaGameStatus.LOBBY,
          roomId: input.roomId,
        },
      });
    } catch (error) {
      await this.redis.deleteGame(pin).catch((rollbackError: unknown) =>
        this.logger.error(`Failed to roll back Redis state of game ${pin}`, describe(rollbackError)),
      );
      throw error;
    }

    this.logger.log(`Game ${pin} created (${input.roomId ? 'room' : 'anonymous'} host)`);
    return { pin, quizTitle: quiz.title, questionCount: quiz.questions.length, hostToken };
  }

  private async loadPlayableQuiz(quizId: string, canHost: (quiz: HostableQuiz) => boolean): Promise<HostableQuiz> {
    const quiz: HostableQuiz | null = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        questions: {
          include: { options: true },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    // Same error whether the quiz does not exist or is not accessible: existence is not revealed.
    if (!quiz || !canHost(quiz)) {
      throw new GameError('QUIZ_NOT_FOUND', 'Quiz not found');
    }
    if (!isPlayableQuiz(quiz)) {
      throw new GameError(
        'QUIZ_INVALID',
        'Quiz is not playable: it needs at least one question, each with 2 to 4 options, exactly one correct answer and distinct colors',
      );
    }
    return quiz;
  }

  // ========== HOST AUTHORIZATION (ADR 0001 section 3) ==========

  /** Throws HOST_UNAUTHORIZED if the token is unknown (no game / expired) or does not match. */
  async verifyHostToken(pin: string, hostToken: string): Promise<void> {
    const stored = await this.redis.getHostToken(pin);
    if (!stored || !safeEqual(stored, hostToken)) {
      throw new GameError('HOST_UNAUTHORIZED', 'Invalid host token for this game');
    }
  }

  // ========== QUESTIONS ==========

  /** Question at position `index` (0-based, by orderIndex) with its options, or null if none. */
  async getQuestion(quizId: string, index: number): Promise<GameQuestion | null> {
    return this.prisma.question.findFirst({
      where: { quizId },
      orderBy: { orderIndex: 'asc' },
      skip: index,
      include: { options: true },
    });
  }

  // ========== PERSISTENCE ==========

  /** GameSession -> QUESTION_ACTIVE + startedAt; Room LOBBY -> IN_PROGRESS. */
  async markGameStarted(pin: string, state: GameState): Promise<void> {
    const startedAt = new Date(state.startedAt ?? Date.now());
    const sessionUpdate = this.prisma.gameSession.update({
      where: { pin },
      data: { status: PrismaGameStatus.QUESTION_ACTIVE, startedAt },
    });

    if (state.roomId) {
      const roomUpdate = this.prisma.room.updateMany({
        where: { id: state.roomId, status: RoomStatus.LOBBY },
        data: { status: RoomStatus.IN_PROGRESS, startedAt },
      });
      await this.prisma.$transaction([sessionUpdate, roomUpdate]);
    } else {
      await this.prisma.$transaction([sessionUpdate]);
    }
  }

  /** GameSession -> ENDED with startedAt / endedAt and one PlayerResult per player; Room -> ENDED. */
  async finalizeGame(pin: string, state: GameState, finalLeaderboard: LeaderboardEntry[]): Promise<void> {
    const endedAt = new Date();
    const sessionUpdate = this.prisma.gameSession.update({
      where: { pin },
      data: {
        status: PrismaGameStatus.ENDED,
        startedAt: state.startedAt ? new Date(state.startedAt) : undefined,
        endedAt,
        results: {
          create: finalLeaderboard.map((entry) => ({
            userId: null, // players are anonymous
            nickname: entry.nickname,
            finalScore: entry.score,
            rank: entry.rank,
            correctAnswersCount: entry.correctAnswersCount,
          })),
        },
      },
    });

    if (state.roomId) {
      const roomUpdate = this.prisma.room.updateMany({
        where: { id: state.roomId },
        data: { status: RoomStatus.ENDED, endedAt },
      });
      await this.prisma.$transaction([sessionUpdate, roomUpdate]);
    } else {
      await this.prisma.$transaction([sessionUpdate]);
    }
    this.logger.log(`Game ${pin} results saved (${finalLeaderboard.length} players)`);
  }

  // ========== READ-ONLY REST HELPERS ==========

  async getGameState(pin: string): Promise<GameState | null> {
    return this.redis.getGameState(pin);
  }

  async getPlayers(pin: string): Promise<PlayerData[]> {
    return this.redis.getAllPlayers(pin);
  }

  /** Legacy REST pre-check (`POST /api/games/:code/start`); the actual start happens over WebSocket. */
  async startGame(userId: string, pin: string): Promise<void> {
    const gameState = await this.redis.getGameState(pin);
    if (!gameState) {
      throw new Error('GAME_NOT_FOUND');
    }

    if (gameState.hostId !== userId) {
      throw new Error('UNAUTHORIZED');
    }

    if (gameState.status !== 'LOBBY') {
      throw new Error('INVALID_STATE');
    }

    const playerCount = await this.redis.getPlayerCount(pin);
    if (playerCount < MIN_PLAYERS_TO_START) {
      throw new Error('NO_PLAYERS');
    }
  }
}

function describe(value: unknown): string {
  return value instanceof Error ? `${value.name}: ${value.message}` : String(value);
}
