import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Injectable, Logger, OnModuleDestroy, UseFilters, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import { Server, WebSocket } from 'ws';
import {
  AddPlayerResult,
  AnswerSubmission,
  GameRedisService,
  GameState,
  PlayerData,
  RecordAnswerResult,
  StateExpectation,
  StateUpdates,
} from '../../common/redis/game-redis.service';
import { safeEqual } from '../../common/security/safe-equal';
import { GameQuestion, GameService } from './game.service';
import { RoomService } from './room.service';
import { GameError } from './game-errors';
import { GameWsExceptionFilter } from './game-ws-exception.filter';
import { OpenSocketGuard } from './open-socket.guard';
import {
  ANSWER_COUNT_INTERVAL_MS,
  calculateScore,
  INTER_QUESTION_DELAY_MS,
  isPlayableQuestion,
  LEADERBOARD_TOP_SIZE,
  LOBBY_DURATION_MS,
  LOBBY_EXPIRED_CLEANUP_DELAY_MS,
  LOBBY_TICK_MS,
  MIN_PLAYERS_TO_START,
  nicknameKey,
  PODIUM_CLEANUP_DELAY_MS,
  PODIUM_SIZE,
} from './game-rules';
import {
  ClientEvents,
  ServerEvents,
  GameStatus,
  HostCreateGameDto,
  HostJoinGameDto,
  HostStartGameDto,
  HostNextStepDto,
  PlayerJoinDto,
  PlayerLeaveDto,
  PlayerReconnectDto,
  PlayerSubmitAnswerDto,
  GamePodiumPayload,
  GameStateChangedPayload,
  HostGameCreatedPayload,
  LeaderboardEntry,
  LobbyPlayerJoinedPayload,
  LobbyPlayerLeftPayload,
  LobbyTimerPayload,
  PlayerAnswerAcceptedPayload,
  PlayerFeedbackPayload,
  PlayerJoinedPayload,
  PlayerPublic,
  PlayerStateSyncPayload,
  QuestionAnswerCountPayload,
  QuestionEndedPayload,
  QuestionStartedPayload,
} from './dto/game-events.dto';

/** Socket enriched with the game binding (set by host:create_game / host:join_game / player:join / player:reconnect). */
export interface GameSocket extends WebSocket {
  pin?: string;
  isHost?: boolean;
  playerId?: string;
  playerToken?: string;
}

interface Standings {
  leaderboard: LeaderboardEntry[]; // every player, rank order
  playersById: Map<string, PlayerData>;
  rankById: Map<string, number>;
}

const WS_MAX_PAYLOAD_BYTES = 16 * 1024;
const POLICY_VIOLATION_CLOSE_CODE = 1008;
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

const JOIN_ERROR_MESSAGES: Record<Exclude<AddPlayerResult, 'OK'>, string> = {
  GAME_NOT_FOUND: 'Game not found',
  GAME_ALREADY_STARTED: 'This game has already started',
  ROOM_FULL: 'This game is full',
  NICKNAME_TAKEN: 'This nickname is already taken in this game',
};

const ANSWER_ERROR_MESSAGES: Record<Exclude<RecordAnswerResult, 'OK'>, string> = {
  GAME_NOT_FOUND: 'Game not found',
  INVALID_STATE: 'No question is active',
  INVALID_QUESTION: 'This question is not the current one',
  ALREADY_ANSWERED: 'Answer already submitted for this question',
};

/**
 * Live game gateway - WebSocket protocol v1, normative contract: docs/adr/0001-websocket-game-protocol.md.
 *
 * - Transport: `ws` through WsAdapter (main.ts), path `/game` (WsAdapter does not support namespaces).
 * - Every handler error (validation, GameError, unexpected) is turned into the ADR `error` event by
 *   GameWsExceptionFilter. Timer / interval callbacks go through `runSafely` (try/catch + log).
 * - The global HTTP throttler is skipped: it keys by `req.ip`, which does not exist on a WS message, so all
 *   sockets would share one bucket and a normal game would be throttled.
 */
