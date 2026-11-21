// Frontend TypeScript types matching backend API and WebSocket events

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface Option {
  id: string;
  text: string;
  isCorrect: boolean;
  colorIndex: number; // 0: Red/Triangle, 1: Blue/Diamond, 2: Yellow/Circle, 3: Green/Square
}

export interface Question {
  id: string;
  quizId: string;
  text: string;
  imageUrl: string | null;
  timeLimit: number;
  pointsMultiplier: number;
  orderIndex: number;
  options: Option[];
}

export interface Quiz {
  id: string;
  title: string;
  description: string | null;
  authorId: string;
  author?: User;
  questions: Question[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateQuizDto {
  title: string;
  description?: string;
  questions: CreateQuestionDto[];
}

export interface CreateQuestionDto {
  text: string;
  imageUrl?: string;
  timeLimit: number;
  pointsMultiplier: number;
  options: CreateOptionDto[];
}

export interface CreateOptionDto {
  text: string;
  isCorrect: boolean;
  colorIndex: number;
}

// ---------------------------------------------------------------------------
// Game protocol types — mirror of docs/adr/0001-websocket-game-protocol.md (v1).
// Payload field names are frozen by the ADR: do not rename, do not add fields.
// Units: `timeLimit` is in seconds, every other duration in milliseconds,
// every timestamp in server epoch milliseconds.
// ---------------------------------------------------------------------------

// ADR 0001 §4 — shared payload types
export type GameStatus = 'LOBBY' | 'QUESTION_ACTIVE' | 'QUESTION_RESULT' | 'PODIUM';

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
  colorIndex: ColorIndex;
}

// ADR 0001 §5 — Client -> Server payloads
export interface HostCreateGamePayload {
  quizId: string;
  shareToken?: string;
}

export interface HostJoinGamePayload {
  pin: string;
  hostToken: string;
}

export interface HostStartGamePayload {
  pin: string;
  hostToken: string;
}

export interface HostNextStepPayload {
  pin: string;
  hostToken: string;
}

export interface PlayerJoinPayload {
  pin: string;
  nickname: string;
}

export interface PlayerReconnectPayload {
  playerToken: string;
}

export interface PlayerSubmitAnswerPayload {
  pin: string;
  questionIndex: number;
  optionId: string;
  playerToken: string;
}

export interface ClientEventMap {
  'host:create_game': HostCreateGamePayload;
  'host:join_game': HostJoinGamePayload;
  'host:start_game': HostStartGamePayload;
  'host:next_step': HostNextStepPayload;
  'player:join': PlayerJoinPayload;
  'player:reconnect': PlayerReconnectPayload;
  'player:submit_answer': PlayerSubmitAnswerPayload;
}

export type ClientEventName = keyof ClientEventMap;

export type ClientEvent = {
  [K in ClientEventName]: { event: K; data: ClientEventMap[K] };
}[ClientEventName];

// ADR 0001 §6 — Server -> Client payloads
export interface HostGameCreatedEvent {
  pin: string;
  quizTitle: string;
  questionCount: number;
  hostToken: string;
}

export interface GameStateChangedEvent {
  status: GameStatus;
  currentQuestionIndex: number;
  questionCount: number;
  timeRemaining: number;
  players: PlayerPublic[];
}

export interface LobbyPlayerJoinedEvent {
  playerId: string;
  nickname: string;
  playerCount: number;
}

export interface LobbyTimerEvent {
  remaining: number;
}

export interface PlayerJoinedEvent {
  playerId: string;
  playerToken: string;
  pin: string;
  nickname: string;
  quizTitle: string;
  questionCount: number;
  players: PlayerPublic[];
}

export interface PlayerStateSyncEvent {
  score: number;
  rank: number;
  streak: number;
  correctAnswersCount: number;
  hasAnsweredCurrentQuestion: boolean;
}

export interface QuestionStartedEvent {
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

export interface QuestionAnswerCountEvent {
  questionIndex: number;
  answeredCount: number;
  totalPlayers: number;
}

export interface PlayerAnswerAcceptedEvent {
  questionIndex: number;
}

export interface QuestionEndedEvent {
  questionIndex: number;
  questionCount: number;
  correctOptionId: string;
  answerDistribution: Record<string, number>;
  leaderboard: LeaderboardEntry[];
}

export interface PlayerFeedbackEvent {
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

export interface GamePodiumEvent {
  podium: LeaderboardEntry[];
  finalLeaderboard: LeaderboardEntry[];
}

// ADR 0001 §9 — error codes (`MAX_RECONNECT` is client-side only)
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'QUIZ_NOT_FOUND'
  | 'QUIZ_INVALID'
  | 'GAME_NOT_FOUND'
  | 'HOST_UNAUTHORIZED'
  | 'INVALID_STATE'
  | 'NOT_ENOUGH_PLAYERS'
  | 'LOBBY_EXPIRED'
  | 'GAME_ALREADY_STARTED'
  | 'ROOM_FULL'
  | 'NICKNAME_TAKEN'
  | 'INVALID_TOKEN'
  | 'PLAYER_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'INVALID_QUESTION'
  | 'INVALID_OPTION'
  | 'ALREADY_ANSWERED'
  | 'INTERNAL_ERROR'
  | 'MAX_RECONNECT';

export interface ErrorEvent {
  code: ErrorCode;
  message: string;
}

export interface ServerEventMap {
  'host:game_created': HostGameCreatedEvent;
  'game:state_changed': GameStateChangedEvent;
  'lobby:player_joined': LobbyPlayerJoinedEvent;
  'lobby:timer': LobbyTimerEvent;
  'player:joined': PlayerJoinedEvent;
  'player:state_sync': PlayerStateSyncEvent;
  'question:started': QuestionStartedEvent;
  'question:answer_count': QuestionAnswerCountEvent;
  'player:answer_accepted': PlayerAnswerAcceptedEvent;
  'question:ended': QuestionEndedEvent;
  'player:feedback': PlayerFeedbackEvent;
  'game:podium': GamePodiumEvent;
  error: ErrorEvent;
}

export type ServerEventName = keyof ServerEventMap;

export type ServerEvent = {
  [K in ServerEventName]: { event: K; data: ServerEventMap[K] };
}[ServerEventName];

// ADR 0001 §10 — REST `POST /api/games` response
export interface CreateGameResponse {
  roomCode: string;
  pin: string;
  quizTitle: string;
  questionCount: number;
  hostToken: string;
}

// API Response types
export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// Answer color/shape mapping. Class names are spelled out in full so Tailwind keeps them.
// `text` is the readable text color on `bg` (dark text on yellow).
export const COLOR_CONFIG = [
  { index: 0, name: 'red', bg: 'bg-answer-red', text: 'text-white', border: 'border-answer-red', shape: 'triangle', label: 'Triangle' },
  { index: 1, name: 'blue', bg: 'bg-answer-blue', text: 'text-white', border: 'border-answer-blue', shape: 'diamond', label: 'Losange' },
  { index: 2, name: 'yellow', bg: 'bg-answer-yellow', text: 'text-gray-950', border: 'border-answer-yellow', shape: 'circle', label: 'Cercle' },
  { index: 3, name: 'green', bg: 'bg-answer-green', text: 'text-white', border: 'border-answer-green', shape: 'square', label: 'Carré' },
] as const;

export type ColorIndex = 0 | 1 | 2 | 3;
export type ColorName = 'red' | 'blue' | 'yellow' | 'green';

/**
 * Clamp any number to a valid color index (0-3). Helpers accept plain numbers so
 * call sites (`{#each [0,1,2,3] as idx}`, server payloads) need no casts.
 */
export function toColorIndex(index: number): ColorIndex {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(3, Math.trunc(index))) as ColorIndex;
}

export function getColorConfig(index: number) {
  return COLOR_CONFIG[toColorIndex(index)];
}

export function getColorClass(index: number): string {
  return getColorConfig(index).bg;
}

export function getTextClass(index: number): string {
  return getColorConfig(index).text;
}

export function getBorderClass(index: number): string {
  return getColorConfig(index).border;
}

/**
 * Decorative shape icon (aria-hidden), drawn in `currentColor` so it follows the tile text color.
 * `sizeClass` lets the container decide the size (default fits the 40–48px answer badge).
 */
export function getShapeSvg(index: number, sizeClass = 'w-6 h-6'): string {
  const shape = getColorConfig(index).shape;
  const attrs = `class="${sizeClass}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"`;

  switch (shape) {
    case 'triangle':
      return `<svg ${attrs}><path d="M12 3.5 22 20.5H2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    case 'diamond':
      return `<svg ${attrs}><path d="M12 2 22 12 12 22 2 12z"/></svg>`;
    case 'circle':
      return `<svg ${attrs}><circle cx="12" cy="12" r="9.5"/></svg>`;
    case 'square':
      return `<svg ${attrs}><rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/></svg>`;
    default:
      return '';
  }
}