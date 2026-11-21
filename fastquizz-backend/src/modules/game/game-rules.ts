/**
 * Game rules fixed by ADR 0001 section 8. Pure functions and constants only (unit-testable).
 */

export const MIN_PLAYERS_TO_START = 1;
export const LOBBY_DURATION_MS = 59_000;
export const LOBBY_TICK_MS = 1_000;
export const LOBBY_EXPIRED_CLEANUP_DELAY_MS = 5_000;
export const PODIUM_CLEANUP_DELAY_MS = 30_000;
export const ANSWER_COUNT_INTERVAL_MS = 500;
export const DEFAULT_MAX_PLAYERS = 500;
export const LEADERBOARD_TOP_SIZE = 10;
export const PODIUM_SIZE = 3;

export interface PlayableOption {
  isCorrect: boolean;
  colorIndex: number;
}

export interface PlayableQuestion {
  options: PlayableOption[];
}

/** A question is playable if it has 2-4 options, exactly one correct, colorIndex integers 0-3 unique. */
export function isPlayableQuestion(question: PlayableQuestion): boolean {
  const options = question.options ?? [];
  if (options.length < 2 || options.length > 4) return false;
  if (options.filter((option) => option.isCorrect).length !== 1) return false;
  const colors = options.map((option) => option.colorIndex);
  if (!colors.every((color) => Number.isInteger(color) && color >= 0 && color <= 3)) return false;
  return new Set(colors).size === colors.length;
}

/** A quiz is playable if it has at least one question and every question is playable. */
export function isPlayableQuiz(quiz: { questions: PlayableQuestion[] }): boolean {
  return quiz.questions.length >= 1 && quiz.questions.every(isPlayableQuestion);
}

/**
 * Scoring (unchanged by ADR 0001):
 * round(max(0, 1 - elapsed / (2 * timeLimitMs)) * 1000 * pointsMultiplier) if correct, else 0.
 */
export function calculateScore(
  timeElapsedMs: number,
  timeLimitMs: number,
  pointsMultiplier: number,
  isCorrect: boolean,
): number {
  if (!isCorrect || timeLimitMs <= 0) return 0;
  const elapsed = Math.max(0, timeElapsedMs);
  const timeFactor = Math.max(0, 1 - elapsed / (timeLimitMs * 2));
  return Math.max(0, Math.round(timeFactor * 1000 * pointsMultiplier));
}

/** Key used for case-insensitive nickname uniqueness inside a game. */
export function nicknameKey(nickname: string): string {
  return nickname.normalize('NFKC').toLowerCase();
}
