import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

/** Live game status stored in Redis (ADR 0001 section 4). */
export type GameStatusValue = 'LOBBY' | 'QUESTION_ACTIVE' | 'QUESTION_RESULT' | 'PODIUM';

export interface GameState {
  status: GameStatusValue;
  currentQuestionIndex: number;
  questionStartTime: number; // epoch ms
  quizId: string;
  quizTitle: string;
  questionCount: number;
  hostId: string | null; // null for anonymous hosts
  roomId: string | null; // null for games created without a Room (WS host:create_game)
  maxPlayers: number;
  startedAt: number | null; // epoch ms of question 0
}

export interface CreateGameStateInput {
  quizId: string;
  quizTitle: string;
  questionCount: number;
  hostId: string | null;
  roomId: string | null;
  maxPlayers: number;
  hostToken: string;
}

export interface PlayerData {
  id: string;
  nickname: string;
  score: number;
  streak: number;
  correctAnswersCount: number;
  connected: boolean;
  joinedAt: number;
}

/** Immutable part of a player, stored as JSON. Counters live in dedicated structures (atomic updates). */
export interface PlayerProfile {
  id: string;
  nickname: string;
  joinedAt: number;
}

export interface AnswerSubmission {
  playerId: string;
  optionId: string;
  submittedAt: number;
  timeElapsed: number;
  isCorrect: boolean;
  pointsEarned: number;
}

export interface QuestionOutcome {
  playerId: string;
  isCorrect: boolean;
  pointsEarned: number;
}

export type AddPlayerResult = 'OK' | 'GAME_NOT_FOUND' | 'GAME_ALREADY_STARTED' | 'ROOM_FULL' | 'NICKNAME_TAKEN';
export type RecordAnswerResult = 'OK' | 'GAME_NOT_FOUND' | 'INVALID_STATE' | 'INVALID_QUESTION' | 'ALREADY_ANSWERED';

/** Expected current state for a compare-and-set transition. `NOT_PODIUM` = any existing, non-podium state. */
export interface StateExpectation {
  status: GameStatusValue | 'NOT_PODIUM';
  questionIndex?: number;
}

export type StateUpdates = Partial<Record<'status' | 'currentQuestionIndex' | 'questionStartTime' | 'startedAt', string | number>>;

export const GAME_TTL_SECONDS = 86400; // 24 hours
const DEFAULT_MAX_PLAYERS = 500;

// ========== LUA SCRIPTS (atomic multi-key operations) ==========

/**
 * Atomic player join: status check, capacity check, case-insensitive nickname uniqueness (HSETNX),
 * then creation of the player profile and counters.
 * KEYS: state, nicknames, players, leaderboard, streaks, correct, connected
 * ARGV: nicknameKey, playerId, profileJson, ttlSeconds, defaultMaxPlayers
 */
const ADD_PLAYER_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if not status then return 'GAME_NOT_FOUND' end
if status ~= 'LOBBY' then return 'GAME_ALREADY_STARTED' end
local maxPlayers = tonumber(redis.call('HGET', KEYS[1], 'maxPlayers')) or tonumber(ARGV[5])
if redis.call('HLEN', KEYS[3]) >= maxPlayers then return 'ROOM_FULL' end
if redis.call('HSETNX', KEYS[2], ARGV[1], ARGV[2]) == 0 then return 'NICKNAME_TAKEN' end
redis.call('HSET', KEYS[3], ARGV[2], ARGV[3])
redis.call('ZADD', KEYS[4], 0, ARGV[2])
redis.call('HSET', KEYS[5], ARGV[2], '0')
redis.call('HSET', KEYS[6], ARGV[2], '0')
redis.call('HSET', KEYS[7], ARGV[2], '1')
for i = 2, 7 do redis.call('EXPIRE', KEYS[i], ARGV[4]) end
return 'OK'
`;

/**
 * Atomic answer recording. HSETNX decides ALREADY_ANSWERED; the status/index check happens in the same
 * script so that no answer can be stored after the question was closed.
 * KEYS: state, answers ; ARGV: questionIndex, playerId, answerJson, ttlSeconds
 */
const RECORD_ANSWER_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if not status then return 'GAME_NOT_FOUND' end
if status ~= 'QUESTION_ACTIVE' then return 'INVALID_STATE' end
if redis.call('HGET', KEYS[1], 'currentQuestionIndex') ~= ARGV[1] then return 'INVALID_QUESTION' end
if redis.call('HSETNX', KEYS[2], ARGV[2], ARGV[3]) == 0 then return 'ALREADY_ANSWERED' end
redis.call('EXPIRE', KEYS[2], ARGV[4])
return 'OK'
`;

