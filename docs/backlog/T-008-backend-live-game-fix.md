---
id: T-008
title: Backend - make the live game work end to end (WS transport, protocol v1, host token, game engine robustness)
status: qa
owner: fullstack-devops
author_of_code: fullstack-devops
priority: P0
size: L
---

## Context
The live game cannot be played today: the server runs Socket.IO while every client uses native WebSocket,
DTO validation is broken, room-code games point to a Redis state that does not exist, results are never
saved, any socket can take over a game as host, and several race conditions corrupt scores.
This task fixes the backend side against the protocol contract in
`docs/adr/0001-websocket-game-protocol.md` (ADR 0001, normative). The frontend is fixed in parallel in
T-009 against the same contract.

## User story
As a host (with or without an account) and as a player, I want to create, join, play and finish a game
reliably, so that the product's core feature actually works and cannot be hijacked.

## File ownership (strict - parallel work)
- Allowed: `fastquizz-backend/**` EXCEPT `fastquizz-backend/src/modules/quiz/**` (owned by T-010).
- Forbidden: `fastquizz-frontend/**`, `docs/adr/**`, `docs/tech-debt.md`, root `package.json`, any `.env*`.
- Contract ambiguity → stop and ask `tech-lead-po`; do not reinterpret ADR 0001.

## Acceptance criteria

