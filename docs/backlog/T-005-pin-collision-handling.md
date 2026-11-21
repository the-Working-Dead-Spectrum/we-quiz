---
id: T-005
title: PIN Collision Handling & Uniqueness Guarantee
status: qa
owner: fullstack-devops
author_of_code: fullstack-devops
priority: P1
size: S
---

## Context
`generatePin()` in `GameService` (line 84-86) and `GameGateway` (line 693-695) uses `Math.random()` for 6-digit PIN (900,000 combinations). No collision check - duplicate PIN overwrites existing game in Redis. At scale or with many concurrent games, collision probability increases (birthday paradox: ~50% at ~1100 games).

## User story
As a host, I want a guaranteed unique PIN when creating a game, so that I never accidentally overwrite another host's game.

## Acceptance criteria
- [ ] Centralize PIN generation in `GameRedisService` with atomic check-and-set
- [ ] Use Redis `SETNX` (SET IF NOT EXISTS) with TTL for atomic uniqueness
- [ ] Retry loop (max 10 attempts) with new random PIN on collision
- [ ] Fallback: if exhausted, use UUID-based short code (nanoid 8 chars)
- [ ] Remove duplicate `generatePin()` from `GameGateway`
- [ ] Unit test collision handling

## Out of scope
- Custom PIN entry by host (future feature)
- PIN reuse after game cleanup (acceptable)

## Technical notes
- Files: `game-redis.service.ts` (add `generateUniquePin()`), `game.service.ts`, `game.gateway.ts`
- Redis key: `game:pin:{pin}:reserved` with TTL 24h (or reuse game state key existence check)
- Implementation:
  ```typescript
  async generateUniquePin(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const pin = Math.floor(100000 + Math.random() * 900000).toString();
      const reserved = await this.client.set(`game:pin:${pin}:reserved`, '1', 'EX', 86400, 'NX');
      if (reserved) return pin;
    }
    // Fallback: nanoid
    return nanoid(8).toUpperCase();
  }
  ```
- Requires `nanoid` dependency

## Implementation log
1. **`game-redis.service.ts`**:
   - Added `generateUniquePin()` method with atomic collision check using Redis `SET NX`
   - Retry loop with max 10 attempts on collision
   - Fallback to 8-character alphanumeric code (A-Z, 0-9) after exhausted retries
   - Added `pinReservedKey()` helper for Redis key generation

2. **`game.service.ts`**:
   - Replaced local `generatePin()` with `await this.redis.generateUniquePin()`
   - Removed duplicate `generatePin()` method

3. **`game.gateway.ts`**:
   - Replaced local `generatePin()` with `await this.redis.generateUniquePin()`
   - Removed duplicate `generatePin()` method

4. **Tests**:
   - Added 3 unit tests for `generateUniquePin()` in `game-redis.service.spec.ts`:
     - First attempt success
     - Collision retry (2nd attempt success)
     - Fallback after 10 collisions
   - Updated `game.service.spec.ts` to mock `generateUniquePin`

All tests pass (54/54). Build successful.

## Review
Retroactive review - tech-lead-po - 2026-11-20. Task had been set to `done` without review nor QA (DoD not met).
Line numbers refer to the pre-T-008 code (`game-redis.service.ts` and the gateway are being modified by T-008).

Verdict: APPROUVÉ SOUS RÉSERVE - 5/6 OK; the fallback gap is covered by T-008.

| # | Criterion | Verdict | Evidence / follow-up |
|---|---|---|---|
| 1 | Centralized in `GameRedisService` | OK | game-redis.service.ts:143-162; used by game.service.ts:32 and gateway:116/208/395. Room codes still have their own generator (room.service.ts:188-209) that ignores Redis reservations - covered by T-008 B. |
| 2 | Atomic `SET NX` with TTL | OK | game-redis.service.ts:150 (`EX 86400 NX`) |
| 3 | Retry max 10 | OK | game-redis.service.ts:144-156 |
| 4 | Fallback short code | Partial | 8-char fallback (164-171) is **not reserved** (no `SET NX`) → uniqueness not guaranteed; charset includes ambiguous `I/O/0/1`. ADR 0001 §2 mandates an 8-digit fallback for anonymous games. Covered by T-008 B ("PIN/room code generation never returns a value that exists in ..."). Not using `nanoid` (no new dependency) is accepted. |
| 5 | Duplicate `generatePin()` removed from gateway | OK | no `generatePin` left in gateway / service |
| 6 | Unit tests for collisions | OK | game-redis.service.spec.ts:355-393 (first try, retry, fallback) |

### Mineur
- The reservation key `game:pin:{pin}:reserved` is never deleted by `deleteGame` (475-504): the PIN stays blocked 24 h after cleanup. Covered by T-008 E (cleanup deletes the reservation key).
- `Math.random` is not a CSPRNG. Acceptable: the PIN is an identifier, not a secret (host authority is the `hostToken`, ADR 0001 §3).

Prochaine action: QA recette after T-008 lands.

## QA report
(filled by the QA agent)

Note (tech-lead-po, 2026-11-20): QA recette is scheduled AFTER T-008 is delivered (PIN generation and cleanup are being modified). Recette: unit tests green + manual: two games created in a row get different PINs; after cleanup the reservation key is gone.