/**
 * Compare-and-set on the game state hash (prevents double start / double end / double podium).
 * KEYS: state ; ARGV: expectedStatus | 'NOT_PODIUM', expectedIndex | '', then field/value pairs
 */
const COMPARE_AND_SET_STATE_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if not status then return 0 end
if ARGV[1] == 'NOT_PODIUM' then
  if status == 'PODIUM' then return 0 end
elseif status ~= ARGV[1] then
  return 0
end
if ARGV[2] ~= '' and redis.call('HGET', KEYS[1], 'currentQuestionIndex') ~= ARGV[2] then return 0 end
for i = 3, #ARGV, 2 do redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1]) end
return 1
`;

/**
 * Sets the connected flag only if the player still exists (never recreates keys of a deleted game).
 * KEYS: players, connected ; ARGV: playerId, '1' | '0'
 */
const SET_CONNECTED_SCRIPT = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then return 0 end
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
return 1
`;

/**
 * Reserves a PIN / room code unless a game state already uses it.
 * KEYS: reservation, state ; ARGV: ttlSeconds
 */
const RESERVE_PIN_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
if redis.call('SET', KEYS[1], '1', 'EX', ARGV[1], 'NX') then return 1 end
return 0
`;

@Injectable()
export class GameRedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GameRedisService.name);
  private client: Redis;
  private subscriber: Redis;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('redis.url');

    if (!redisUrl) {
      throw new Error('UPSTASH_REDIS_URL is not configured');
    }

    // Parse the URL to extract host, port, and password for ioredis
    const url = new URL(redisUrl);
    const redisConfig = {
      host: url.hostname,
      port: parseInt(url.port || '6379', 10),
      password: url.password || undefined,
      username: url.username || undefined,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      enableReadyCheck: true,
      lazyConnect: true,
      // Certificates are always verified (no opt-out).
      tls: url.protocol === 'rediss:' ? { rejectUnauthorized: true } : undefined,
    };

    this.logger.log(`Connecting to Redis at ${redisConfig.host}:${redisConfig.port}`);

    this.client = new Redis(redisConfig);
    this.subscriber = new Redis(redisConfig);

    this.client.on('connect', () => this.logger.log('Redis client connected'));
    this.client.on('error', (err) => this.logger.error('Redis client error', err));
    this.subscriber.on('connect', () => this.logger.log('Redis subscriber connected'));
    this.subscriber.on('error', (err) => this.logger.error('Redis subscriber error', err));

    await this.client.connect();
    await this.subscriber.connect();
  }

  async onModuleDestroy() {
    await this.client.quit();
    await this.subscriber.quit();
    this.logger.log('Redis connections closed');
  }

  getClient(): Redis {
    return this.client;
  }

  getSubscriber(): Redis {
    return this.subscriber;
  }

  // ========== KEY GENERATORS ==========
  private gameStateKey(pin: string): string {
    return `game:${pin}:state`;
  }

  private gamePlayersKey(pin: string): string {
    return `game:${pin}:players`;
  }

  private gameLeaderboardKey(pin: string): string {
    return `game:${pin}:leaderboard`;
  }

  private gameStreaksKey(pin: string): string {
    return `game:${pin}:streaks`;
  }

  private gameCorrectKey(pin: string): string {
    return `game:${pin}:correct`;
  }

  private gameConnectedKey(pin: string): string {
    return `game:${pin}:connected`;
  }

  private gameNicknamesKey(pin: string): string {
    return `game:${pin}:nicknames`;
  }

  private gameHostTokenKey(pin: string): string {
    return `game:${pin}:host_token`;
  }

  private gameAnswersKey(pin: string, questionIndex: number): string {
    return `game:${pin}:answers:${questionIndex}`;
  }

  private gameQuestionTimerKey(pin: string): string {
    return `game:${pin}:question_timer`;
  }

  private gameLobbyTimerKey(pin: string): string {
    return `game:${pin}:lobby_timer`;
  }

  private playerTokenKey(token: string): string {
    return `player:token:${token}`;
  }

  private pinToTokenKey(pin: string, playerId: string): string {
    return `game:${pin}:player_token:${playerId}`;
  }

  private pinReservedKey(pin: string): string {
    return `game:pin:${pin}:reserved`;
  }

  private roomStateKey(code: string): string {
    return `room:${code}:state`;
  }

  private roomParticipantsKey(code: string): string {
    return `room:${code}:participants`;
  }

  // ========== PIN RESERVATION ==========
  /**
   * Atomically reserves `pin` (SET NX) unless a game state already exists for it.
   * Database uniqueness (GameSession.pin, Room.code) is checked by GameIdentifierService.
   */
  async tryReservePin(pin: string): Promise<boolean> {
    const result = await this.client.eval(
      RESERVE_PIN_SCRIPT,
      2,
      this.pinReservedKey(pin),
      this.gameStateKey(pin),
      GAME_TTL_SECONDS,
    );
    return Number(result) === 1;
  }

  async releasePin(pin: string): Promise<void> {
    await this.client.del(this.pinReservedKey(pin));
  }

  // ========== GAME STATE MANAGEMENT ==========
  async createGameState(pin: string, input: CreateGameStateInput): Promise<void> {
    const pipeline = this.client.multi();

    pipeline.hset(this.gameStateKey(pin), {
      status: 'LOBBY',
      currentQuestionIndex: '-1',
      questionStartTime: '0',
      quizId: input.quizId,
      quizTitle: input.quizTitle,
      questionCount: input.questionCount.toString(),
      hostId: input.hostId ?? '',
      roomId: input.roomId ?? '',
      maxPlayers: input.maxPlayers.toString(),
      createdAt: Date.now().toString(),
    });
    pipeline.expire(this.gameStateKey(pin), GAME_TTL_SECONDS);
    pipeline.set(this.gameHostTokenKey(pin), input.hostToken, 'EX', GAME_TTL_SECONDS);

    await pipeline.exec();
    this.logger.log(`Game state created for PIN: ${pin}`);
  }

  async getGameState(pin: string): Promise<GameState | null> {
    const data = await this.client.hgetall(this.gameStateKey(pin));
    if (!data || Object.keys(data).length === 0) return null;

    return {
      status: data.status as GameStatusValue,
      currentQuestionIndex: toInt(data.currentQuestionIndex, -1),
      questionStartTime: toInt(data.questionStartTime, 0),
      quizId: data.quizId,
      quizTitle: data.quizTitle ?? '',
      questionCount: toInt(data.questionCount, 0),
      hostId: data.hostId ? data.hostId : null,
      roomId: data.roomId ? data.roomId : null,
      maxPlayers: toInt(data.maxPlayers, DEFAULT_MAX_PLAYERS),
      startedAt: data.startedAt ? toInt(data.startedAt, 0) : null,
    };
  }

  /**
   * Atomically applies `updates` if the current state matches `expected`.
   * Returns false when the game does not exist or is not in the expected state.
   */
  async compareAndSetState(pin: string, expected: StateExpectation, updates: StateUpdates): Promise<boolean> {
    const fieldValues: string[] = [];
    for (const [field, value] of Object.entries(updates)) {
      if (value !== undefined) fieldValues.push(field, String(value));
    }
    const result = await this.client.eval(
      COMPARE_AND_SET_STATE_SCRIPT,
      1,
      this.gameStateKey(pin),
      expected.status,
      expected.questionIndex === undefined ? '' : String(expected.questionIndex),
      ...fieldValues,
    );
    return Number(result) === 1;
  }

  async getQuizId(pin: string): Promise<string | null> {
    return this.client.hget(this.gameStateKey(pin), 'quizId');
  }

  async getQuestionCount(pin: string): Promise<number> {
    const count = await this.client.hget(this.gameStateKey(pin), 'questionCount');
    return count ? parseInt(count, 10) : 0;
  }

  // ========== HOST TOKEN ==========
  async getHostToken(pin: string): Promise<string | null> {
    return this.client.get(this.gameHostTokenKey(pin));
  }

  // ========== PLAYER MANAGEMENT ==========
  /** Atomic join (see ADD_PLAYER_SCRIPT). `nicknameKey` is the lower-cased nickname. */
  async addPlayer(pin: string, profile: PlayerProfile, nicknameKey: string): Promise<AddPlayerResult> {
    const result = await this.client.eval(
      ADD_PLAYER_SCRIPT,
      7,
      this.gameStateKey(pin),
      this.gameNicknamesKey(pin),
      this.gamePlayersKey(pin),
      this.gameLeaderboardKey(pin),
      this.gameStreaksKey(pin),
      this.gameCorrectKey(pin),
      this.gameConnectedKey(pin),
      nicknameKey,
      profile.id,
      JSON.stringify(profile),
      GAME_TTL_SECONDS,
      DEFAULT_MAX_PLAYERS,
    );
    return result as AddPlayerResult;
  }

  /** Rollback of addPlayer (used when a later step of the join fails). */
  async removePlayer(pin: string, playerId: string, nicknameKey: string): Promise<void> {
    const pipeline = this.client.multi();
    pipeline.hdel(this.gamePlayersKey(pin), playerId);
    pipeline.zrem(this.gameLeaderboardKey(pin), playerId);
    pipeline.hdel(this.gameStreaksKey(pin), playerId);
    pipeline.hdel(this.gameCorrectKey(pin), playerId);
    pipeline.hdel(this.gameConnectedKey(pin), playerId);
    pipeline.hdel(this.gameNicknamesKey(pin), nicknameKey);
    await pipeline.exec();
  }

  async getPlayer(pin: string, playerId: string): Promise<PlayerData | null> {
    const results = await this.client
      .pipeline()
      .hget(this.gamePlayersKey(pin), playerId)
      .zscore(this.gameLeaderboardKey(pin), playerId)
      .hget(this.gameStreaksKey(pin), playerId)
      .hget(this.gameCorrectKey(pin), playerId)
      .hget(this.gameConnectedKey(pin), playerId)
      .exec();
    const [profileJson, score, streak, correct, connected] = unwrapPipeline(results) as Array<string | null>;
    if (!profileJson) return null;

    const profile = JSON.parse(profileJson) as PlayerProfile;
    return {
      id: profile.id,
      nickname: profile.nickname,
      joinedAt: profile.joinedAt,
      score: toInt(score, 0),
      streak: toInt(streak, 0),
      correctAnswersCount: toInt(correct, 0),
      connected: connected === '1',
    };
  }

  /** All players of the game, ordered by join time. */
  async getAllPlayers(pin: string): Promise<PlayerData[]> {
    const results = await this.client
      .pipeline()
      .hgetall(this.gamePlayersKey(pin))
      .zrange(this.gameLeaderboardKey(pin), 0, -1, 'WITHSCORES')
      .hgetall(this.gameStreaksKey(pin))
      .hgetall(this.gameCorrectKey(pin))
      .hgetall(this.gameConnectedKey(pin))
      .exec();
    const [profiles, scoresFlat, streaks, correct, connected] = unwrapPipeline(results) as [
      Record<string, string> | null,
      string[] | null,
      Record<string, string> | null,
      Record<string, string> | null,
      Record<string, string> | null,
    ];

    const scores = new Map<string, number>();
    const flat = scoresFlat ?? [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      scores.set(flat[i], toInt(flat[i + 1], 0));
    }

    return Object.values(profiles ?? {})
      .map((json) => JSON.parse(json) as PlayerProfile)
      .map((profile) => ({
        id: profile.id,
        nickname: profile.nickname,
        joinedAt: profile.joinedAt,
        score: scores.get(profile.id) ?? 0,
        streak: toInt(streaks?.[profile.id], 0),
        correctAnswersCount: toInt(correct?.[profile.id], 0),
        connected: connected?.[profile.id] === '1',
      }))
      .sort((a, b) => a.joinedAt - b.joinedAt);
  }

  async setPlayerConnected(pin: string, playerId: string, connected: boolean): Promise<void> {
    await this.client.eval(
      SET_CONNECTED_SCRIPT,
      2,
      this.gamePlayersKey(pin),
      this.gameConnectedKey(pin),
      playerId,
      connected ? '1' : '0',
    );
  }

  async getPlayerCount(pin: string): Promise<number> {
    return this.client.hlen(this.gamePlayersKey(pin));
  }

  /**
   * Applies the result of a question to every player in one MULTI transaction, without any
   * read-modify-write: ZINCRBY for the score, HINCRBY for streak / correct answers, streak reset to 0
   * for wrong answers and non-answerers.
   */
  async applyQuestionResults(pin: string, outcomes: QuestionOutcome[]): Promise<void> {
    if (outcomes.length === 0) return;
    const transaction = this.client.multi();
    for (const outcome of outcomes) {
      if (outcome.isCorrect) {
        transaction.zincrby(this.gameLeaderboardKey(pin), outcome.pointsEarned, outcome.playerId);
        transaction.hincrby(this.gameStreaksKey(pin), outcome.playerId, 1);
        transaction.hincrby(this.gameCorrectKey(pin), outcome.playerId, 1);
      } else {
        transaction.hset(this.gameStreaksKey(pin), outcome.playerId, '0');
      }
    }
    transaction.expire(this.gameLeaderboardKey(pin), GAME_TTL_SECONDS);
    transaction.expire(this.gameStreaksKey(pin), GAME_TTL_SECONDS);
    transaction.expire(this.gameCorrectKey(pin), GAME_TTL_SECONDS);
    await transaction.exec();
  }

  // ========== LEADERBOARD ==========
  async getLeaderboard(pin: string, limit?: number): Promise<Array<{ playerId: string; score: number; rank: number }>> {
    const stop = limit && limit > 0 ? limit - 1 : -1;

    // ZREVRANGE returns highest scores first
    const results = await this.client.zrevrange(this.gameLeaderboardKey(pin), 0, stop, 'WITHSCORES');

    const leaderboard: Array<{ playerId: string; score: number; rank: number }> = [];
    for (let i = 0; i + 1 < results.length; i += 2) {
      leaderboard.push({
        playerId: results[i],
        score: toInt(results[i + 1], 0),
        rank: Math.floor(i / 2) + 1,
      });
    }
    return leaderboard;
  }

  async getPlayerRank(pin: string, playerId: string): Promise<number> {
    // ZREVRANK returns 0-based rank (0 = highest score)
    const rank = await this.client.zrevrank(this.gameLeaderboardKey(pin), playerId);
    return rank !== null ? rank + 1 : 0;
  }

  // ========== ANSWER TRACKING ==========
  /** Read-only check (snapshots). Never use it to decide ALREADY_ANSWERED: recordAnswer is the atomic gate. */
  async hasPlayerAnswered(pin: string, questionIndex: number, playerId: string): Promise<boolean> {
    return (await this.client.hexists(this.gameAnswersKey(pin, questionIndex), playerId)) !== 0;
  }

  async recordAnswer(pin: string, questionIndex: number, answer: AnswerSubmission): Promise<RecordAnswerResult> {
    const result = await this.client.eval(
      RECORD_ANSWER_SCRIPT,
      2,
      this.gameStateKey(pin),
      this.gameAnswersKey(pin, questionIndex),
      String(questionIndex),
      answer.playerId,
      JSON.stringify(answer),
      GAME_TTL_SECONDS,
    );
    return result as RecordAnswerResult;
  }

  async getAnswer(pin: string, questionIndex: number, playerId: string): Promise<AnswerSubmission | null> {
    const data = await this.client.hget(this.gameAnswersKey(pin, questionIndex), playerId);
    return data ? (JSON.parse(data) as AnswerSubmission) : null;
  }

  async getAnswerCount(pin: string, questionIndex: number): Promise<number> {
    return this.client.hlen(this.gameAnswersKey(pin, questionIndex));
  }

  async getAllAnswers(pin: string, questionIndex: number): Promise<AnswerSubmission[]> {
    const answers = await this.client.hgetall(this.gameAnswersKey(pin, questionIndex));
    return Object.values(answers ?? {}).map((a) => JSON.parse(a) as AnswerSubmission);
  }

  /** Vote count per option. Every id of `optionIds` is present (0 if nobody chose it). */
  async getAnswerDistribution(pin: string, questionIndex: number, optionIds: string[] = []): Promise<Record<string, number>> {
    const answers = await this.getAllAnswers(pin, questionIndex);
    const distribution: Record<string, number> = {};
    for (const optionId of optionIds) {
      distribution[optionId] = 0;
    }
    for (const answer of answers) {
      distribution[answer.optionId] = (distribution[answer.optionId] || 0) + 1;
    }
    return distribution;
  }

  // ========== PLAYER TOKEN (RECONNECTION) ==========
  async savePlayerToken(token: string, pin: string, playerId: string): Promise<void> {
    const pipeline = this.client.pipeline();
    pipeline.set(this.playerTokenKey(token), JSON.stringify({ pin, playerId }), 'EX', GAME_TTL_SECONDS);
    pipeline.set(this.pinToTokenKey(pin, playerId), token, 'EX', GAME_TTL_SECONDS);
    await pipeline.exec();
  }

  async getPlayerTokenData(token: string): Promise<{ pin: string; playerId: string } | null> {
    const data = await this.client.get(this.playerTokenKey(token));
    if (!data) return null;
    return JSON.parse(data);
  }

  async getTokenByPlayer(pin: string, playerId: string): Promise<string | null> {
    return this.client.get(this.pinToTokenKey(pin, playerId));
  }

  async deletePlayerToken(token: string): Promise<void> {
    const data = await this.getPlayerTokenData(token);
    if (data) {
      const pipeline = this.client.pipeline();
      pipeline.del(this.playerTokenKey(token));
      pipeline.del(this.pinToTokenKey(data.pin, data.playerId));
      await pipeline.exec();
    }
  }

  // ========== QUESTION TIMER ==========
  async setQuestionTimer(pin: string, questionIndex: number, durationMs: number): Promise<void> {
    const endTime = Date.now() + durationMs;
    await this.client.set(this.gameQuestionTimerKey(pin), endTime.toString(), 'PX', durationMs);
  }

  async getQuestionTimeRemaining(pin: string): Promise<number> {
    const endTimeStr = await this.client.get(this.gameQuestionTimerKey(pin));
    if (!endTimeStr) return 0;
    const endTime = parseInt(endTimeStr, 10);
    return Math.max(0, endTime - Date.now());
  }

  async clearQuestionTimer(pin: string): Promise<void> {
    await this.client.del(this.gameQuestionTimerKey(pin));
  }

  // ========== LOBBY TIMER ==========
  /**
   * Starts the lobby countdown if it is not already running (SET NX): a host re-joining the lobby
   * never resets the deadline. Returns true if a new countdown was started.
   */
  async setLobbyTimer(pin: string, durationMs: number): Promise<boolean> {
    const endTime = Date.now() + durationMs;
    const result = await this.client.set(this.gameLobbyTimerKey(pin), endTime.toString(), 'PX', durationMs, 'NX');
    return result === 'OK';
  }

  async getLobbyTimeRemaining(pin: string): Promise<number> {
    const endTimeStr = await this.client.get(this.gameLobbyTimerKey(pin));
    if (!endTimeStr) return 0;
    const endTime = parseInt(endTimeStr, 10);
    return Math.max(0, endTime - Date.now());
  }

  async clearLobbyTimer(pin: string): Promise<void> {
    await this.client.del(this.gameLobbyTimerKey(pin));
  }

  // ========== CLEANUP ==========
  /** Deletes every Redis key of the game, including host token, nicknames, player tokens and PIN reservation. */
  async deleteGame(pin: string): Promise<void> {
    const keys = [
      this.gameStateKey(pin),
      this.gamePlayersKey(pin),
      this.gameLeaderboardKey(pin),
      this.gameStreaksKey(pin),
      this.gameCorrectKey(pin),
      this.gameConnectedKey(pin),
      this.gameNicknamesKey(pin),
      this.gameHostTokenKey(pin),
      this.gameQuestionTimerKey(pin),
      this.gameLobbyTimerKey(pin),
      this.pinReservedKey(pin),
      this.roomStateKey(pin),
      this.roomParticipantsKey(pin),
    ];

    // Answer keys for all question indices
    const questionCount = await this.getQuestionCount(pin);
    for (let i = 0; i < questionCount; i++) {
      keys.push(this.gameAnswersKey(pin, i));
    }

    // Player tokens of this game
    const playerIds = await this.client.hkeys(this.gamePlayersKey(pin));
    for (const playerId of playerIds ?? []) {
      const token = await this.getTokenByPlayer(pin, playerId);
      keys.push(this.pinToTokenKey(pin, playerId));
      if (token) {
        keys.push(this.playerTokenKey(token));
      }
    }

    await this.client.del(...keys);
    this.logger.log(`Game ${pin} cleaned up from Redis`);
  }

  // ========== PUBSUB FOR REAL-TIME UPDATES ==========
  async publishGameEvent(pin: string, event: string, data: unknown): Promise<void> {
    await this.client.publish(`game:${pin}:events`, JSON.stringify({ event, data, timestamp: Date.now() }));
  }

  async subscribeToGameEvents(pin: string, callback: (event: string, data: unknown) => void): Promise<void> {
    await this.subscriber.subscribe(`game:${pin}:events`);
    this.subscriber.on('message', (channel, message) => {
      if (channel === `game:${pin}:events`) {
        try {
          const parsed = JSON.parse(message);
          callback(parsed.event, parsed.data);
        } catch (e) {
          this.logger.error('Failed to parse game event', e);
        }
      }
    });
  }

  async unsubscribeFromGameEvents(pin: string): Promise<void> {
    await this.subscriber.unsubscribe(`game:${pin}:events`);
  }

  // ========== ROOM STATE MANAGEMENT ==========
  async setRoomState(code: string, state: {
    status: string;
    quizId: string;
    hostId: string;
    maxPlayers: number;
    participants: Array<{
      id: string;
      nickname: string;
      score: number;
      correctAnswersCount: number;
      joinedAt: number;
    }>;
  }): Promise<void> {
    const pipeline = this.client.pipeline();

    pipeline.hset(this.roomStateKey(code), {
      status: state.status,
      quizId: state.quizId,
      hostId: state.hostId,
      maxPlayers: state.maxPlayers.toString(),
      createdAt: Date.now().toString(),
    });

    if (state.participants.length > 0) {
      const participantsMap: Record<string, string> = {};
      for (const p of state.participants) {
        participantsMap[p.id] = JSON.stringify(p);
      }
      pipeline.hset(this.roomParticipantsKey(code), participantsMap);
    }

    pipeline.expire(this.roomStateKey(code), GAME_TTL_SECONDS);
    pipeline.expire(this.roomParticipantsKey(code), GAME_TTL_SECONDS);

    await pipeline.exec();
    this.logger.debug(`Room state set for code: ${code}`);
  }

  async getRoomState(code: string): Promise<{
    status: string;
    quizId: string;
    hostId: string;
    maxPlayers: number;
  } | null> {
    const data = await this.client.hgetall(this.roomStateKey(code));
    if (!data || Object.keys(data).length === 0) return null;

    return {
      status: data.status,
      quizId: data.quizId,
      hostId: data.hostId,
      maxPlayers: parseInt(data.maxPlayers, 10),
    };
  }

  async updateRoomParticipants(code: string, participants: Array<{
    id: string;
    nickname: string;
    score: number;
    correctAnswersCount: number;
    joinedAt: number;
  }>): Promise<void> {
    if (participants.length === 0) return;
    const participantsMap: Record<string, string> = {};
    for (const p of participants) {
      participantsMap[p.id] = JSON.stringify(p);
    }

    const pipeline = this.client.pipeline();
    pipeline.hset(this.roomParticipantsKey(code), participantsMap);
    pipeline.expire(this.roomParticipantsKey(code), GAME_TTL_SECONDS);
    await pipeline.exec();
  }

  async getRoomParticipants(code: string): Promise<Array<{
    id: string;
    nickname: string;
    score: number;
    correctAnswersCount: number;
    joinedAt: number;
  }>> {
    const participants = await this.client.hgetall(this.roomParticipantsKey(code));
    return Object.values(participants).map((p) => JSON.parse(p));
  }

  async deleteRoom(code: string): Promise<void> {
    await this.client.del(this.roomStateKey(code), this.roomParticipantsKey(code));
    this.logger.log(`Room ${code} cleaned up from Redis`);
  }
}

function toInt(value: string | null | undefined, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Unwraps an ioredis pipeline result, throwing the first command error instead of swallowing it. */
function unwrapPipeline(results: Array<[Error | null, unknown]> | null): unknown[] {
  if (!results) {
    throw new Error('Redis pipeline was aborted');
  }
  return results.map(([error, value]) => {
    if (error) throw error;
    return value;
  });
}