### A. Transport and validation (B1, B2, S4)
- [x] Given the server starts, when a browser opens `new WebSocket('ws://localhost:3000/game')`, then the connection is accepted by the `ws` server (`main.ts` registers `WsAdapter`; gateway uses `path: '/game'`, no `namespace`, no `transports`, no `cors: '*'`).
- [x] Given an upgrade with an `Origin` header different from `app.frontendUrl`, then the socket is closed with code 1008. No `Origin` header → accepted.
- [x] Given a payload with a `pin` of 6, 7 or 8 alphanumeric chars (any case, surrounding spaces), then it passes validation and is normalized to upper case; 5 or 9 chars fail. All `@Min/@Max` on strings replaced by `@Length` / `@Matches`; `nickname` trimmed, `@Length(1, 20)`, no control chars.
- [x] Given any invalid payload or extra field on any client event, then the client receives `{"event":"error","data":{"code":"VALIDATION_ERROR","message":...}}` and the handler is not executed. Implemented with a gateway-level `@UseFilters` catch-all filter that `client.send()`s the JSON envelope (Nest's `BaseWsExceptionFilter` calls `client.emit('exception')`, which sends nothing over `ws`). The filter maps: `WsException` carrying `{code,message}` → as is; `BadRequestException` (from the global or gateway `ValidationPipe`) → `VALIDATION_ERROR`; anything else → `INTERNAL_ERROR` (logged server-side, no stack sent).
- [x] DTOs match ADR 0001 section 5 exactly: `HostCreateGameDto { quizId, shareToken? }` (no `hostId`), `HostJoinGameDto/HostStartGameDto/HostNextStepDto { pin, hostToken }`, `PlayerJoinDto { pin, nickname }` (no `playerToken`), `PlayerReconnectDto`, `PlayerSubmitAnswerDto` (`questionIndex` `@IsInt @Min(0)`).
- [x] `game-redis.service.ts`: TLS `rejectUnauthorized: true` (no opt-out env var in this task).
- [x] Should: `maxPayload` of 16 KB on the WS server.

### B. Single game identifier and persistence (B5, M7, schema)
- [x] `prisma/schema.prisma` edited (NOT executed): `Room.code` `@db.VarChar(8)`; `GameSession.pin` `@db.VarChar(8)`; `GameSession.hostId String?` and `host User?` (relation optional). The exact command for the user is written in the Implementation log (see Technical notes).
- [x] A single creation path in `GameService` (e.g. `createGame({ quizId, hostUserId | null, roomId | null, pin })`) used by both REST `POST /api/games` and WS `host:create_game`: validates the quiz is playable (ADR 0001 §8), writes Redis state (incl. `maxPlayers`, `roomId`), creates the `GameSession` row (`status LOBBY`, `hostId` null for anonymous, `roomId` for rooms), generates and stores the `hostToken`.
- [x] REST: `pin === room.code`; Redis state and `GameSession.pin` use that same value. `host:join_game` / `player:join` / `player:reconnect` resolve the game ONLY via the Redis state of `pin`; the code paths that created a second `GameSession` with a new pin (gateway ~206-218, ~393-407) are removed. `room.quiz.questions` is no longer read.
- [x] `game.controller.ts`: uses a validated DTO class for the body, no `gameService['prisma']` / `['redis']` / `['startLobbyTimer']` private access, returns ADR 0001 §10 response (incl. `hostToken`), 404 if quiz missing or not owned/public, 422 if quiz not playable. Does not start the lobby timer (first `host:join_game` does). `GameService.startLobbyTimer` removed if dead.
- [x] PIN/room code generation never returns a value that exists in Redis reservation, Redis game state, `GameSession.pin` or `Room.code` (room-code generator also takes the Redis reservation `game:pin:{code}:reserved`).
- [x] Given a game reaches the podium (anonymous or room), then `GameSession` is updated to `ENDED` with `startedAt`, `endedAt` and one `PlayerResult` per player (no FK violation). Room status goes `LOBBY → IN_PROGRESS` at start and `ENDED` at podium.

### C. Host token (S1)
- [x] `hostToken` = uuid v4, Redis `game:{pin}:host_token`, same TTL as the game, deleted on cleanup, compared with `crypto.timingSafeEqual` (length-checked).
- [x] `host:join_game`, `host:start_game`, `host:next_step` reject a missing token (`VALIDATION_ERROR`) and a wrong token (`HOST_UNAUTHORIZED`) - verified on every call, not only on join.
- [x] `host:create_game` only for a public quiz or with a matching `shareToken`, else `QUIZ_NOT_FOUND`.
- [x] `host:join_game` works in every status and sends the exact host snapshot of ADR 0001 §7.

### D. Players (M6, B3 server side)
- [x] `player:join` emits the exact sequence of ADR 0001 §7; `player:joined` contains `questionCount`, `quizTitle`, `nickname`, `pin`.
- [x] Nickname uniqueness per game, case-insensitive, atomic (e.g. `HSETNX game:{pin}:nicknames <lowercased> <playerId>`), for anonymous AND room games → `NICKNAME_TAKEN`. Prisma `P2002` on `RoomParticipant` also maps to `NICKNAME_TAKEN`, never `INTERNAL_ERROR`.
- [x] Room full → `ROOM_FULL`; game not in LOBBY → `GAME_ALREADY_STARTED` (no more swallowed `GAME_NOT_FOUND`, gateway ~374-385).
- [x] `player:reconnect` emits the exact sequence of ADR 0001 §7 (incl. `player:joined`, `player:feedback` in QUESTION_RESULT, final `player:state_sync` with `hasAnsweredCurrentQuestion`) and never creates a player.
- [x] `player:submit_answer`: `playerToken` must equal the socket's token; `optionId` must belong to the current question (`INVALID_OPTION`).

### E. Game engine (B7 runtime, M1 server side, M8, M10, M11, m1, m2)
- [x] Answer recording is atomic: `HSETNX` on the answers hash decides `ALREADY_ANSWERED` (no separate `hasPlayerAnswered` check). The stored answer includes `isCorrect` and `pointsEarned`.
- [x] Player score / streak / correctAnswersCount / connected updates have no read-modify-write race (Lua script on the JSON, or separate fields with `HINCRBY`; leaderboard via `ZINCRBY`). Two concurrent updates on the same player never lose one.
- [x] On submit the player receives only `player:answer_accepted`. At question end the server broadcasts `question:ended` (ADR payload: `questionIndex`, `questionCount`, distribution with every option id, top-10 leaderboard) then sends `player:feedback` to every player socket, `answered: false` for non-answerers (streak reset to 0).
- [x] `question:started` contains `questionCount` and `serverTime`, options sorted by `colorIndex`, no `isCorrect`.
- [x] Given a question without exactly one correct option mid-game, then `error QUIZ_INVALID` is broadcast and the podium is shown - the game never freezes (gateway ~697-698, ~753-754).
- [x] Lobby timer is cleared whenever the game leaves LOBBY by any path (`host:start_game`, `host:next_step`, auto-start). `host:next_step` in LOBBY → `INVALID_STATE`.
- [x] `cleanupGame` clears every question timer of the pin (keys `${pin}:${index}`), the answer-count interval (`clearInterval`), the lobby timer, and deletes Redis game keys, host token, nickname hash and the PIN reservation key.
- [x] Every `@SubscribeMessage` handler and every timer/interval callback is wrapped so no promise rejection is unhandled (timer callbacks: try/catch + log; handlers: the catch-all filter).
- [x] `MIN_PLAYERS_TO_START = 1` used by manual start and auto-start; 0 players at lobby expiry → broadcast `LOBBY_EXPIRED`, cleanup after 5 s.
- [x] `handleDisconnect` log precedence fixed (gateway ~89).

### F. Tests and docs
- [x] Unit tests updated/added for: DTO validation (pin 6/8 ok, 5/9 ko, nickname trim/length), host token check (missing/wrong/right), nickname uniqueness, double answer → `ALREADY_ANSWERED`, feedback for non-answerer, unplayable question → podium, cleanup clears timers. Existing specs (`game.service.spec`, `game-redis.service.spec`, `room.service.spec`) adapted. Execution is requested from the user.
- [x] `fastquizz-backend/README.md` (or existing backend doc) updated: WS URL/path, protocol pointer to ADR 0001, schema command to run.
- [x] Build passes (`nest build`) - execution requested from the user. (Verified 2026-11-20 by the main session with user permission: `prisma db push` OK, `prisma generate` OK, `npm run build` 0 errors. `npm test`: 261/263, see Review B1.)

## Out of scope
- Quiz REST API (`src/modules/quiz/**`) - T-010.
- Any frontend change - T-009.
- New features: kick player, end question early, `lobby:player_left`, JWT on WebSocket, multi-instance.
- Snapshotting quiz questions in Redis at game start (debt, see `docs/tech-debt.md`).
- Removing `@nestjs/platform-socket.io`, `socket.io`, root `package.json` / `node_modules` (user decisions).
- Running any migration, install, build or test without explicit user permission.

## Technical notes
- Contract: `docs/adr/0001-websocket-game-protocol.md`. Payload field names are frozen.
- Findings referenced (file:line from the review): gateway 89, 117, 164-293, 300-355, 374-407, 572-679, 697-698, 878, 902-923, 1154; `game-events.dto.ts` 13-85; `game.controller.ts` 27-52; `game-redis.service.ts` 62, 143-160, 292-336; `schema.prisma` 97-109, 119.
- Schema command (to give the user, not to run): `cd fastquizz-backend && npx prisma migrate dev --name relax_pin_and_optional_host` then `npx prisma generate`.
  **Pitfall:** T-007 built the local DB with `prisma db push` and `prisma/migrations` is gitignored, so `migrate dev` will very likely detect drift and propose a database reset (local data loss). Write this warning in the Implementation log and offer the alternative `npx prisma db push` (no `--accept-data-loss`) + `npx prisma generate`. The user chooses. Postgres `char(8) → varchar(8)` cast drops the padding spaces, which is the desired effect.
- Until the user runs `prisma generate`, TypeScript types still say `hostId: string`; note it, do not hack around it with `any`.
- `@nestjs/websockets` is imported but not declared in `package.json` (resolved transitively). Adding it explicitly is a dependency change: ask the user, not blocking.
- Keep the PR reviewable: deliver in two checkpoints recorded in the Implementation log - (1) sections A-D, (2) sections E-F - each with its list of touched files and approximate diff size.
- Debt discovered: list it in the Implementation log; `tech-lead-po` consolidates `docs/tech-debt.md`.

## Estimate
Optimistic 1.5 d / probable 2.5 d / pessimistic 4 d (hypotheses: no Nest WsAdapter surprise, Prisma client regenerated by the user on day 1, existing specs mostly reusable).

## Implementation log
Implementer: `fullstack-devops`, 2026-11-20. **No command was executed** (no build, no test, no prisma): every
box above is checked on code review only; F3 (build) stays open until the user runs the commands below.
Checked criteria are "implemented", not "verified".

### Checkpoint 1 - sections A-D (approx. +1 700 / -900 lines incl. rewrites)
- `prisma/schema.prisma` - Room.code / GameSession.pin VarChar(8), GameSession.hostId optional (NOT applied).
- `src/main.ts` - `app.useWebSocketAdapter(new WsAdapter(app))`.
- `src/modules/game/dto/game-events.dto.ts` - rewritten: ADR §5 client DTOs (pin trim+upper + `^[A-Z0-9]{6,8}$`,
  nickname trim / 1-20 / no control chars, hostToken & playerToken uuid v4, questionIndex IsInt Min 0) and ADR §4/§6
  payload interfaces. Transforms read the raw value, which cancels the global `enableImplicitConversion` on WS
  (`pin: 123456` or `questionIndex: "1"` are rejected, as ADR §5 requires).
- `src/modules/game/dto/create-game.dto.ts` (new) - REST body / response DTOs (ADR §10).
- `src/modules/game/game-errors.ts` (new) - ADR §9 codes, `GameError extends WsException({code,message})`.
- `src/modules/game/game-ws-exception.filter.ts` (new) - catch-all filter, `client.send()` of the `error` envelope.
- `src/modules/game/open-socket.guard.ts` (new) - drops frames from a socket already closing (origin-rejected).
- `src/common/security/safe-equal.ts` (new) - length-checked `timingSafeEqual`.
- `src/common/redis/game-redis.service.ts` - rewritten: TLS `rejectUnauthorized: true`; host token key; atomic
  Lua join (status + capacity + HSETNX nickname); profile JSON + counters in HINCRBY/ZINCRBY structures; CAS state
  transitions; PIN reservation (`tryReservePin`); `deleteGame` deletes every key (host token, nicknames, counters,
  reservation, player tokens, room keys). Removed all read-modify-write methods and `generateUniquePin`.
- `src/modules/game/game-identifier.service.ts` (new) - pin / room code allocation checked against GameSession.pin,
  Room.code, Redis state and Redis reservation (8 **digits** fallback, ADR §2; was alphanumeric).
- `src/modules/game/room.service.ts` - code from the allocator; `createParticipant` (P2002 -> NICKNAME_TAKEN).
- `src/modules/game/game.service.ts` - rewritten: single creation path (`createAnonymousGame` / `createRoomGame` ->
  private `createGame`), playability check, `verifyHostToken`, `getQuestion` (by position, ordered by orderIndex),
  `markGameStarted`, `finalizeGame`; `startLobbyTimer` removed.
- `src/modules/game/game.controller.ts` - validated DTO, ADR §10 response, 404 / 422 mapping, no private access.
- `src/modules/game/game.module.ts` - registers `GameIdentifierService`.
- `.env.example` - comment only (FRONTEND_URL also drives the WS Origin check).

### Checkpoint 2 - sections E-F (approx. +1 500 lines, mostly tests)
- `src/modules/game/game.gateway.ts` - rewritten against ADR 0001: `path: '/game'`, `maxPayload` 16 KB, Origin check
  (1008), gateway-level filter / guard / ValidationPipe, `@SkipThrottle()` (see decisions), host token on every host
  event, exact §7 snapshots, atomic submit, deferred scoring + feedback to every player, CAS-protected transitions,
  QUIZ_INVALID -> podium, lobby timer cleared on every exit from LOBBY, full timer cleanup, `runSafely` wrapper on
  every timer / interval / fire-and-forget, `MIN_PLAYERS_TO_START = 1`, LOBBY_EXPIRED + 5 s cleanup, disconnect log fixed.
- `src/modules/game/game-rules.ts` (new) - constants, playability, scoring, nickname key.
- Tests: `game.gateway.spec.ts` (new), `game-events.dto.spec.ts` (new), `game-ws-exception.filter.spec.ts` (new),
  `game-rules.spec.ts` (new), `game-identifier.service.spec.ts` (new), `game-redis.lua.spec.ts` (new, runs the real
  Lua scripts on `ioredis-mock`), `game.service.spec.ts` / `game-redis.service.spec.ts` / `room.service.spec.ts` adapted.
- `test/game-gateway.e2e-spec.ts` - rewritten as a real transport test (WsAdapter, real `ws` client, mocked services,
  no DB / Redis): path, Origin 1008, VALIDATION_ERROR / GameError / INTERNAL_ERROR mapping.
- `test/game.e2e-spec.ts` - adapted to `/api/games`, ADR §10 response, `/api/quizzes`, `name` / `token` of auth.
- `test/setup.ts` - pre-existing compile errors fixed (imported a non-existent `RedisService`, `request` shadowing);
  AppModule imported lazily; same global ValidationPipe as `main.ts`.
- `README.md` - WS URL/path, protocol pointer to ADR 0001, Redis model, schema command + drift warning, test commands.

### Coordinator requirements (T-009 review)
- `host:game_created` is the FIRST message of every host snapshot: the socket joins the room only right after it is
  sent (`sendHostSnapshot`), so no broadcast can precede it. Unit test added.
- `player:state_sync` is the LAST message of every reconnect snapshot whatever the status; the status-specific part
  runs in `runSafely`, so even a failure there still ends with `player:state_sync`. Unit tests for LOBBY,
  QUESTION_ACTIVE, QUESTION_RESULT, PODIUM and the failure case.
- Origin rejection closes with 1008 (unit + transport e2e).
- No Testcontainers added; Redis is tested with hand mocks and `ioredis-mock` (already a devDependency).

### Decisions
- Scores / streaks / correct counts are applied at question END (not on submit): otherwise a reconnect during the
  question (`player:state_sync.score`) would leak correctness, the cheating vector ADR 0001 closes.
- Compare-and-set (Lua) on every state transition: closes host start vs lobby auto-start, double `next_step`, late
  answers after the question closed (answer script re-checks status + index atomically).
- `@SkipThrottle()` on the gateway: the global ThrottlerGuard also runs on WS messages, keys by `req.ip` (undefined on
  a socket) and therefore puts ALL sockets in one bucket of 100 msg/min per handler - a normal game would be
  throttled. Pre-existing bug found during the task.
- Host/start/next: token checked first (unknown game => no token => HOST_UNAUTHORIZED, as ADR §3 "unknown");
  `host:join_game` checks the game first (GAME_NOT_FOUND, listed for that event in ADR §9).
- `player:reconnect` in LOBBY always sends `lobby:timer` (ADR §7 has no "if remaining > 0" there), join/host only if > 0.
- No deviation from ADR 0001 identified.

### Commands for the user (permission required, from `fastquizz-backend/`)
1. Schema - **choose one**:
   - Recommended: `npx prisma db push` (no `--accept-data-loss`) then `npx prisma generate`.
   - Or `npx prisma migrate dev --name relax_pin_and_optional_host` then `npx prisma generate`. **Warning**: the local
     DB was created with `db push` and `prisma/migrations` is gitignored, so `migrate dev` will very likely detect drift
     and propose a database RESET (local data loss). Postgres `char(8) -> varchar(8)` drops padding spaces (desired).
   - Until `prisma generate` runs, TypeScript reports `hostId: null` as an error in `game.service.ts` (stale client
     types). This is expected; no `any` workaround was added.
2. `npm run build`
3. `npm test` (unit, no Docker / DB / Redis)
4. `npx jest --config ./test/jest-e2e.json test/game-gateway.e2e-spec.ts` (transport e2e, no DB / Redis)
5. Optional, needs PostgreSQL + Redis in `.env`: `npm run test:e2e` (auth / quiz suites were not reviewed here).

### Risks
- Nothing was compiled or run: type errors or test failures are possible (largest risk: `ioredis` typings of
  `eval` / pipelines, ioredis-mock Lua quirks in `game-redis.lua.spec.ts`).
- Lua scripts must run on Upstash: they only use standard commands (no `cjson`), EVAL is supported by Upstash.
- PR size well above 400 lines (gateway and Redis service rewrites + tests); reviewer may prefer to review by checkpoint.

### Tech debt discovered (for tech-lead-po to consolidate in docs/tech-debt.md)
- No per-socket WS rate limiting (throttler skipped, only `maxPayload`).
- Lobby expiry with 0 players does not mark Room `EXPIRED` / GameSession; `RoomParticipant.score` not updated at end
  (results live in `PlayerResult`).
- Legacy `POST /api/games/:code/start` (`game.service.ts` `startGame`) throws plain `Error` -> HTTP 500; unused by the
  WS flow.
- `GET /api/games/:code` (public) returns the raw Redis state incl. `hostId` / `roomId` (low-severity disclosure).
- `RoomService` keeps unused methods and the duplicate `room:{code}:state` Redis hash written by `createRoom`.
- Global ValidationPipe also runs on WS messages (double validation, harmless).
- `test/auth.e2e-spec.ts` / `test/quiz.e2e-spec.ts` likely stale (paths / fields), not touched.
- `@nestjs/websockets` still undeclared in `package.json` (dependency change = user decision, D-005).

### Remaining
- F3 build verification (command 2) and test execution (commands 3-5) - user permission required.
- No unfinished code edits.

### Fix after first execution (2026-11-20)
- Results reported by the main session: `prisma db push` OK, `prisma generate` OK, `npm run build` OK,
  `npm test` 261/263. The 2 failures were in `game-redis.lua.spec.ts` (unknown pin `999999`): the CAS returned true
  and `recordAnswer` returned `INVALID_STATE` instead of `GAME_NOT_FOUND`. Cause: `COMPARE_AND_SET_STATE_SCRIPT` and
  `RECORD_ANSWER_SCRIPT` read the state with `HMGET` and tested `not current[1]`; ioredis-mock mis-converts nil
  entries inside the HMGET array.
- Fix (`src/common/redis/game-redis.service.ts`): both scripts now read `status` and `currentQuestionIndex` with
  separate `HGET` calls. Behaviour is unchanged on real Redis / Upstash; test expectations unchanged.
- Checked: every key touched by every Lua script (ADD_PLAYER, RECORD_ANSWER, COMPARE_AND_SET_STATE, SET_CONNECTED,
  RESERVE_PIN) is passed through `KEYS`; no key is built inside a script or passed in `ARGV`.
- To re-run (permission required): `npm test`.

## Review
### Revue — T-008 (tech-lead-po, 2026-11-20)
Verdict : **CHANGEMENTS REQUIS** (one blocking finding, small fix). Status back to `doing`.

Execution facts (main session, user permission): `prisma db push` OK (no data loss), `prisma generate` OK,
`npm run build` OK (0 errors), `npm test` 12/13 suites, 261/263 tests. Transport e2e
(`test/game-gateway.e2e-spec.ts`) NOT run yet. Note: the dev DB is a **hosted** PostgreSQL (alwaysdata), not local
(see D-024).

#### Bloquant
- B1 `src/common/redis/game-redis.service.ts:107-110` (RECORD_ANSWER_SCRIPT) and `:121-128`
  (COMPARE_AND_SET_STATE_SCRIPT) — both read status/index with `HMGET` and test `not current[1]`. On an unknown pin,
  ioredis-mock returns a truthy value for the missing fields: `game-redis.lua.spec.ts:115` (CAS NOT_PODIUM on unknown
  game returns `true`) and `:146` (`recordAnswer` returns `INVALID_STATE` instead of `GAME_NOT_FOUND`) fail.
  Real Redis behaves correctly, but DoD #3 requires green tests and the spec is the only proof of the atomic gates.
  **Fix:** read with two single `HGET` calls (`local status = redis.call('HGET', KEYS[1], 'status')`,
  `local index = redis.call('HGET', KEYS[1], 'currentQuestionIndex')`), same pattern as ADD_PLAYER_SCRIPT which passes.
  Do NOT change the spec expectations. Then request: `npm test` (13/13 expected) and
  `npx jest --config ./test/jest-e2e.json test/game-gateway.e2e-spec.ts`.

#### Important (non-blocking, tracked elsewhere)
- I-1 `game.gateway.ts:667` then `:668-715` (host) and `:316` then `:724-813` (player reconnect) — the socket is bound
  to the room BEFORE the snapshot is read/sent across several awaits (Redis + DB). A transition during that window
  (question end, host start) is broadcast to the socket, then the rest of the snapshot sends the STALE status
  (e.g. `question:ended` then stale `question:started`): host left on an expired question without the "next" button
  until refresh; reconnecting player in LOBBY reset to the lobby during question 0. Window = snapshot build time
  (~100-300 ms with remote Redis). Ordering requirements (game_created first / state_sync last) are met; this is a
  separate race. → **T-021** (P1, S).
- I-2 `game.gateway.ts:573-590` + `:598` — after LOBBY_EXPIRED the state stays `LOBBY` for the 5 s grace: a
  `player:join` succeeds and a `host:join_game` restarts a fresh 59 s countdown (`ensureLobbyTimer`, Redis key
  deleted by `clearLobbyTimer`), then the game is deleted under them. → T-018 (added criterion).
- I-3 `game.gateway.ts:448-487` — if `getQuestion` / `applyQuestionResults` fails after the CAS to
  `QUESTION_RESULT`, no `question:ended` is broadcast and points of that question may be lost; host UI waits for
  `question:ended` (recoverable by refresh). Logged by `runSafely`. → debt D-023.
- I-4 `game.service.ts:144` and `:177` — questions ordered by `orderIndex` only; duplicate `orderIndex` makes
  `skip: index` non-deterministic between `question:started` and answer scoring. Add `{ id: 'asc' }` as tie-breaker.
  → T-018 (added criterion).

#### Mineur / suggestion
- `game-ws-exception.filter.ts:48-49` — guard rejection (`WsException('Forbidden resource')` from OpenSocketGuard)
  is logged as "Unhandled exception" at error level: log noise. Map non-GameError `WsException` to a warn.
- `game-events.dto.ts:17` — nickname pattern rejects `Cc/Zl/Zp` but accepts `Cf` (U+202E bidi override, zero-width
  chars): visual spoofing on the host screen. Add `\p{Cf}`.
- `game-redis.service.ts:315`, `:502` — `MULTI.exec()` per-command errors are not checked (D-023).
- `game.gateway.ts:441` — `setQuestionTimer` failure after the broadcast surfaces as INTERNAL_ERROR to the host
  although the question started. Wrap in `runSafely`.
- Lua scripts re-sent as full text on every `EVAL`; multi-key scripts have no hash tags (not Redis Cluster-safe).
  Fine on Upstash single instance (D-022).

#### Checked and OK
- ADR 0001 §1-§10: event names, payload fields, snapshot sequences, error codes, units, REST §10 response.
- Host token: `randomUUID`, Redis TTL key, deleted on cleanup, `safeEqual` length-checked, verified on every host
  event, never logged. Share token compared in constant time, `QUIZ_NOT_FOUND` for both cases.
- Origin check (URL-normalized, `null` origin rejected, no Origin accepted), `maxPayload` 16 KB, guard on closing
  sockets, catch-all filter (no stack to client).
- Atomicity: join (status + capacity + HSETNX nickname), answer (status + index + HSETNX), CAS on every transition,
  counters via ZINCRBY/HINCRBY, `setPlayerConnected` never recreates keys of a deleted game. Scoring at question end
  (no correctness leak via `state_sync`).
- Timers: lobby interval / question timers / answer-count interval / cleanup timer all cleared on every exit path;
  `runSafely` on every callback; `onModuleDestroy` clears everything. Socket re-binding releases the previous game
  (T-018 point 1 solved here).
- Prisma: `hostId` null for anonymous, `pin` VarChar(8), `finalizeGame` nested `PlayerResult` create (no FK issue),
  Room `LOBBY → IN_PROGRESS → ENDED`, P2002 → `NICKNAME_TAKEN`, Redis rollback on DB failure.
- GDPR: no nickname nor token in logs (only pin + playerId uuid).
- Front/back contract (read-only check of `fastquizz-frontend/src/lib/types/index.ts`, `stores/game.ts`,
  `utils/websocket.ts`, `utils/api.ts`): **no mismatch**. `host_token_{pin}` in localStorage, never in a URL; pin
  trimmed/upper-cased both sides; WS path `/game`.

#### Upstash compatibility (user context: Redis = Upstash, remote, billed per command)
- Lua scripts: OK. Every key touched is passed in `KEYS` (ADD_PLAYER 7 keys, RECORD_ANSWER 2, CAS 1,
  SET_CONNECTED 2, RESERVE_PIN 2); no key name built inside Lua; only `HGET/HMGET/HLEN/HSETNX/HSET/ZADD/EXPIRE/
  HEXISTS/SET/EXISTS` (no blocking or unsupported command, no `cjson`). The B1 fix (two `HGET`) keeps that property.
- TLS: `rejectUnauthorized: true` is compatible with Upstash public CA certificates; SNI defaults to the host name.
  `new URL()` keeps `username` (`default`) and `password`. Minor: `url.password` / `url.username` stay
  percent-encoded — wrap them in `decodeURIComponent` (`game-redis.service.ts:173-174`); harmless with today's
  alphanumeric Upstash passwords, fix in T-022.
- Command volume: not blocking for v1, but time-driven polling (lobby tick ~120 commands per lobby, answer count
  ~80 per 20 s question) and the sequential per-player `GET` in `deleteGame` (`:669-676`) are wasteful on a
  per-command billed remote Redis → **T-022** (P1, S), no ADR change (in-memory counters keep the 500 ms broadcast).
- Tests: `ioredis-mock` only. The "real Redis with a key prefix" fallback (T-012 / T-014) would hit Upstash
  (network + quota): it stays a user-permission decision (noted in T-012).

#### Rulings
- `@SkipThrottle()` on the gateway: **approved**. The global `ThrottlerGuard` (APP_GUARD, `app.module.ts:39`,
  throttler v6) reads the WS context through `switchToHttp()`: tracker `req.ip` is undefined (one bucket for all
  sockets) and the response object is the message payload. Keeping it would break the game. Replacement:
  **T-020** (P1, S) per-socket message limit + per-IP `host:create_game` limit, mandatory before any exposure
  beyond localhost.
- `test/game-gateway.e2e-spec.ts` rewritten (real `ws` transport, mocked services, no DB/Redis) instead of deleted:
  **approved**, it is the only proof of path / 1008 / error envelope. Must run green before `qa`.
- PR size (~3 000 lines incl. rewrites and tests): **exception accepted** for this L task, framed with two
  checkpoints. Commit as two commits on `feat/T-008-backend-live-game-fix` (checkpoint 1 = A-D, checkpoint 2 = E-F +
  tests), with user approval. Not a precedent.
- `test/setup.ts` compile fixes: accepted; the harness is owned by T-011 from now on.
- Debt from the Implementation log consolidated in `docs/tech-debt.md` (D-014..D-025).

Prochaine action : `fullstack-devops` applies B1 only (no other change), asks the user to run `npm test` and the
gateway e2e spec, fills the log, sets `review`. tech-lead-po then checks the diff of the two scripts and moves to `qa`.

### Re-review B1 — T-008 (tech-lead-po, 2026-11-20)
Verdict : **APPROUVÉ** → status `qa`.
- B1 verified: `game-redis.service.ts:107-110` (RECORD_ANSWER) and `:121-128` (COMPARE_AND_SET) now read `status`
  and `currentQuestionIndex` with separate `HGET` calls. Semantics unchanged on real Redis: missing state →
  `GAME_NOT_FOUND` / `0`; missing index (`false`) never equals `ARGV` → `INVALID_QUESTION` / `0`. Keys still only
  from `KEYS` (Upstash-safe), no extra round trip. No other change in the diff scope.
- Execution (main session, user permission): `npm run build` OK; `npm test` 13/13 suites, 263/263 tests;
  `npx jest --config ./test/jest-e2e.json test/game-gateway.e2e-spec.ts` 1/1 suite, 9/9 tests. **F3 OK.**
- Open items unchanged (non-blocking, tracked): I-1 → T-021, I-2 / I-4 → T-018, I-3 → D-023, rate limit → T-020,
  Redis command budget → T-022, hosted dev DB → D-024 (user decision).
- QA focus for `fullstack-qa` (author is `fullstack-devops`): end-to-end with T-009 (anonymous + REST host, join,
  reconnect in each status, double answer, lobby auto-start / LOBBY_EXPIRED, podium persistence in `GameSession` /
  `PlayerResult`), Origin 1008. Do NOT run `npm run test:e2e` (DB `deleteMany()` on the hosted DB, D-020 / D-024).

## QA report
(filled by the QA agent)
