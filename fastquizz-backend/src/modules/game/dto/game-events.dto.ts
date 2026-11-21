import { IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import { Transform, TransformFnParams } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * WebSocket protocol v1 - ADR 0001 (docs/adr/0001-websocket-game-protocol.md).
 * Client DTOs are validated by the gateway ValidationPipe (whitelist + forbidNonWhitelisted):
 * any missing / extra / ill-typed field -> `error { code: 'VALIDATION_ERROR' }`.
 *
 * Every transform below reads the RAW value from the source object (`obj[key]`). This deliberately
 * cancels the global `enableImplicitConversion` (main.ts), so that `pin: 123456` or `questionIndex: "1"`
 * are rejected as wrong types instead of being silently coerced.
 */

export const PIN_PATTERN = /^[A-Z0-9]{6,8}$/;
// No control characters (C0/C1) nor line/paragraph separators.
export const NICKNAME_PATTERN = /^[^\p{Cc}\p{Zl}\p{Zp}]+$/u;

const rawValue = ({ obj, key }: TransformFnParams): unknown => (obj as Record<string, unknown>)[key];

/** ADR 0001 section 2: the server trims and upper-cases every inbound pin before validation. */
const normalizePin = (params: TransformFnParams): unknown => {
  const value = rawValue(params);
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
};

const trimString = (params: TransformFnParams): unknown => {
  const value = rawValue(params);
  return typeof value === 'string' ? value.trim() : value;
};

// ========== CLIENT -> SERVER EVENTS ==========

export class HostCreateGameDto {
  @ApiProperty({ description: 'Quiz ID (uuid)' })
  @Transform(rawValue)
  @IsUUID()
  quizId: string;

  @ApiProperty({ description: 'Quiz share token, required for a non-public quiz', required: false })
  @Transform(rawValue)
  @IsOptional()
  @IsString()
  @Length(1, 128)
  shareToken?: string;
}

class HostGameActionDto {
  @ApiProperty({ description: 'Game PIN (6-8 alphanumeric chars)' })
  @Transform(normalizePin)
  @IsString()
  @Matches(PIN_PATTERN, { message: 'pin must be 6 to 8 alphanumeric characters' })
  pin: string;

  @ApiProperty({ description: 'Host token returned at game creation (uuid v4)' })
  @Transform(rawValue)
  @IsUUID('4', { message: 'hostToken must be a valid token' })
  hostToken: string;
}

export class HostJoinGameDto extends HostGameActionDto {}

export class HostStartGameDto extends HostGameActionDto {}

export class HostNextStepDto extends HostGameActionDto {}

export class PlayerJoinDto {
  @ApiProperty({ description: 'Game PIN (6-8 alphanumeric chars)' })
  @Transform(normalizePin)
  @IsString()
  @Matches(PIN_PATTERN, { message: 'pin must be 6 to 8 alphanumeric characters' })
  pin: string;

  @ApiProperty({ description: 'Player nickname (1-20 chars, trimmed)' })
  @Transform(trimString)
  @IsString()
  @Length(1, 20)
  @Matches(NICKNAME_PATTERN, { message: 'nickname must not contain control characters' })
  nickname: string;
}

export class PlayerReconnectDto {
  @ApiProperty({ description: 'Player token returned by player:joined (uuid v4)' })
  @Transform(rawValue)
  @IsUUID('4', { message: 'playerToken must be a valid token' })
  playerToken: string;
}

export class PlayerSubmitAnswerDto {
  @ApiProperty({ description: 'Game PIN (6-8 alphanumeric chars)' })
  @Transform(normalizePin)
  @IsString()
  @Matches(PIN_PATTERN, { message: 'pin must be 6 to 8 alphanumeric characters' })
  pin: string;

  @ApiProperty({ description: 'Question index (integer >= 0)' })
  @Transform(rawValue)
  @IsInt()
  @Min(0)
  questionIndex: number;

  @ApiProperty({ description: 'Selected option ID (uuid)' })
  @Transform(rawValue)
  @IsUUID()
  optionId: string;

  @ApiProperty({ description: 'Player token (uuid v4)' })
  @Transform(rawValue)
  @IsUUID('4', { message: 'playerToken must be a valid token' })
  playerToken: string;
}

// ========== SHARED / SERVER -> CLIENT PAYLOADS (ADR 0001 sections 4 and 6) ==========

export enum GameStatus {
  LOBBY = 'LOBBY',
  QUESTION_ACTIVE = 'QUESTION_ACTIVE',
  QUESTION_RESULT = 'QUESTION_RESULT',
  PODIUM = 'PODIUM',
}

export interface PlayerPublic {
  id: string;
  nickname: string;
  score: number;
  streak: number;
  correctAnswersCount: number;
  connected: boolean;
  joinedAt: number;
}

export interface LeaderboardEntry {
  playerId: string;
  nickname: string;
  score: number;
  rank: number;
  correctAnswersCount: number;
}

export interface QuestionOption {
  id: string;
  text: string;
  colorIndex: number;
}

export interface HostGameCreatedPayload {
  pin: string;
  quizTitle: string;
  questionCount: number;
  hostToken: string;
}

export interface GameStateChangedPayload {
  status: GameStatus;
  currentQuestionIndex: number;
  questionCount: number;
  timeRemaining: number;
  players: PlayerPublic[];
}

export interface LobbyPlayerJoinedPayload {
  playerId: string;
  nickname: string;
  playerCount: number;
}

export interface LobbyTimerPayload {
  remaining: number;
}

export interface PlayerJoinedPayload {
  playerId: string;
  playerToken: string;
  pin: string;
  nickname: string;
  quizTitle: string;
  questionCount: number;
  players: PlayerPublic[];
}

export interface PlayerStateSyncPayload {
  score: number;
  rank: number;
  streak: number;
  correctAnswersCount: number;
  hasAnsweredCurrentQuestion: boolean;
}

export interface QuestionStartedPayload {
  questionIndex: number;
  questionCount: number;
  questionText: string;
  imageUrl: string | null;
  timeLimit: number;
  pointsMultiplier: number;
  options: QuestionOption[];
  questionStartTime: number;
  serverTime: number;
}

export interface QuestionAnswerCountPayload {
  questionIndex: number;
  answeredCount: number;
  totalPlayers: number;
}

export interface PlayerAnswerAcceptedPayload {
  questionIndex: number;
}

export interface QuestionEndedPayload {
  questionIndex: number;
  questionCount: number;
  correctOptionId: string;
  answerDistribution: Record<string, number>;
  leaderboard: LeaderboardEntry[];
}

export interface PlayerFeedbackPayload {
  questionIndex: number;
  answered: boolean;
  isCorrect: boolean;
  pointsEarned: number;
  totalScore: number;
  rank: number;
  streak: number;
  correctAnswersCount: number;
  correctOptionId: string;
}

export interface GamePodiumPayload {
  podium: LeaderboardEntry[];
  finalLeaderboard: LeaderboardEntry[];
}

// ========== WEBSOCKET EVENT NAMES ==========
export const ClientEvents = {
  HOST_CREATE_GAME: 'host:create_game',
  HOST_JOIN_GAME: 'host:join_game',
  HOST_START_GAME: 'host:start_game',
  HOST_NEXT_STEP: 'host:next_step',
  PLAYER_JOIN: 'player:join',
  PLAYER_RECONNECT: 'player:reconnect',
  PLAYER_SUBMIT_ANSWER: 'player:submit_answer',
} as const;

export const ServerEvents = {
  HOST_GAME_CREATED: 'host:game_created',
  GAME_STATE_CHANGED: 'game:state_changed',
  LOBBY_PLAYER_JOINED: 'lobby:player_joined',
  LOBBY_TIMER: 'lobby:timer',
  PLAYER_JOINED: 'player:joined',
  PLAYER_STATE_SYNC: 'player:state_sync',
  QUESTION_STARTED: 'question:started',
  QUESTION_ANSWER_COUNT: 'question:answer_count',
  PLAYER_ANSWER_ACCEPTED: 'player:answer_accepted',
  QUESTION_ENDED: 'question:ended',
  PLAYER_FEEDBACK: 'player:feedback',
  GAME_PODIUM: 'game:podium',
  ERROR: 'error',
} as const;
