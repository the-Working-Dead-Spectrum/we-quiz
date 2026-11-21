---
id: T-022
title: Redis command budget - no Redis polling in timers, pipelined cleanup (Upstash billed per command)
status: todo
owner: fullstack-devops
author_of_code: (filled by the implementer)
priority: P1
size: S
---

## Context
Redis is Upstash (remote `rediss://`, billed / quota per command, tens of ms per round trip). T-008 timers poll
Redis even when nothing changes (review T-008, debt D-025):
- lobby tick every 1 s: `HGETALL state` + `GET lobby_timer` (`game.gateway.ts` ~559-563) → ~120 commands per lobby;
- answer count every 500 ms: `HLEN answers` + `HLEN players` (~603-610, ~837-843) → ~80 commands per 20 s question;
- `deleteGame` reads each player token with one sequential `GET` per player (`game-redis.service.ts` ~669-676) →
  500 players = 500 round trips (~10-25 s at Upstash latency) at every cleanup.

## User story
As the operator, I want the Redis command count to scale with player actions, not with wall-clock time, so that
the Upstash quota and bill stay predictable and cleanup is fast.

## Acceptance criteria
- [ ] Lobby tick: `remaining` is computed in memory from the deadline returned when the lobby timer is armed
      (`ensureLobbyTimer` stores it next to the interval; after a restart it is re-read once from Redis). The tick
      issues **0** Redis commands; leaving LOBBY is already handled by `clearLobbyTimer` on every exit path. The
      Redis `lobby_timer` key stays the source of truth for snapshots / restart. Unit test (no Redis call per tick).
- [ ] Answer count: ADR 0001 v1 is kept unchanged (broadcast every 500 ms + after each accepted answer), but the
      500 ms broadcast uses in-memory counters (answered count incremented on `recordAnswer` = OK, `totalPlayers`
      captured at question start) → **0** Redis commands per tick. Snapshot paths keep reading Redis. Unit test.
- [ ] `deleteGame`: player tokens fetched with one `MGET` (or one pipeline), then one `DEL`; at most 4 round trips
      whatever the player count. ioredis-mock test with 50 players.
- [ ] Implementation log gives the command count per lobby / per question / per cleanup before and after.

## Out of scope
- Snapshotting questions in Redis (D-001) and removing the per-answer DB read.
- Changing ADR 0001 (no protocol change in this task).
- Multi-instance (D-003): in-memory counters are valid because rooms and timers are already single-instance.

## Technical notes
- Files: `fastquizz-backend/src/modules/game/game.gateway.ts`, `src/common/redis/game-redis.service.ts` (+ specs).
- Same file as T-020 / T-021: run them sequentially (or one `doing` slot for the three, user decision).
- Starts after T-008 is in `qa` or later.

## Estimate
Optimistic 0.3 d / probable 0.5 d / pessimistic 1 d.

## Implementation log
(filled by the implementer)

## Review
(filled by tech-lead-po)

## QA report
(filled by the QA agent)
