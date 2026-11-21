import { timingSafeEqual } from 'crypto';

/**
 * Constant-time string comparison (for secrets such as host tokens or share tokens).
 * `timingSafeEqual` throws on buffers of different length, so the length is checked first;
 * this leaks only the length, which is fixed for UUID-based tokens.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