@WebSocketGateway({ path: '/game', maxPayload: WS_MAX_PAYLOAD_BYTES })
@SkipThrottle()
@UseFilters(new GameWsExceptionFilter())
@UseGuards(new OpenSocketGuard())
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
@Injectable()
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(GameGateway.name);
  private readonly allowedOrigin: string;
  // In-memory socket rooms and timers: single backend instance only (tech debt D-003).
  private readonly rooms = new Map<string, Set<GameSocket>>();
  private readonly questionTimers = new Map<string, NodeJS.Timeout>(); // key `${pin}:${questionIndex}`
  private readonly interQuestionTimers = new Map<string, NodeJS.Timeout>(); // key `pin`
  private readonly answerCountIntervals = new Map<string, NodeJS.Timeout>();
  private readonly lobbyTimers = new Map<string, NodeJS.Timeout>();
  private readonly cleanupTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly gameService: GameService,
    private readonly redis: GameRedisService,
    private readonly roomService: RoomService,
    configService: ConfigService,
  ) {
    this.allowedOrigin = normalizeOrigin(configService.get<string>('app.frontendUrl') || DEFAULT_FRONTEND_URL);
  }

  onModuleDestroy(): void {
    for (const timer of this.questionTimers.values()) clearTimeout(timer);
    for (const timer of this.interQuestionTimers.values()) clearTimeout(timer);
    for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
    for (const interval of this.answerCountIntervals.values()) clearInterval(interval);
    for (const interval of this.lobbyTimers.values()) clearInterval(interval);
    this.questionTimers.clear();
    this.interQuestionTimers.clear();
    this.cleanupTimers.clear();
    this.answerCountIntervals.clear();
    this.lobbyTimers.clear();
  }

  // ========== CONNECTION HANDLING ==========

  /** ADR 0001 section 1: an `Origin` different from app.frontendUrl is closed with 1008; no Origin is accepted. */
  handleConnection(client: GameSocket, request?: IncomingMessage): void {
    const origin = request?.headers?.origin;
    if (origin !== undefined && normalizeOrigin(origin) !== this.allowedOrigin) {
      this.logger.warn(`WebSocket connection refused: origin "${origin}" is not allowed`);
      client.close(POLICY_VIOLATION_CLOSE_CODE, 'Origin not allowed');
    }
  }

  handleDisconnect(client: GameSocket): void {
    const role = client.isHost ? 'host' : client.playerId ? `player ${client.playerId}` : 'unknown';
    this.releaseSocket(client);
    this.logger.debug(`Client disconnected: ${role}`);
  }

  // ========== HOST EVENTS ==========

  @SubscribeMessage(ClientEvents.HOST_CREATE_GAME)
  async handleHostCreateGame(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() dto: HostCreateGameDto,
  ): Promise<void> {
    const game = await this.gameService.createAnonymousGame(dto.quizId, dto.shareToken);
    await this.ensureLobbyTimer(game.pin);
    await this.sendHostSnapshot(client, game.pin, game.hostToken);
  }

  @SubscribeMessage(ClientEvents.HOST_JOIN_GAME)
  async handleHostJoinGame(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() dto: HostJoinGameDto,
  ): Promise<void> {
    const state = await this.redis.getGameState(dto.pin);
    if (!state) {
      throw new GameError('GAME_NOT_FOUND', 'Game not found');
    }
    await this.gameService.verifyHostToken(dto.pin, dto.hostToken);

    if (state.status === 'LOBBY') {
      // First host join of a REST-created game starts the lobby countdown; later joins keep the deadline.
      await this.ensureLobbyTimer(dto.pin);
    }
    await this.sendHostSnapshot(client, dto.pin, dto.hostToken);
    this.logger.log(`Host joined game ${dto.pin}`);
  }

  @SubscribeMessage(ClientEvents.HOST_START_GAME)
  async handleHostStartGame(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() dto: HostStartGameDto,
  ): Promise<void> {
    await this.gameService.verifyHostToken(dto.pin, dto.hostToken);
    const state = await this.requireGameState(dto.pin);
    if (state.status !== 'LOBBY') {
      throw new GameError('INVALID_STATE', 'The game can only be started from the lobby');
    }
    const playerCount = await this.redis.getPlayerCount(dto.pin);
    if (playerCount < MIN_PLAYERS_TO_START) {
      throw new GameError('NOT_ENOUGH_PLAYERS', `At least ${MIN_PLAYERS_TO_START} player is required to start`);
    }
    await this.startQuestion(dto.pin, 0);
  }

  @SubscribeMessage(ClientEvents.HOST_NEXT_STEP)
  async handleHostNextStep(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() dto: HostNextStepDto,
  ): Promise<void> {
    await this.gameService.verifyHostToken(dto.pin, dto.hostToken);
    const state = await this.requireGameState(dto.pin);
    if (state.status !== 'QUESTION_RESULT') {
      throw new GameError('INVALID_STATE', 'The next step is only available once a question has ended');
    }
    this.clearInterQuestionTimer(dto.pin);
    const nextIndex = state.currentQuestionIndex + 1;
    if (nextIndex >= state.questionCount) {
      await this.showPodium(dto.pin);
    } else {
      await this.startQuestion(dto.pin, nextIndex);
    }
  }

  // ========== PLAYER EVENTS ==========

  @SubscribeMessage(ClientEvents.PLAYER_JOIN)
  async handlePlayerJoin(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() dto: PlayerJoinDto,
  ): Promise<void> {
    // The game is resolved ONLY through the Redis state of `pin` (ADR 0001 section 2).
    const state = await this.requireGameState(dto.pin);
    if (state.status !== 'LOBBY') {
      throw new GameError('GAME_ALREADY_STARTED', JOIN_ERROR_MESSAGES.GAME_ALREADY_STARTED);
    }

    const playerId = randomUUID();
    const playerToken = randomUUID();
    const key = nicknameKey(dto.nickname);
    const result = await this.redis.addPlayer(dto.pin, { id: playerId, nickname: dto.nickname, joinedAt: Date.now() }, key);
    if (result !== 'OK') {
      throw new GameError(result, JOIN_ERROR_MESSAGES[result]);
    }

    try {
      if (state.roomId) {
        await this.roomService.createParticipant(state.roomId, playerId, dto.nickname);
      }
      await this.redis.savePlayerToken(playerToken, dto.pin, playerId);
    } catch (error) {
      await this.runSafely(`rollback of player ${playerId} in game ${dto.pin}`, () =>
        this.redis.removePlayer(dto.pin, playerId, key),
      );
      throw error;
    }

    this.bindPlayer(client, dto.pin, playerId, playerToken);

    const players = await this.redis.getAllPlayers(dto.pin);
    this.send<PlayerJoinedPayload>(client, ServerEvents.PLAYER_JOINED, {
      playerId,
      playerToken,
      pin: dto.pin,
      nickname: dto.nickname,
      quizTitle: state.quizTitle,
      questionCount: state.questionCount,
      players: players.map(toPlayerPublic),
    });
    const freshState = (await this.redis.getGameState(dto.pin)) ?? state;
    this.send<GameStateChangedPayload>(
      client,
      ServerEvents.GAME_STATE_CHANGED,
      await this.buildStateChanged(dto.pin, freshState, players),
    );
    const remaining = await this.redis.getLobbyTimeRemaining(dto.pin);
    if (remaining > 0) {
      this.send<LobbyTimerPayload>(client, ServerEvents.LOBBY_TIMER, { remaining });
    }

    this.broadcast<LobbyPlayerJoinedPayload>(dto.pin, ServerEvents.LOBBY_PLAYER_JOINED, {
      playerId,
      nickname: dto.nickname,
      playerCount: players.length,
    });
    this.logger.log(`Player ${playerId} joined game ${dto.pin}`);
  }

  @SubscribeMessage(ClientEvents.PLAYER_RECONNECT)
  async handlePlayerReconnect(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() dto: PlayerReconnectDto,
  ): Promise<void> {
    const tokenData = await this.redis.getPlayerTokenData(dto.playerToken);
    if (!tokenData) {
      throw new GameError('INVALID_TOKEN', 'Invalid or expired player token');
    }
    const { pin, playerId } = tokenData;
    await this.requireGameState(pin);
    const existing = await this.redis.getPlayer(pin, playerId);
    if (!existing) {
      throw new GameError('PLAYER_NOT_FOUND', 'Player not found in this game');
    }

    // Never creates a player: only re-binds the socket to the existing one.
    this.bindPlayer(client, pin, playerId, dto.playerToken);
    await this.redis.setPlayerConnected(pin, playerId, true);
    await this.sendPlayerReconnectSnapshot(client, pin, playerId, dto.playerToken);
    this.logger.log(`Player ${playerId} reconnected to game ${pin}`);
  }

  @SubscribeMessage(ClientEvents.PLAYER_SUBMIT_ANSWER)
  async handlePlayerSubmitAnswer(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() dto: PlayerSubmitAnswerDto,
  ): Promise<void> {
    const playerId = client.playerId;
    if (
      !playerId ||
      client.isHost ||
      !client.playerToken ||
      client.pin !== dto.pin ||
      !safeEqual(client.playerToken, dto.playerToken)
    ) {
      throw new GameError('UNAUTHORIZED', 'This connection is not bound to this player');
    }

    const state = await this.requireGameState(dto.pin);
    if (state.status !== 'QUESTION_ACTIVE') {
      throw new GameError('INVALID_STATE', ANSWER_ERROR_MESSAGES.INVALID_STATE);
    }
    if (state.currentQuestionIndex !== dto.questionIndex) {
      throw new GameError('INVALID_QUESTION', ANSWER_ERROR_MESSAGES.INVALID_QUESTION);
    }

    const question = await this.gameService.getQuestion(state.quizId, dto.questionIndex);
    if (!question) {
      throw new GameError('INVALID_STATE', 'The current question is no longer available');
    }
    const option = question.options.find((candidate) => candidate.id === dto.optionId);
    if (!option) {
      throw new GameError('INVALID_OPTION', 'This option does not belong to the current question');
    }

    const submittedAt = Date.now();
    const timeElapsed = Math.max(0, submittedAt - state.questionStartTime);
    const isCorrect = option.isCorrect;
    const pointsEarned = calculateScore(timeElapsed, question.timeLimit * 1000, question.pointsMultiplier, isCorrect);

    // Atomic gate: status + index re-checked and HSETNX in one Lua script (ALREADY_ANSWERED).
    const result = await this.redis.recordAnswer(dto.pin, dto.questionIndex, {
      playerId,
      optionId: option.id,
      submittedAt,
      timeElapsed,
      isCorrect,
      pointsEarned,
    });
    if (result !== 'OK') {
      throw new GameError(result, ANSWER_ERROR_MESSAGES[result]);
    }

    // No correctness information while the question is active (ADR 0001 section 6).
    this.send<PlayerAnswerAcceptedPayload>(client, ServerEvents.PLAYER_ANSWER_ACCEPTED, {
      questionIndex: dto.questionIndex,
    });
    await this.broadcastAnswerCount(dto.pin, dto.questionIndex);
  }

  @SubscribeMessage(ClientEvents.PLAYER_LEAVE)
  async handlePlayerLeave(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() dto: PlayerLeaveDto,
  ): Promise<void> {
    // Same auth check as submit_answer: the socket must be bound to this player.
    const playerId = client.playerId;
    if (
      !playerId ||
      client.isHost ||
      !client.playerToken ||
      client.pin !== dto.pin ||
      !safeEqual(client.playerToken, dto.playerToken)
    ) {
      throw new GameError('UNAUTHORIZED', 'This connection is not bound to this player');
    }

    // Load the player profile FIRST: once removed, we no longer know the nickname to broadcast
    // or the nicknameKey needed to clean the reverse-lookup map.
    const player = await this.redis.getPlayer(dto.pin, playerId);
    if (!player) {
      // Already gone (race with a prior leave). Nothing to do but detach the socket.
      this.releaseSocket(client);
      return;
    }

    const key = nicknameKey(player.nickname);
    await this.redis.removePlayer(dto.pin, playerId, key);
    // Invalidate the token so player:reconnect cannot resurrect this player.
    await this.redis.deletePlayerToken(dto.playerToken);

    const remaining = await this.redis.getAllPlayers(dto.pin);
    this.broadcast<LobbyPlayerLeftPayload>(dto.pin, ServerEvents.LOBBY_PLAYER_LEFT, {
      playerId,
      nickname: player.nickname,
      playerCount: remaining.length,
    });
    // Keep hosts and other players in sync with the new roster (lobby count, leaderboard).
    const state = await this.redis.getGameState(dto.pin);
    if (state) {
      this.broadcast<GameStateChangedPayload>(
        dto.pin,
        ServerEvents.GAME_STATE_CHANGED,
        await this.buildStateChanged(dto.pin, state, remaining),
      );
    }

    this.releaseSocket(client);
    this.logger.log(`Player ${playerId} left game ${dto.pin}`);
  }

  // ========== GAME ENGINE ==========

  private async startQuestion(pin: string, questionIndex: number): Promise<void> {
    // Whatever the path (manual start, auto-start, next step), the lobby countdown stops here.
    this.clearLobbyTimer(pin);

    const state = await this.redis.getGameState(pin);
    if (!state) return;

    const question = await this.gameService.getQuestion(state.quizId, questionIndex);
    if (!question) {
      this.logger.warn(`Question ${questionIndex} of game ${pin} not found, ending the game`);
      await this.showPodium(pin);
      return;
    }
    if (!isPlayableQuestion(question)) {
      await this.abortWithInvalidQuiz(pin, questionIndex);
      return;
    }

    const questionStartTime = Date.now();
    const expected: StateExpectation =
      questionIndex === 0
        ? { status: 'LOBBY' }
        : { status: 'QUESTION_RESULT', questionIndex: questionIndex - 1 };
    const updates: StateUpdates = {
      status: 'QUESTION_ACTIVE',
      currentQuestionIndex: questionIndex,
      questionStartTime,
    };
    if (questionIndex === 0) {
      updates.startedAt = questionStartTime;
    }
    // Compare-and-set: a concurrent start (host click + lobby auto-start, double next_step) is a no-op.
    const started = await this.redis.compareAndSetState(pin, expected, updates);
    if (!started) {
      this.logger.debug(`Question ${questionIndex} of game ${pin} already started or game state changed`);
      return;
    }

    // Arm the end-of-question timer first: the game must never freeze, even if a later call fails.
    const timeLimitMs = question.timeLimit * 1000;
    this.clearQuestionTimer(pin, questionIndex);
    const timer = setTimeout(
      () => void this.runSafely(`end of question ${questionIndex} of game ${pin}`, () => this.endQuestion(pin, questionIndex)),
      timeLimitMs,
    );
    this.questionTimers.set(questionTimerKey(pin, questionIndex), timer);
    this.startAnswerCountBroadcast(pin, questionIndex);

    this.broadcast<QuestionStartedPayload>(
      pin,
      ServerEvents.QUESTION_STARTED,
      buildQuestionStarted(question, questionIndex, state.questionCount, questionStartTime),
    );

    if (questionIndex === 0) {
      void this.runSafely(`persisting start of game ${pin}`, () =>
        this.gameService.markGameStarted(pin, { ...state, startedAt: questionStartTime }),
      );
    }
    await this.redis.setQuestionTimer(pin, questionIndex, timeLimitMs);
  }

  private async endQuestion(pin: string, questionIndex: number): Promise<void> {
    this.clearQuestionTimer(pin, questionIndex);
    this.stopAnswerCountBroadcast(pin);

    const closed = await this.redis.compareAndSetState(
      pin,
      { status: 'QUESTION_ACTIVE', questionIndex },
      { status: 'QUESTION_RESULT' },
    );
    if (!closed) return;
    await this.redis.clearQuestionTimer(pin);

    const state = await this.redis.getGameState(pin);
    if (!state) return;

    const question = await this.gameService.getQuestion(state.quizId, questionIndex);
    const correctOptionId = question && isPlayableQuestion(question) ? correctOptionOf(question) : null;
    if (!question || !correctOptionId) {
      await this.abortWithInvalidQuiz(pin, questionIndex);
      return;
    }

    const [players, answers] = await Promise.all([
      this.redis.getAllPlayers(pin),
      this.redis.getAllAnswers(pin, questionIndex),
    ]);
    const answersByPlayer = new Map(answers.map((answer) => [answer.playerId, answer]));

    // Scores / streaks are applied at question end only, so nothing leaks while the question is open.
    await this.redis.applyQuestionResults(
      pin,
      players.map((player) => {
        const answer = answersByPlayer.get(player.id);
        const isCorrect = answer !== undefined && answer.isCorrect;
        return { playerId: player.id, isCorrect, pointsEarned: answer && isCorrect ? answer.pointsEarned : 0 };
      }),
    );

    const standings = await this.loadStandings(pin);
    this.broadcast<QuestionEndedPayload>(
      pin,
      ServerEvents.QUESTION_ENDED,
      await this.buildQuestionEnded(pin, state.questionCount, questionIndex, question, correctOptionId, standings),
    );

    // Feedback to EVERY player socket, including players who did not answer.
    for (const socket of this.socketsOf(pin)) {
      if (socket.isHost || !socket.playerId) continue;
      this.send<PlayerFeedbackPayload>(
        socket,
        ServerEvents.PLAYER_FEEDBACK,
        buildFeedback(socket.playerId, questionIndex, correctOptionId, answersByPlayer.get(socket.playerId) ?? null, standings),
      );
    }

    // Schedule auto-advance to next question after INTER_QUESTION_DELAY_MS
    // Only if there are more questions; otherwise the host will manually go to podium
    if (questionIndex + 1 < state.questionCount) {
      this.clearInterQuestionTimer(pin);
      const timer = setTimeout(
        () => void this.runSafely(`auto-advance after question ${questionIndex} of game ${pin}`, () => this.autoAdvanceQuestion(pin, questionIndex)),
        INTER_QUESTION_DELAY_MS,
      );
      this.interQuestionTimers.set(pin, timer);
    }
  }

  private async autoAdvanceQuestion(pin: string, completedQuestionIndex: number): Promise<void> {
    // Verify the game is still in QUESTION_RESULT state for the completed question
    const state = await this.redis.getGameState(pin);
    if (!state) return;
    if (state.status !== 'QUESTION_RESULT') return;
    if (state.currentQuestionIndex !== completedQuestionIndex) return;

    const nextIndex = completedQuestionIndex + 1;
    if (nextIndex >= state.questionCount) {
      // No more questions, go to podium (host will manually trigger, but we can also auto-advance)
      await this.showPodium(pin);
    } else {
      await this.startQuestion(pin, nextIndex);
    }
  }

  private async showPodium(pin: string): Promise<void> {
    const switched = await this.redis.compareAndSetState(pin, { status: 'NOT_PODIUM' }, { status: 'PODIUM' });
    if (!switched) return;

    this.clearGameTimers(pin);
    await this.runSafely(`clearing question timer of game ${pin}`, () => this.redis.clearQuestionTimer(pin));

    const [state, standings] = await Promise.all([this.redis.getGameState(pin), this.loadStandings(pin)]);
    this.broadcast<GamePodiumPayload>(pin, ServerEvents.GAME_PODIUM, buildPodium(standings));
    this.scheduleCleanup(pin, PODIUM_CLEANUP_DELAY_MS);

    if (state) {
      await this.runSafely(`saving results of game ${pin}`, () =>
        this.gameService.finalizeGame(pin, state, standings.leaderboard),
      );
    }
  }

  /** ADR 0001 section 8: an unplayable question mid-game -> broadcast QUIZ_INVALID, then podium (never freeze). */
  private async abortWithInvalidQuiz(pin: string, questionIndex: number): Promise<void> {
    this.logger.warn(`Question ${questionIndex} of game ${pin} is not playable, ending the game`);
    this.broadcast(pin, ServerEvents.ERROR, {
      code: 'QUIZ_INVALID',
      message: 'A question of this quiz is not playable, the game ends now',
    });
    await this.showPodium(pin);
  }

  private async cleanupGame(pin: string): Promise<void> {
    this.clearGameTimers(pin);
    const cleanupTimer = this.cleanupTimers.get(pin);
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      this.cleanupTimers.delete(pin);
    }
    this.rooms.delete(pin);
    await this.redis.deleteGame(pin);
    this.logger.log(`Game ${pin} cleaned up`);
  }

  private scheduleCleanup(pin: string, delayMs: number): void {
    if (this.cleanupTimers.has(pin)) return;
    const timer = setTimeout(() => void this.runSafely(`cleanup of game ${pin}`, () => this.cleanupGame(pin)), delayMs);
    this.cleanupTimers.set(pin, timer);
  }

  // ========== LOBBY TIMER ==========

  private async ensureLobbyTimer(pin: string): Promise<void> {
    if (this.lobbyTimers.has(pin)) return;
    await this.redis.setLobbyTimer(pin, LOBBY_DURATION_MS); // NX: an existing deadline is kept
    if (this.lobbyTimers.has(pin)) return; // started concurrently while awaiting
    const interval = setInterval(
      () => void this.runSafely(`lobby timer of game ${pin}`, () => this.onLobbyTick(pin)),
      LOBBY_TICK_MS,
    );
    this.lobbyTimers.set(pin, interval);
  }

  private async onLobbyTick(pin: string): Promise<void> {
    const [state, remaining] = await Promise.all([
      this.redis.getGameState(pin),
      this.redis.getLobbyTimeRemaining(pin),
    ]);
    if (!this.lobbyTimers.has(pin)) return; // cleared while awaiting (start, cleanup, other tick)
    if (!state || state.status !== 'LOBBY') {
      this.clearLobbyTimer(pin);
      return;
    }
    if (remaining > 0) {
      this.broadcast<LobbyTimerPayload>(pin, ServerEvents.LOBBY_TIMER, { remaining });
      return;
    }
    this.clearLobbyTimer(pin);
    await this.handleLobbyExpired(pin);
  }

  private async handleLobbyExpired(pin: string): Promise<void> {
    const playerCount = await this.redis.getPlayerCount(pin);
    if (playerCount >= MIN_PLAYERS_TO_START) {
      this.logger.log(`Lobby of game ${pin} expired, auto-starting with ${playerCount} player(s)`);
      await this.startQuestion(pin, 0);
      return;
    }
    this.logger.log(`Lobby of game ${pin} expired without players`);
    this.broadcast(pin, ServerEvents.ERROR, {
      code: 'LOBBY_EXPIRED',
      message: 'The lobby expired before any player joined',
    });
    this.scheduleCleanup(pin, LOBBY_EXPIRED_CLEANUP_DELAY_MS);
  }

  private clearLobbyTimer(pin: string): void {
    const interval = this.lobbyTimers.get(pin);
    if (interval) {
      clearInterval(interval);
      this.lobbyTimers.delete(pin);
    }
    void this.runSafely(`clearing lobby timer of game ${pin}`, () => this.redis.clearLobbyTimer(pin));
  }

  // ========== QUESTION TIMERS ==========

  private startAnswerCountBroadcast(pin: string, questionIndex: number): void {
    this.stopAnswerCountBroadcast(pin);
    const interval = setInterval(
      () => void this.runSafely(`answer count of game ${pin}`, () => this.broadcastAnswerCount(pin, questionIndex)),
      ANSWER_COUNT_INTERVAL_MS,
    );
    this.answerCountIntervals.set(pin, interval);
  }

  private stopAnswerCountBroadcast(pin: string): void {
    const interval = this.answerCountIntervals.get(pin);
    if (interval) {
      clearInterval(interval);
      this.answerCountIntervals.delete(pin);
    }
  }

  private clearQuestionTimer(pin: string, questionIndex: number): void {
    const key = questionTimerKey(pin, questionIndex);
    const timer = this.questionTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.questionTimers.delete(key);
    }
  }

  private clearInterQuestionTimer(pin: string): void {
    const timer = this.interQuestionTimers.get(pin);
    if (timer) {
      clearTimeout(timer);
      this.interQuestionTimers.delete(pin);
    }
  }

  /** Clears every in-memory timer of the game except the cleanup timer. */
  private clearGameTimers(pin: string): void {
    this.clearLobbyTimer(pin);
    this.stopAnswerCountBroadcast(pin);
    this.clearInterQuestionTimer(pin);
    const prefix = `${pin}:`;
    for (const [key, timer] of this.questionTimers) {
      if (key.startsWith(prefix)) {
        clearTimeout(timer);
        this.questionTimers.delete(key);
      }
    }
  }

  private async broadcastAnswerCount(pin: string, questionIndex: number): Promise<void> {
    this.broadcast<QuestionAnswerCountPayload>(
      pin,
      ServerEvents.QUESTION_ANSWER_COUNT,
      await this.buildAnswerCount(pin, questionIndex),
    );
  }

  // ========== SNAPSHOTS (ADR 0001 section 7) ==========

  /**
   * Host snapshot. `host:game_created` is guaranteed to be the FIRST message the host socket receives:
   * the socket joins the game room (and starts receiving broadcasts) only right after it was sent,
   * synchronously, so no broadcast can be interleaved before it.
   */
  private async sendHostSnapshot(client: GameSocket, pin: string, hostToken: string): Promise<void> {
    const state = await this.requireGameState(pin);
    const players = await this.redis.getAllPlayers(pin);

    this.send<HostGameCreatedPayload>(client, ServerEvents.HOST_GAME_CREATED, {
      pin,
      quizTitle: state.quizTitle,
      questionCount: state.questionCount,
      hostToken,
    });
    this.bindHost(client, pin);
    this.send<GameStateChangedPayload>(
      client,
      ServerEvents.GAME_STATE_CHANGED,
      await this.buildStateChanged(pin, state, players),
    );

    switch (state.status) {
      case 'LOBBY': {
        const remaining = await this.redis.getLobbyTimeRemaining(pin);
        if (remaining > 0) {
          this.send<LobbyTimerPayload>(client, ServerEvents.LOBBY_TIMER, { remaining });
        }
        break;
      }
      case 'QUESTION_ACTIVE': {
        const question = await this.loadQuestionForSnapshot(pin, state);
        if (question) {
          this.send<QuestionStartedPayload>(
            client,
            ServerEvents.QUESTION_STARTED,
            buildQuestionStarted(question, state.currentQuestionIndex, state.questionCount, state.questionStartTime),
          );
          this.send<QuestionAnswerCountPayload>(
            client,
            ServerEvents.QUESTION_ANSWER_COUNT,
            await this.buildAnswerCount(pin, state.currentQuestionIndex),
          );
        }
        break;
      }
      case 'QUESTION_RESULT': {
        const question = await this.loadQuestionForSnapshot(pin, state);
        const correctOptionId = question ? correctOptionOf(question) : null;
        if (question && correctOptionId) {
          const standings = await this.loadStandings(pin);
          this.send<QuestionEndedPayload>(
            client,
            ServerEvents.QUESTION_ENDED,
            await this.buildQuestionEnded(pin, state.questionCount, state.currentQuestionIndex, question, correctOptionId, standings),
          );
        }
        break;
      }
      case 'PODIUM': {
        this.send<GamePodiumPayload>(client, ServerEvents.GAME_PODIUM, buildPodium(await this.loadStandings(pin)));
        break;
      }
    }
  }

  private async sendPlayerReconnectSnapshot(
    client: GameSocket,
    pin: string,
    playerId: string,
    playerToken: string,
  ): Promise<void> {
    const state = await this.requireGameState(pin);
    const players = await this.redis.getAllPlayers(pin);
    const player = players.find((candidate) => candidate.id === playerId) ?? (await this.redis.getPlayer(pin, playerId));
    if (!player) {
      throw new GameError('PLAYER_NOT_FOUND', 'Player not found in this game');
    }

    this.send<PlayerJoinedPayload>(client, ServerEvents.PLAYER_JOINED, {
      playerId,
      playerToken,
      pin,
      nickname: player.nickname,
      quizTitle: state.quizTitle,
      questionCount: state.questionCount,
      players: players.map(toPlayerPublic),
    });
    this.send<GameStateChangedPayload>(
      client,
      ServerEvents.GAME_STATE_CHANGED,
      await this.buildStateChanged(pin, state, players),
    );

    // A failure in the status-specific part must not prevent player:state_sync, which the client waits for.
    await this.runSafely(`reconnect snapshot of player ${playerId} in game ${pin}`, () =>
      this.sendPlayerStatusSnapshot(client, pin, playerId, state),
    );

    // player:state_sync is ALWAYS the last message of the reconnect snapshot, whatever the status.
    const [rank, hasAnsweredCurrentQuestion] = await Promise.all([
      this.redis.getPlayerRank(pin, playerId),
      state.status === 'LOBBY' || state.currentQuestionIndex < 0
        ? Promise.resolve(false)
        : this.redis.hasPlayerAnswered(pin, state.currentQuestionIndex, playerId),
    ]);
    this.send<PlayerStateSyncPayload>(client, ServerEvents.PLAYER_STATE_SYNC, {
      score: player.score,
      rank,
      streak: player.streak,
      correctAnswersCount: player.correctAnswersCount,
      hasAnsweredCurrentQuestion,
    });
  }

  private async sendPlayerStatusSnapshot(
    client: GameSocket,
    pin: string,
    playerId: string,
    state: GameState,
  ): Promise<void> {
    switch (state.status) {
      case 'LOBBY': {
        const remaining = await this.redis.getLobbyTimeRemaining(pin);
        this.send<LobbyTimerPayload>(client, ServerEvents.LOBBY_TIMER, { remaining });
        break;
      }
      case 'QUESTION_ACTIVE': {
        const question = await this.loadQuestionForSnapshot(pin, state);
        if (question) {
          this.send<QuestionStartedPayload>(
            client,
            ServerEvents.QUESTION_STARTED,
            buildQuestionStarted(question, state.currentQuestionIndex, state.questionCount, state.questionStartTime),
          );
        }
        break;
      }
      case 'QUESTION_RESULT': {
        const question = await this.loadQuestionForSnapshot(pin, state);
        const correctOptionId = question ? correctOptionOf(question) : null;
        if (question && correctOptionId) {
          const standings = await this.loadStandings(pin);
          this.send<QuestionEndedPayload>(
            client,
            ServerEvents.QUESTION_ENDED,
            await this.buildQuestionEnded(pin, state.questionCount, state.currentQuestionIndex, question, correctOptionId, standings),
          );
          const answer = await this.redis.getAnswer(pin, state.currentQuestionIndex, playerId);
          this.send<PlayerFeedbackPayload>(
            client,
            ServerEvents.PLAYER_FEEDBACK,
            buildFeedback(playerId, state.currentQuestionIndex, correctOptionId, answer, standings),
          );
        }
        break;
      }
      case 'PODIUM': {
        this.send<GamePodiumPayload>(client, ServerEvents.GAME_PODIUM, buildPodium(await this.loadStandings(pin)));
        break;
      }
    }
  }

  private async loadQuestionForSnapshot(pin: string, state: GameState): Promise<GameQuestion | null> {
    const question = await this.gameService.getQuestion(state.quizId, state.currentQuestionIndex);
    if (!question) {
      this.logger.warn(`Question ${state.currentQuestionIndex} of game ${pin} not found while building a snapshot`);
    }
    return question;
  }

  // ========== PAYLOAD BUILDERS ==========

  private async buildStateChanged(pin: string, state: GameState, players: PlayerData[]): Promise<GameStateChangedPayload> {
    const timeRemaining = state.status === 'QUESTION_ACTIVE' ? await this.redis.getQuestionTimeRemaining(pin) : 0;
    return {
      status: GameStatus[state.status],
      currentQuestionIndex: state.status === 'LOBBY' ? -1 : state.currentQuestionIndex,
      questionCount: state.questionCount,
      timeRemaining,
      players: players.map(toPlayerPublic),
    };
  }

  private async buildAnswerCount(pin: string, questionIndex: number): Promise<QuestionAnswerCountPayload> {
    const [answeredCount, totalPlayers] = await Promise.all([
      this.redis.getAnswerCount(pin, questionIndex),
      this.redis.getPlayerCount(pin),
    ]);
    return { questionIndex, answeredCount, totalPlayers };
  }

  private async buildQuestionEnded(
    pin: string,
    questionCount: number,
    questionIndex: number,
    question: GameQuestion,
    correctOptionId: string,
    standings: Standings,
  ): Promise<QuestionEndedPayload> {
    const answerDistribution = await this.redis.getAnswerDistribution(
      pin,
      questionIndex,
      question.options.map((option) => option.id),
    );
    return {
      questionIndex,
      questionCount,
      correctOptionId,
      answerDistribution,
      leaderboard: standings.leaderboard.slice(0, LEADERBOARD_TOP_SIZE),
    };
  }

  private async loadStandings(pin: string): Promise<Standings> {
    const [players, ranking] = await Promise.all([this.redis.getAllPlayers(pin), this.redis.getLeaderboard(pin)]);
    const playersById = new Map(players.map((player) => [player.id, player]));
    const leaderboard: LeaderboardEntry[] = ranking
      .filter((entry) => playersById.has(entry.playerId))
      .map((entry, index) => {
        const player = playersById.get(entry.playerId) as PlayerData;
        return {
          playerId: entry.playerId,
          nickname: player.nickname,
          score: entry.score,
          rank: index + 1,
          correctAnswersCount: player.correctAnswersCount,
        };
      });
    const rankById = new Map(leaderboard.map((entry) => [entry.playerId, entry.rank]));
    return { leaderboard, playersById, rankById };
  }

  // ========== SOCKET BINDING / ROOMS ==========

  private async requireGameState(pin: string): Promise<GameState> {
    const state = await this.redis.getGameState(pin);
    if (!state) {
      throw new GameError('GAME_NOT_FOUND', 'Game not found');
    }
    return state;
  }

  private bindHost(client: GameSocket, pin: string): void {
    if (client.pin && (client.pin !== pin || !client.isHost)) {
      this.releaseSocket(client);
    }
    client.pin = pin;
    client.isHost = true;
    client.playerId = undefined;
    client.playerToken = undefined;
    this.joinRoom(client, pin);
  }

  private bindPlayer(client: GameSocket, pin: string, playerId: string, playerToken: string): void {
    if (client.pin && (client.pin !== pin || client.isHost || client.playerId !== playerId)) {
      this.releaseSocket(client);
    }
    client.pin = pin;
    client.isHost = false;
    client.playerId = playerId;
    client.playerToken = playerToken;
    this.joinRoom(client, pin);
  }

  /** Detaches a socket from its game (disconnect or re-binding to another game / role). */
  private releaseSocket(client: GameSocket): void {
    const { pin, playerId, isHost } = client;
    if (!pin) return;
    this.leaveRoom(client, pin);
    if (playerId && !isHost && !this.hasOtherSocketForPlayer(pin, playerId)) {
      void this.runSafely(`marking player ${playerId} disconnected in game ${pin}`, () =>
        this.redis.setPlayerConnected(pin, playerId, false),
      );
    }
    client.pin = undefined;
    client.isHost = false;
    client.playerId = undefined;
    client.playerToken = undefined;
  }

  private hasOtherSocketForPlayer(pin: string, playerId: string): boolean {
    return this.socketsOf(pin).some((socket) => !socket.isHost && socket.playerId === playerId);
  }

  private joinRoom(client: GameSocket, pin: string): void {
    let room = this.rooms.get(pin);
    if (!room) {
      room = new Set();
      this.rooms.set(pin, room);
    }
    room.add(client);
  }

  private leaveRoom(client: GameSocket, pin: string): void {
    const room = this.rooms.get(pin);
    if (room) {
      room.delete(client);
      if (room.size === 0) {
        this.rooms.delete(pin);
      }
    }
  }

  private socketsOf(pin: string): GameSocket[] {
    return Array.from(this.rooms.get(pin) ?? []);
  }

  private send<T>(client: GameSocket, event: string, data: T): void {
    if (client.readyState !== WebSocket.OPEN) return;
    client.send(JSON.stringify({ event, data }));
  }

  private broadcast<T>(pin: string, event: string, data: T): void {
    const room = this.rooms.get(pin);
    if (!room) return;
    const message = JSON.stringify({ event, data });
    for (const client of room) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  /** Runs a background task (timer, interval, fire-and-forget) without ever leaking a rejected promise. */
  private async runSafely(label: string, task: () => Promise<unknown>): Promise<void> {
    try {
      await task();
    } catch (error) {
      this.logger.error(`${label} failed: ${describeError(error)}`, error instanceof Error ? error.stack : undefined);
    }
  }
}

