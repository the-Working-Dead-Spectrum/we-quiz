---
id: T-012
title: WebSocket protocol integration tests (ADR 0001 happy path, snapshots, scoring)
status: todo
owner: fullstack-devops
author_of_code: (filled by the implementer)
priority: P1
size: M
---

## Context
Follow-up of the T-002 retro review (criteria 2 and 4) and T-001/T-003 reviews. The only gateway test
file (`test/game-gateway.e2e-spec.ts`) does not compile (missing `RoomService`/`ConfigService` providers,
duplicate mock key), calls handlers directly instead of going through a socket, and asserts the pre-ADR
protocol. The live game was broken end to end without any test noticing: the core feature needs a test
that speaks the real wire protocol.
No Docker (user decision 2026-11-20): runs on the T-011 harness = dedicated test DB (`DATABASE_URL_TEST`,
guarded) + `ioredis-mock`.

## User story
As a developer, I want automated tests that open real WebSocket connections and play a game per ADR 0001,
so that any protocol or engine regression is caught before a human plays.

## Acceptance criteria
- [ ] Tests boot the Nest app with `WsAdapter` on a random port, using the T-011 harness: Redis factory overridden with `ioredis-mock`, Prisma on `DATABASE_URL_TEST` (guard of T-011 enforced; never `DATABASE_URL`). Clients connect with the `ws` package to `/game`.
- [ ] Happy path: `host:create_game` (public quiz) → 2 × `player:join` → `host:start_game` → answers (one correct, one wrong, one player silent on a question) → `question:ended` + `player:feedback` for every player (`answered: false` for the silent one) → `host:next_step` → `game:podium`; payloads checked against ADR 0001 §6 field by field, `isCorrect` never present in `question:started`.
- [ ] Snapshots: `host:join_game` and `player:reconnect` mid-question emit the exact sequence of ADR 0001 §7.
- [ ] Room isolation (T-001): broadcasts of game A never reach a socket of game B.
- [ ] Errors: wrong `hostToken` → `HOST_UNAUTHORIZED`; double answer → `ALREADY_ANSWERED` (two concurrent submits from the same player: exactly one accepted); invalid payload → `VALIDATION_ERROR`.
- [ ] Scoring formula (ADR 0001 §8) unit-tested as a pure function (0 ms, half time, multiplier, wrong answer, too slow).
- [ ] Persistence: after podium, one `GameSession` `ENDED` with one `PlayerResult` per player and correct `correctAnswersCount` (T-003), read from the test DB.
- [ ] Redis mock fidelity: if a T-008 Lua script or atomic path (`HSETNX`, `HINCRBY`, `ZINCRBY`) behaves differently on `ioredis-mock` (see T-011 C), the affected test is marked and reported in the Implementation log, never silently skipped; fallback (real Redis with a dedicated key prefix, prefix-only cleanup) only with `tech-lead-po` + user approval. Known case: `HMGET` nils inside Lua are mis-converted by ioredis-mock (fixed in T-008 by using `HGET`; never use `HMGET` in a script). Redis is Upstash (remote, billed per command): the fallback means network calls + quota consumption = sensitive action, explicit user permission each time.
- [ ] `test/game-gateway.e2e-spec.ts`: T-008 rewrote it as a transport test (real `ws`, mocked services) and the review kept it. Extend it or supersede it; deleting it is a user decision.
- [ ] Timers testable: short lobby/question durations injectable for tests, or Jest fake timers - no test sleeps 59 s.
- [ ] Execution requested from the user.

## Out of scope
- Load testing. Frontend. Multi-instance.

## Technical notes
- Files: `fastquizz-backend/test/**`; possibly a small injection point for durations in the gateway (keep it minimal and documented; reused by T-014).
- Conflicts: gateway owned by T-008 → **starts after T-008 is in `qa` or later, and after T-011** (harness, guard, Redis seam).
- Contract: ADR 0001 is the oracle, not the current code.
- Prerequisite: same as T-011 (`fastquizz_test` database + `DATABASE_URL_TEST`, schema pushed with user permission).

## Estimate
Optimistic 1 d / probable 1.5 d / pessimistic 2.5 d.

## Implementation log
(filled by the implementer)

## Review
(filled by tech-lead-po)

## QA report
(filled by the QA agent)
