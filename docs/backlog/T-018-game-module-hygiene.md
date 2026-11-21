---
id: T-018
title: Game module hygiene after T-008 - socket re-binding, room ABANDONED status, dead room cache, public game REST projection
status: todo
owner: fullstack-devops
author_of_code: (filled by the implementer)
priority: P2
size: M
---

## Context
Residual defects from the T-001 and T-007 retro reviews that T-008 does not cover:
1. (T-001) A socket that binds to a second game (`player:join` / `host:join_game` / `player:reconnect` on another pin) stays in the first game's room Set: it keeps receiving that game's broadcasts and leaks until cleanup.
2. (T-007) A room whose lobby expires with 0 players stays `LOBBY` forever in PostgreSQL; `ABANDONED` is never set.
3. (T-007) The `room:{code}:state` / `room:{code}:participants` Redis cache is written once and never read nor synced (and `hset(key, {})` is an invalid command). ADR 0001 makes `game:{pin}:*` the single live state: the cache is dead weight.
4. (T-007) `GET /api/games/:code` and `/:code/players` are unauthenticated and return raw Redis records (`hostId` = user id, `quizId`, internal player fields).

## User story
As the product owner, I want the game module to carry no dead code paths nor leaked internals, so that the
next changes are safe and the public endpoints expose only what a lobby screen needs.

## Acceptance criteria
- [ ] Given a socket already bound to pin A, when it binds to pin B (any identity event), then it is removed from room A first (and, if it was a player of A, marked disconnected in A). Unit test.
- [ ] Given a room game (REST-created) whose lobby expires with 0 players, then `Room.status` becomes `ABANDONED` with `endedAt` set. Unit test.
- [ ] `room:{code}:*` Redis cache removed: `setRoomState`, `getRoomState`, `updateRoomParticipants`, `getRoomParticipants`, `deleteRoom` and their calls/tests; `RoomService` methods with no caller after T-008 (`addParticipant`, `removeParticipant`, `getParticipants`, ...) removed or documented as used. Listed in the Implementation log.
- [ ] `GET /api/games/:code` returns only `{ pin, status, quizTitle, questionCount, playerCount }`; `GET /api/games/:code/players` returns only `{ nickname, score }` per player (or both endpoints are removed if the frontend does not call them - check and report, removal = user decision). No `hostId`, `quizId`, `playerId`, token.
- [ ] `POST /api/games/:code/start` (validation-only endpoint, `game.controller.ts`) removed if unused by the frontend, else documented - user decision recorded.
- [ ] (Review T-008 I-2) Given the lobby expires with 0 players, then the game leaves `LOBBY` immediately (terminal
      state via CAS) so that no `player:join` is accepted and no `host:join_game` restarts a countdown during the 5 s
      grace. Unit test.
- [ ] (Review T-008 I-4) Questions are ordered by `orderIndex` then `id` everywhere the game reads them
      (`GameService.loadPlayableQuiz`, `getQuestion`). Unit test with duplicate `orderIndex`.
- [ ] Public `players` endpoints (`GET /api/players/game/:pin`, `/api/players/session/:id`) get the same projection /
      removal decision as the `games` endpoints (debt D-018).
- [ ] Existing specs adapted; execution requested from the user.

> Note (review T-008, 2026-11-20): point 1 (socket re-binding) is solved by T-008 (`bindHost` / `bindPlayer` call
> `releaseSocket`). Re-check and record, no new code expected.

## Out of scope
- Dropping `RoomParticipant.score` / `correctAnswersCount` columns (schema change, debt D-009).
- Room `EXPIRED` cron (T-007 out of scope).

## Technical notes
- Files: `fastquizz-backend/src/modules/game/game.gateway.ts`, `room.service.ts` (+ spec), `game.controller.ts`, `game.service.ts`, `src/common/redis/game-redis.service.ts` (+ spec).
- Conflicts: every file above is rewritten by T-008 → **starts after T-008 is in `qa` or later**. Line numbers in the T-001/T-007 reviews refer to pre-T-008 code: re-check each point against the delivered T-008 code first; drop any point T-008 already solved and record it.
- Frontend usage of the REST endpoints: read-only check in `fastquizz-frontend/src/lib/api.ts`.

## Estimate
Optimistic 0.5 d / probable 0.75 d / pessimistic 1.25 d.

## Implementation log
(filled by the implementer)

## Review
(filled by tech-lead-po)

## QA report
(filled by the QA agent)