// ========== PURE HELPERS ==========

function questionTimerKey(pin: string, questionIndex: number): string {
  return `${pin}:${questionIndex}`;
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function correctOptionOf(question: GameQuestion): string | null {
  const correct = question.options.filter((option) => option.isCorrect);
  return correct.length === 1 ? correct[0].id : null;
}

function toPlayerPublic(player: PlayerData): PlayerPublic {
  return {
    id: player.id,
    nickname: player.nickname,
    score: player.score,
    streak: player.streak,
    correctAnswersCount: player.correctAnswersCount,
    connected: player.connected,
    joinedAt: player.joinedAt,
  };
}

function buildQuestionStarted(
  question: GameQuestion,
  questionIndex: number,
  questionCount: number,
  questionStartTime: number,
): QuestionStartedPayload {
  return {
    questionIndex,
    questionCount,
    questionText: question.text,
    imageUrl: question.imageUrl ?? null,
    timeLimit: question.timeLimit,
    pointsMultiplier: question.pointsMultiplier,
    // Never `isCorrect`; sorted by colorIndex ascending.
    options: [...question.options]
      .sort((a, b) => a.colorIndex - b.colorIndex)
      .map((option) => ({ id: option.id, text: option.text, colorIndex: option.colorIndex })),
    questionStartTime,
    serverTime: Date.now(),
  };
}

function buildFeedback(
  playerId: string,
  questionIndex: number,
  correctOptionId: string,
  answer: AnswerSubmission | null,
  standings: Standings,
): PlayerFeedbackPayload {
  const player = standings.playersById.get(playerId);
  const answered = answer !== null;
  const isCorrect = answer !== null && answer.isCorrect;
  return {
    questionIndex,
    answered,
    isCorrect,
    pointsEarned: answer !== null && isCorrect ? answer.pointsEarned : 0,
    totalScore: player?.score ?? 0,
    rank: standings.rankById.get(playerId) ?? 0,
    streak: answered ? player?.streak ?? 0 : 0,
    correctAnswersCount: player?.correctAnswersCount ?? 0,
    correctOptionId,
  };
}

function buildPodium(standings: Standings): GamePodiumPayload {
  return {
    podium: standings.leaderboard.slice(0, PODIUM_SIZE),
    finalLeaderboard: standings.leaderboard,
  };
}
