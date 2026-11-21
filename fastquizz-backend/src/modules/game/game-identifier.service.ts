import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { GameRedisService } from '../../common/redis/game-redis.service';

/** Room code alphabet: no 0/O/1/I to avoid reading mistakes (ADR 0001 section 2). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const NUMERIC_PIN_LENGTH = 6;
const NUMERIC_PIN_FALLBACK_LENGTH = 8;
const DEFAULT_MAX_ATTEMPTS = 10;

/**
 * Allocates game identifiers (`pin`). A value is returned only if it is not used by
 * GameSession.pin, Room.code, a live Redis game state, and if its Redis reservation
 * (`game:pin:{pin}:reserved`) could be taken atomically.
 */
@Injectable()
export class GameIdentifierService {
  private readonly logger = new Logger(GameIdentifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: GameRedisService,
  ) {}

  /** Anonymous games: 6 digits, 8 digits as last-resort fallback. */
  async allocateNumericPin(maxAttempts = DEFAULT_MAX_ATTEMPTS): Promise<string> {
    const pin = await this.allocate(() => randomDigits(NUMERIC_PIN_LENGTH), maxAttempts);
    if (pin) return pin;

    this.logger.warn(`6-digit PIN space congested after ${maxAttempts} attempts, falling back to 8 digits`);
    const fallback = await this.allocate(() => randomDigits(NUMERIC_PIN_FALLBACK_LENGTH), maxAttempts);
    if (fallback) return fallback;

    throw new Error('Failed to allocate a unique game PIN');
  }

  /** Room games (REST): 6 chars from ROOM_CODE_ALPHABET. */
  async allocateRoomCode(maxAttempts = DEFAULT_MAX_ATTEMPTS): Promise<string> {
    const code = await this.allocate(() => randomFromAlphabet(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH), maxAttempts);
    if (code) return code;
    throw new Error('Failed to generate unique room code after maximum attempts');
  }

  private async allocate(generate: () => string, maxAttempts: number): Promise<string | null> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const candidate = generate();
      if (await this.isUsedInDatabase(candidate)) {
        this.logger.debug(`Identifier collision in database (attempt ${attempt}/${maxAttempts})`);
        continue;
      }
      if (await this.redis.tryReservePin(candidate)) {
        return candidate;
      }
      this.logger.debug(`Identifier collision in Redis (attempt ${attempt}/${maxAttempts})`);
    }
    return null;
  }

  private async isUsedInDatabase(value: string): Promise<boolean> {
    const [session, room] = await Promise.all([
      this.prisma.gameSession.findUnique({ where: { pin: value }, select: { id: true } }),
      this.prisma.room.findUnique({ where: { code: value }, select: { id: true } }),
    ]);
    return session !== null || room !== null;
  }
}

function randomDigits(length: number): string {
  // First digit 1-9: no leading zero, so the PIN reads the same everywhere.
  let result = String(randomInt(1, 10));
  for (let i = 1; i < length; i++) {
    result += String(randomInt(0, 10));
  }
  return result;
}

function randomFromAlphabet(alphabet: string, length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += alphabet.charAt(randomInt(0, alphabet.length));
  }
  return result;
}
