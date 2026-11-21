# 0001 — WebSocket game protocol contract (v1)
Status: accepted
Date: 2026-11-20

## Context
The live game is broken end to end (see T-008 / T-009): the backend runs the default Socket.IO adapter while
both the gateway code and the frontend use native WebSocket; event payloads differ between backend and
frontend; the game identifier is ambiguous (room code vs game PIN); any socket can take over a game as host.

Backend (T-008) and frontend (T-009) are fixed **in parallel by two agents who do not share files**.
This document is the single source of truth they both implement against. Neither implementer edits this
file. Any ambiguity or required change is escalated to `tech-lead-po`, who amends it (new version) and
notifies both sides.

## Options considered
1. **Socket.IO on both sides** — pros: rooms, reconnection, acks built in. Cons: rewrite of the frontend
   transport, new client dependency, the existing gateway code is written against `ws`.
2. **Native WebSocket (`ws` + `@nestjs/platform-ws` `WsAdapter`) with a JSON `{event, data}` envelope** —
   pros: matches the code already written on both sides, `@nestjs/platform-ws` and `ws` already installed,
   no new client dependency. Cons: reconnection and rooms are hand-written (already done).

Host authorization:
1. **JWT on the WebSocket** — cons: hosting without an account must stay possible (user decision).
2. **Per-game secret `hostToken`** issued at creation — works for anonymous and authenticated hosts with
   one mechanism. Chosen.

## Decision
Option 2 for transport, `hostToken` for host authorization. The protocol below is normative.

---

## 1. Transport

- Server: `@nestjs/platform-ws` `WsAdapter`, registered in `main.ts` with `app.useWebSocketAdapter(new WsAdapter(app))`.
- Gateway option is `path: '/game'` (NOT `namespace`: `WsAdapter` throws on `namespace`). No `/api` prefix.
- URL: dev `ws://localhost:3000/game`; behind a reverse proxy `ws(s)://<same host>/game`.
- Origin check: if the upgrade request carries an `Origin` header that differs from the configured
  `app.frontendUrl`, the server closes the socket immediately with code `1008`. Requests without `Origin`
  (non-browser clients) are accepted.
- Every frame, both directions, is one UTF-8 JSON text message: `{ "event": string, "data": object }`.
- Units: `timeLimit` is in **seconds**. Every other duration is in **milliseconds**. Every timestamp is
  **server epoch milliseconds**.

## 2. Game identifier: `pin`

- One identifier per game: `pin`. It is the Redis key, the `GameSession.pin` value and what players type.
- Format: `^[A-Z0-9]{6,8}$`.
  - Game created via REST `POST /api/games` (authenticated): `pin` === room code, 6 chars from
    `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
  - Game created via WS `host:create_game` (anonymous): 6 digits; 8 digits as last-resort fallback.
- The server trims and upper-cases every inbound `pin` before validation.
- Clients MUST use the `pin` returned by the server (`host:game_created`, `player:joined`) for all
  subsequent messages. The value typed by the user is only used for the first `player:join`.

## 3. Host token

- Opaque string (UUID v4) generated server-side when a game is created. Stored in Redis
  (`game:{pin}:host_token`, same TTL as the game state), deleted on game cleanup.
- Returned by REST `POST /api/games` (field `hostToken`) and in every `host:game_created` event.
- Required in `host:join_game`, `host:start_game`, `host:next_step`. Missing/malformed → `VALIDATION_ERROR`.
  Wrong or unknown → `HOST_UNAUTHORIZED`. Server compares with a constant-time comparison.
- Frontend storage: `localStorage["host_token_" + pin]`. Never put it in a URL, never log it.

## 4. Shared payload types (TypeScript notation, normative)

```ts
type GameStatus = 'LOBBY' | 'QUESTION_ACTIVE' | 'QUESTION_RESULT' | 'PODIUM';

