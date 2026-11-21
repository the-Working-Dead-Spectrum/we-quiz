import { WsException } from '@nestjs/websockets';

/**
 * Error codes sent by the server in the `error` event (ADR 0001 section 9).
 * `MAX_RECONNECT` is client-side only and therefore not listed here.
 */
export const GAME_ERROR_CODES = [
  'VALIDATION_ERROR',
  'QUIZ_NOT_FOUND',
  'QUIZ_INVALID',
  'GAME_NOT_FOUND',
  'HOST_UNAUTHORIZED',
  'INVALID_STATE',
  'NOT_ENOUGH_PLAYERS',
  'LOBBY_EXPIRED',
  'GAME_ALREADY_STARTED',
  'ROOM_FULL',
  'NICKNAME_TAKEN',
  'INVALID_TOKEN',
  'PLAYER_NOT_FOUND',
  'UNAUTHORIZED',
  'INVALID_QUESTION',
  'INVALID_OPTION',
  'ALREADY_ANSWERED',
  'INTERNAL_ERROR',
] as const;

export type GameErrorCode = (typeof GAME_ERROR_CODES)[number];

export interface GameErrorPayload {
  code: GameErrorCode;
  message: string;
}

export function isGameErrorPayload(value: unknown): value is GameErrorPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { code?: unknown; message?: unknown };
  return (
    typeof candidate.code === 'string' &&
    (GAME_ERROR_CODES as readonly string[]).includes(candidate.code) &&
    typeof candidate.message === 'string'
  );
}

/**
 * Domain error carrying an ADR 0001 error code.
 * Extends WsException so that the gateway exception filter forwards `{ code, message }` as is.
 * REST callers (GameController) map it to the matching HTTP exception explicitly.
 */
export class GameError extends WsException {
  constructor(
    public readonly code: GameErrorCode,
    message: string,
  ) {
    super({ code, message });
  }
}
