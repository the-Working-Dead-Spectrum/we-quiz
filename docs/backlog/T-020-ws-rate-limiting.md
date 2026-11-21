---
id: T-020
title: WebSocket rate limiting - per-socket message limit and per-IP anonymous game creation limit
status: todo
owner: fullstack-devops
author_of_code: (filled by the implementer)
priority: P1
size: S
---

## Context
T-008 had to put `@SkipThrottle()` on the game gateway: the global HTTP `ThrottlerGuard` cannot key WS messages
(all sockets in one bucket, response object = message payload). The gateway now has no rate limit at all (debt
D-014). Anonymous `host:create_game` creates one `GameSession` row + Redis state per call, unauthenticated.
Mandatory before any exposure beyond localhost.

## User story
As the operator, I want a single client to be unable to flood the game server or mass-create games, so that a
game in progress stays playable and the database does not grow from abuse.

## Acceptance criteria
- [ ] Given one socket sends more than 20 messages within 1 s (configurable constants in `game-rules.ts`), then the
      extra messages are dropped (handler not executed) and, beyond 3 consecutive windows over the limit, the socket
      is closed with code 1008. Normal play (1 answer per question, host clicks) is never affected. Unit test.
- [ ] Given one client IP (from the upgrade request; `X-Forwarded-For` first hop only if a `TRUST_PROXY` flag is
      set, default off) sends more than 5 `host:create_game` per minute, then the call is refused without creating
      anything. Unit test.
- [ ] No new error code: refused messages are dropped silently (ADR 0001 v1 has no rate-limit code; drop + close
      1008 needs no ADR change). Any new code requires an ADR 0001 amendment by tech-lead-po first.
- [ ] In-memory counters are cleaned on socket close (no leak). Unit test.
- [ ] No IP address written in logs (GDPR); log only "rate limit exceeded" with the pin if bound.

## Out of scope
- Redis-backed / distributed limiter (single instance, D-003).
- Connection-count limit per IP (revisit with deployment / reverse proxy config).
- Re-enabling the global throttler on WS.

## Technical notes
- Implement as a small guard or a check in a gateway-level guard next to `OpenSocketGuard`; fixed window counters
  in a `WeakMap<WebSocket, ...>` and a `Map<ip, ...>` with periodic pruning.
- Files: `fastquizz-backend/src/modules/game/**` only. No new dependency.
- Starts after T-008 is in `qa` or later (same files).

## Estimate
Optimistic 0.3 d / probable 0.5 d / pessimistic 1 d.

## Implementation log
(filled by the implementer)

## Review
(filled by tech-lead-po)

## QA report
(filled by the QA agent)