interface PlayerPublic {
  id: string;                  // playerId (uuid)
  nickname: string;
  score: number;
  streak: number;
  correctAnswersCount: number;
  connected: boolean;
  joinedAt: number;            // epoch ms
}

interface LeaderboardEntry {
  playerId: string;
  nickname: string;
  score: number;
  rank: number;                // 1-based position, score descending; tie order unspecified
  correctAnswersCount: number;
}

interface QuestionOption {
  id: string;                  // uuid
  text: string;
  colorIndex: 0 | 1 | 2 | 3;   // options are sent sorted by colorIndex ascending
}
```

## 5. Client -> Server events

Validation applies to every event. Any extra field, missing field or wrong type → `error` with
`VALIDATION_ERROR` (the event is not processed).

| Event | `data` | Rules |
|---|---|---|
| `host:create_game` | `{ quizId: string /*uuid*/, shareToken?: string }` | Anonymous hosting. Allowed only if the quiz `isPublic`, or `shareToken` equals the quiz share token. Otherwise `QUIZ_NOT_FOUND` (existence not revealed). Quiz must be playable (see 8) else `QUIZ_INVALID`. |
| `host:join_game` | `{ pin: string, hostToken: string }` | Allowed in any status. Binds the socket as host and sends the host snapshot (section 7). |
| `host:start_game` | `{ pin: string, hostToken: string }` | Status must be `LOBBY` else `INVALID_STATE`. At least `1` player else `NOT_ENOUGH_PLAYERS`. Starts question 0. |
| `host:next_step` | `{ pin: string, hostToken: string }` | Status must be `QUESTION_RESULT` else `INVALID_STATE`. Starts next question, or the podium after the last one. |
| `player:join` | `{ pin: string, nickname: string }` | `nickname` trimmed, 1–20 chars, no control chars. **No `playerToken` field** (reconnection uses `player:reconnect` only). Status must be `LOBBY` else `GAME_ALREADY_STARTED`. Nickname unique per game, case-insensitive, else `NICKNAME_TAKEN`. Player count < `maxPlayers` (default 500) else `ROOM_FULL`. |
| `player:reconnect` | `{ playerToken: string }` | Allowed in any status. Sends the player snapshot (section 7). Never creates a new player. |
| `player:submit_answer` | `{ pin: string, questionIndex: number /*int >= 0*/, optionId: string /*uuid*/, playerToken: string }` | Socket must be bound to this player and `playerToken` must match, else `UNAUTHORIZED`. Status `QUESTION_ACTIVE` else `INVALID_STATE`. `questionIndex` must be current else `INVALID_QUESTION`. `optionId` must belong to the current question else `INVALID_OPTION`. One answer per player per question (atomic) else `ALREADY_ANSWERED`. |

Removed compared to the previous implementation: `hostId` in `host:create_game`, `playerToken` in `player:join`.

## 6. Server -> Client events

| Event | Target | `data` |
|---|---|---|
| `host:game_created` | host socket (reply to `host:create_game` and `host:join_game`) | `{ pin: string, quizTitle: string, questionCount: number, hostToken: string }` |
| `game:state_changed` | unicast snapshot only (host after create/join, player after join/reconnect). Not broadcast on transitions. | `{ status: GameStatus, currentQuestionIndex: number /* -1 in LOBBY */, questionCount: number, timeRemaining: number /* ms, > 0 only in QUESTION_ACTIVE */, players: PlayerPublic[] }` — all fields always present |
| `lobby:player_joined` | broadcast to the game (host + players), only for a **new** player (not on reconnect) | `{ playerId: string, nickname: string, playerCount: number }` |
| `lobby:timer` | broadcast every 1 s while `LOBBY`; stops as soon as status leaves `LOBBY` | `{ remaining: number /* ms */ }` |
| `player:joined` | player socket (reply to `player:join` **and** `player:reconnect`) | `{ playerId: string, playerToken: string, pin: string, nickname: string, quizTitle: string, questionCount: number, players: PlayerPublic[] }` |
| `player:state_sync` | player socket, last message of the reconnect snapshot | `{ score: number, rank: number, streak: number, correctAnswersCount: number, hasAnsweredCurrentQuestion: boolean }` |
| `question:started` | broadcast (and unicast in snapshots) | `{ questionIndex: number, questionCount: number, questionText: string, imageUrl: string \| null, timeLimit: number /* s */, pointsMultiplier: number, options: QuestionOption[], questionStartTime: number, serverTime: number /* server epoch ms at send time */ }` — never contains `isCorrect` |
| `question:answer_count` | broadcast every 500 ms during `QUESTION_ACTIVE` and after each accepted answer | `{ questionIndex: number, answeredCount: number, totalPlayers: number }` |
| `player:answer_accepted` | answering player socket | `{ questionIndex: number }` — no correctness information while the question is active |
| `question:ended` | broadcast (and unicast in snapshots) | `{ questionIndex: number, questionCount: number, correctOptionId: string, answerDistribution: Record<string /*optionId*/, number> /* every option id present, 0 if no vote */, leaderboard: LeaderboardEntry[] /* top 10 */ }` |
| `player:feedback` | **every** player socket of the game, sent right after `question:ended` (also in the reconnect snapshot when status is `QUESTION_RESULT`) | `{ questionIndex: number, answered: boolean, isCorrect: boolean, pointsEarned: number, totalScore: number, rank: number, streak: number, correctAnswersCount: number, correctOptionId: string }` — `answered: false` ⇒ `isCorrect: false`, `pointsEarned: 0`, `streak: 0` |
| `game:podium` | broadcast (and unicast in snapshots) | `{ podium: LeaderboardEntry[] /* top 3 */, finalLeaderboard: LeaderboardEntry[] /* all players */ }` |
| `error` | requesting socket; broadcast only for `LOBBY_EXPIRED` and mid-game `QUIZ_INVALID` | `{ code: ErrorCode, message: string }` — message is human-readable, never a stack trace |

Ordering guarantees: clients MUST NOT depend on the relative order of `question:ended` and
`player:feedback`, nor on receiving `lobby:player_joined` for themselves. Handlers must be idempotent
(e.g. upsert players by `id`).

Timer computation (client): `deadline = questionStartTime + timeLimit * 1000`;
`offset = serverTime - Date.now()` measured on receipt; `remainingMs = max(0, deadline - (Date.now() + offset))`.

## 7. Snapshots (exact message sequence)

- `host:create_game` OK → `host:game_created`, `game:state_changed` (LOBBY, players `[]`), `lobby:timer`.
- `host:join_game` OK → `host:game_created`, `game:state_changed`, then by status:
  `LOBBY` → `lobby:timer` (if remaining > 0) | `QUESTION_ACTIVE` → `question:started` (original
  `questionStartTime`, fresh `serverTime`) + `question:answer_count` | `QUESTION_RESULT` → `question:ended` |
  `PODIUM` → `game:podium`.
- `player:join` OK → `player:joined`, `game:state_changed`, `lobby:timer` (if remaining > 0); then
  broadcast `lobby:player_joined`.
- `player:reconnect` OK → `player:joined`, `game:state_changed`, then by status: `LOBBY` → `lobby:timer` |
  `QUESTION_ACTIVE` → `question:started` | `QUESTION_RESULT` → `question:ended` + `player:feedback` |
  `PODIUM` → `game:podium`; finally `player:state_sync`.

## 8. Game rules fixed by this contract

- Minimum players to start: **1**, for both manual start and lobby auto-start (`MIN_PLAYERS_TO_START = 1`).
- Lobby duration 59 000 ms. On expiry: ≥ 1 player → auto-start question 0; 0 players → broadcast
  `error { code: 'LOBBY_EXPIRED' }` then the server deletes the game after 5 s.
- Playable quiz: ≥ 1 question; each question has 2–4 options, exactly one `isCorrect`, `colorIndex`
  integers 0–3 unique within the question. Checked at game creation (`QUIZ_INVALID`). If a question is
  found unplayable mid-game, the server broadcasts `error { code: 'QUIZ_INVALID' }` and goes to the podium
  (never freezes).
- Scoring unchanged: `round(max(0, 1 - elapsed / (2 * timeLimitMs)) * 1000 * pointsMultiplier)` if correct, else 0.
- A player who does not answer gets `streak = 0`.
- After the podium the server deletes the game state after 30 s.

## 9. Error codes

`fatal` = the client must clear the stored session for this game and leave the game screen.

| Code | Emitted for | Client behaviour |
|---|---|---|
| `VALIDATION_ERROR` | any event | show message (non-fatal) |
| `QUIZ_NOT_FOUND` | `host:create_game` | host: fatal, back to the previous page with message |
| `QUIZ_INVALID` | `host:create_game`; broadcast mid-game | creation: fatal for host; mid-game: show message (podium follows) |
| `GAME_NOT_FOUND` | `host:join_game`, `player:join`, `player:reconnect`, `player:submit_answer` | fatal (host → `/admin`, player → `/player/join`) |
| `HOST_UNAUTHORIZED` | `host:join_game`, `host:start_game`, `host:next_step` | fatal for host: delete `host_token_{pin}`, go to `/admin` |
| `INVALID_STATE` | `host:start_game`, `host:next_step`, `player:submit_answer` | non-fatal |
| `NOT_ENOUGH_PLAYERS` | `host:start_game` | non-fatal |
| `LOBBY_EXPIRED` | broadcast at lobby expiry with 0 players | fatal for everyone in the game |
| `GAME_ALREADY_STARTED` | `player:join` | fatal for the join attempt: back to `/player/join` with message |
| `ROOM_FULL` | `player:join` | same as above |
| `NICKNAME_TAKEN` | `player:join` | same as above, keep the code prefilled |
| `INVALID_TOKEN` | `player:reconnect` | fatal |
| `PLAYER_NOT_FOUND` | `player:reconnect` | fatal |
| `UNAUTHORIZED` | `player:submit_answer` | non-fatal |
| `INVALID_QUESTION` | `player:submit_answer` | non-fatal, ignore silently |
| `INVALID_OPTION` | `player:submit_answer` | non-fatal |
| `ALREADY_ANSWERED` | `player:submit_answer` | non-fatal, mark question as answered |
| `INTERNAL_ERROR` | any (unexpected exception) | non-fatal generic message |
| `MAX_RECONNECT` | **client-side only** (never sent by the server) | show "connection lost, refresh" |

## 10. REST endpoint linked to the protocol

`POST /api/games` — JWT required. Body `{ quizId: string /*uuid*/ }` (validated DTO class).
Quiz must exist and belong to the caller or be public, else `404`. Quiz must be playable, else `422`.
Response `201`:
```json
{ "roomCode": "AB3XYZ", "pin": "AB3XYZ", "quizTitle": "string", "questionCount": 5, "hostToken": "uuid" }
```
`roomCode === pin`. The lobby timer is NOT started by this endpoint; it starts on the first `host:join_game`.

## Consequences
- Frontend and backend can be developed blind against this document; integration is tested only once
  T-008 and T-009 are both in `review`.
- The `ws` transport has no built-in rooms/acks: kept hand-written (already in the gateway).
- Feedback is deferred to question end: a player no longer learns the correct answer while the question is
  still open (closes a cheating vector) and players who did not answer get a result screen.
- `@nestjs/platform-socket.io` and `socket.io` become unused (removal = user decision, dependency change).

## Revisit when
- Multi-instance backend is needed (rooms in memory → Redis pub/sub).
- Authenticated hosts need to resume a game from another device without the `hostToken`.
- `GameSession.pin @unique` exhausts the numeric PIN space (pins are never reused historically).
