---
id: T-009
title: Frontend - make the live game playable (protocol v1, host token, stores, reconnection, game pages)
status: qa
owner: fullstack-devops
author_of_code: fullstack-devops
priority: P0
size: L
---

## Context
On the frontend side the live game is unplayable: players can never answer, the host never reaches the
game screen (and the live page creates a second game), the results screen never shows, timers are off by
x1000, reconnection duplicates players and handlers, and a stale localStorage key blocks joining a new game.
This task fixes the frontend against the protocol contract `docs/adr/0001-websocket-game-protocol.md`
(ADR 0001, normative). The backend is fixed in parallel in T-008 against the same contract: implement
against the ADR, not against the current backend code.

## User story
As a host, I want to open my lobby, start the game and drive it to the podium on one continuous flow;
as a player, I want to join with a code, answer, see my result after each question and the podium,
surviving a network blip without becoming a duplicate player.

## File ownership (strict - parallel work)
- Allowed: `fastquizz-frontend/**`.
- Forbidden: `fastquizz-backend/**`, `docs/adr/**`, `docs/tech-debt.md`, root `package.json`, any `.env*`.
- Contract ambiguity → stop and ask `tech-lead-po`; do not reinterpret ADR 0001.

## Acceptance criteria

### A. Types and transport (M12, M3)
- [x] `src/lib/types/index.ts` mirrors ADR 0001 §4-§6 exactly: every client event (incl. `host:join_game`, `hostToken`, `shareToken`; no `hostId`; no `playerToken` in `player:join`) and every server event (incl. `host:game_created` with `hostToken`, `player:answer_accepted`, `player:feedback` with `answered`, `question:started` with `questionCount`/`serverTime`, `question:ended` with `questionIndex`/`questionCount`, `player:state_sync` with `hasAnsweredCurrentQuestion`), plus an `ErrorCode` union.
- [x] `websocket.ts` `ServerEventMap` is derived from the same types (single source of truth, no duplicated payload shapes).
- [x] `getColorConfig` / helpers accept `number` and clamp to 0-3 (removes the `ColorIndex` TS errors at the call sites, e.g. join page 228-231).
- [x] Reconnection has ONE owner: the `WebSocketManager`. The store-level `scheduleReconnect` (game.ts ~345, ~370) is removed.
- [x] `disconnect()` detaches `onopen/onmessage/onclose/onerror` before closing, so no callback (and no reconnect) fires after an intentional close or a component destroy.
- [x] Creating a connection destroys any previous manager first; handlers are never registered twice.
- [x] On every (re)open, the identity message is sent first (`host:join_game` / `player:reconnect` / first-time `host:create_game` / `player:join`); queued game actions are dropped on reconnect (never flushed before identity).

### B. Host flow (B4, B6, S1)
- [x] `admin/+page.svelte`: after `POST /api/games`, stores `localStorage["host_token_" + pin] = hostToken`, keeps `quizId` in the modal state (no lookup by title, ~331), opens `/admin/lobby?pin=<pin>`. `api.ts` `createRoom` return type matches ADR 0001 §10.
- [x] `public/+page.svelte` and `quiz/[token]/+page.svelte` open `/admin/lobby?quizId=<id>` (the share page also passes `&shareToken=<token>`); the lobby then sends `host:create_game { quizId, shareToken? }`.
- [x] On `host:game_created` the host store saves `host_token_<pin>` and the lobby replaces its URL with `/admin/lobby?pin=<pin>` (a refresh then re-joins, never re-creates). The token never appears in a URL.
- [x] With `?pin=`, the lobby sends `host:join_game { pin, hostToken }` from localStorage; no token → redirect to `/admin` with a message.
- [x] Host store hydrates the player list from `game:state_changed.players` and upserts on `lobby:player_joined` (by `playerId`).
- [x] `admin/lobby/+page.svelte`: cleanup returned from `onMount` (no `onDestroy` inside `onMount`, ~53). When status leaves `LOBBY`, it navigates to `/admin/live?pin=<pin>` WITHOUT closing the socket; on any other navigation it disconnects.
- [x] `admin/live/+page.svelte`: never calls `createGame` (~29). If the store is already connected to this `pin`, reuse it; otherwise `host:join_game` with the stored token (refresh case). Shows `Question n / questionCount` (no more `?`, ~117, ~159).
- [x] Host fatal errors (ADR 0001 §9: `HOST_UNAUTHORIZED`, `GAME_NOT_FOUND`, `QUIZ_NOT_FOUND`, `QUIZ_INVALID` at creation, `LOBBY_EXPIRED`) clear `host_token_<pin>` and return to `/admin` with the message; non-fatal ones show a transient message. (See Implementation log, interpretation I-1: creation errors return to the previous page per ADR §9.)

### C. Player flow (B3, M1, M4, M5)
- [x] `submitAnswer` uses the `pin`, `playerToken` and `currentQuestionIndex` held in the player store state (set from `player:joined` / `question:started`). The dead helper stores `playerTokenStore`, `currentQuestionIndexStore`, `nicknameStore`, `pinStore` are removed.
- [x] `player/game/+page.svelte` compiles (`get` import or `$canAnswer`, ~31). After a click the UI shows "answer sent, waiting" (optimistic, confirmed by `player:answer_accepted`; `ALREADY_ANSWERED` also marks answered); options are disabled.
- [x] `question:ended` is stored as `questionResults` and the current question is kept (no `question: null`, game.ts ~448). The result screen renders when status is `QUESTION_RESULT` for every player, whether they answered or not, using `player:feedback` (`answered: false` → "no answer") and `questionResults.answerDistribution` (not `$playerFeedback.answerDistribution`, ~257). Works whatever the arrival order of `question:ended` / `player:feedback`.
- [x] Points display renders the value (`+{n}`), not the raw template text (~207).
- [x] `questionCount` comes from `player:joined` / `question:started` (no more 0).
- [x] localStorage keys are consistent: `player_token`, `player_pin`, `player_nickname`; clearing removes all three AND the legacy `player_code` (game.ts ~395 removed `player_pin` while `player_code` was written).
- [x] Player fatal errors (`INVALID_TOKEN`, `PLAYER_NOT_FOUND`, `GAME_NOT_FOUND`, `LOBBY_EXPIRED`) clear the stored session and go to `/player/join`; join refusals (`GAME_ALREADY_STARTED`, `ROOM_FULL`, `NICKNAME_TAKEN`) go back to `/player/join` with the message and the code prefilled.
- [x] `player/join/+page.svelte`: no TS errors; Enter submits once (remove the div keydown or the form submit duplication, ~115/~168, which also removes the a11y warning); deleting a character updates `code` (~89-96); accepts 6-8 alphanumeric chars (6 input boxes kept; an 8-char code works through `?code=`); auto-redirect to the game only if `player_token` AND `player_pin` exist. The public join link `/player/join?code=<pin>` keeps working.
- [x] Reconnect after a network cut sends `player:reconnect { playerToken }` only, and restores the screen from the snapshot (ADR 0001 §7), incl. "already answered" from `player:state_sync.hasAnsweredCurrentQuestion`.

### D. Timers (M2)
- [x] Store `timeRemaining` is in milliseconds, computed from `questionStartTime + timeLimit*1000` with the `serverTime` offset (ADR 0001 §6), refreshed at least every 250 ms. Pages display `Math.ceil(ms/1000)` and progress bars use `ms / (timeLimit*1000)` (player/game ~36/~175, admin/live ~52/~122 consistent).
- [x] Lobby countdown uses `lobby:timer.remaining` (ms).

### E. Minor (m2, S3 client side)
- [x] `<meta name="viewport">` moved into `<svelte:head>` (player/game ~357).
- [x] `api.quizzes.list()` no longer sends `authorId` (backend ignores it after T-010).

### F. Quality gates
- [ ] `svelte-check` reports 0 errors (and no new warnings) - execution requested from the user. (Run 2026-11-20 by the main session with user approval: 0 errors in T-009 files; 6 a11y warnings remain in `admin/+page.svelte` 294-329, a file T-009 modified -> fix R-1 required before GO, see Review.)
- [x] `npm run build` passes - execution requested from the user. (Run 2026-11-20 with user approval: success; only the adapter-auto "no supported production environment" notice.)
- [x] Manual scenario written in the Implementation log for QA: host (account) + 2 players in 2 browsers; anonymous host from `/public`; player refresh mid-question; host refresh on live page; duplicate nickname; wrong code.

## Out of scope
- Any backend change (T-008, T-010).
- Visual redesign, new screens, new features (kick, player-left notification, end question early).
- Adding a frontend test framework (no dependency change in this task).
- Running any command without explicit user permission.

## Technical notes
- Contract: `docs/adr/0001-websocket-game-protocol.md`. Payload field names are frozen.
- Until T-008 lands, the backend does not speak this protocol: you cannot test end to end. Type-check and build only; integration happens when both T-008 and T-009 are in `review`.
- `hostToken` in localStorage has the same XSS exposure as the existing `auth_token`: accepted, documented.
- Keep the PR reviewable: deliver in two checkpoints recorded in the Implementation log - (1) sections A-B (types, transport, host flow), (2) sections C-F - each with touched files and approximate diff size.
- Debt discovered: list it in the Implementation log; `tech-lead-po` consolidates `docs/tech-debt.md`.

## Estimate
Optimistic 1.5 d / probable 2 d / pessimistic 3.5 d (hypotheses: no page restructuring beyond the listed fixes, ADR stable during the sprint).

## Implementation log
Implementer: `fullstack-devops` (2026-11-20). No command was executed (no npm, svelte-check, vite, git): type-check and
build are pending user approval. No dependency added/removed. Nothing touched outside `fastquizz-frontend/**` except
this task file. ADR 0001 implemented as written; no protocol deviation.

### Checkpoint 1 — A + B (types, transport, host flow) — approx. +620 / -330 lines
- `src/lib/types/index.ts` — game section rewritten from ADR §4-§6/§9/§10: `PlayerPublic`, `LeaderboardEntry`,
  `QuestionOption`, one payload interface per client/server event, `ClientEventMap` / `ServerEventMap` with
  `ClientEvent` / `ServerEvent` unions derived from them, `ErrorCode` union (+ client-only `MAX_RECONNECT`),
  `CreateGameResponse`. `GameStatus` loses `ENDED`. Removed unused `GameState`, `PlayerData`, `PlayerInGame`.
  Color helpers take `number` and clamp via `toColorIndex()`.
- `src/lib/utils/websocket.ts` — rewritten. Sole owner of reconnection (linear backoff 2 s x attempt, cap 5x, max 10
  attempts then local `error { MAX_RECONNECT }`). `identify()` callback: its message is sent first on every open.
  No outgoing queue: `send()` returns `false` when the socket is not open (stricter than "drop queued actions").
  `disconnect()` marks the instance destroyed, clears the retry timer, nulls the four socket callbacks, then closes,
  and clears handlers. `createWebSocketManager()` destroys the previous manager. `getGameSocketUrl()` (ADR §1).
  Inbound frames are checked for the `{event, data}` envelope.
- `src/lib/stores/game.ts` — rewritten (host part): `hostToken` kept in a closure (never in store state, never in
  a URL), persisted as `host_token_<pin>`; identity = `host:join_game` once the token is known, else
  `host:create_game`; players hydrated from `game:state_changed.players`, upsert by id on `lobby:player_joined`;
  `question:ended` keeps the question; fatal/non-fatal error table per ADR §9 (`fatal` field consumed by pages,
  transient `error` auto-cleared after 4 s). `isActiveFor(pin)` lets the live page reuse the lobby socket.
- `src/lib/stores/flash.ts` (new) + export in `stores/index.ts` — one-shot in-memory message carried across a
  client-side navigation (fatal error → `/admin`, `/public`, `/quiz/<token>`, `/player/join`).
- `src/lib/utils/api.ts` — `createRoom` typed `CreateGameResponse`; `quizzes.list()` takes no `authorId`.
- `src/routes/admin/+page.svelte` — stores `host_token_<pin>`, modal keeps `{ pin, quizId }`, opens
  `/admin/lobby?pin=<pin>`; `onclick` string handlers replaced by `on:click`; list loaded when an auth token exists
  (previously skipped while `/auth/me` was still pending); flash message shown; copy fixed to "1 joueur minimum".
- `src/routes/public/+page.svelte`, `src/routes/quiz/[token]/+page.svelte` — open `/admin/lobby?quizId=…`
  (+ `&shareToken=…` on the share page); show the flash message of a failed creation.
- `src/routes/admin/lobby/+page.svelte` — `?pin=` → reuse or `joinGame` (no token → `/admin` + message);
  `?quizId=` → `createGame(quizId, shareToken)`; URL replaced by `?pin=` (SvelteKit `replaceState`) once
  `host:game_created` arrives; status ≠ LOBBY → `goto('/admin/live?pin=…')` keeping the socket; cleanup returned
  from `onMount`; keyboard shortcut moved to `<svelte:window>` (a11y warning gone, no double activation).
- `src/routes/admin/live/+page.svelte` — never creates; reuse or `joinGame`; `Question n / questionCount`; timer
  bar in ms; LOBBY block calls `startGame` (was `nextStep`); distribution bars relative to total votes;
  "Voir le podium" on the last question; "Terminer" calls `reset()` (closes socket, forgets `host_token_<pin>`).

### Checkpoint 2 — C + D + E (player flow, timers, minor) — approx. +520 / -300 lines
- `src/lib/stores/game.ts` (player part) — state holds `pin`, `playerToken`, `currentQuestionIndex`,
  `answerStatus` (`none` → optimistic `sent` → `accepted`), `selectedOptionId`, `feedback`, `questionResults`.
  Identity = `player:reconnect { playerToken }` once known, else `player:join { pin, nickname }`.
  `question:ended` and `player:feedback` each move to `QUESTION_RESULT` independently; stale indexes ignored.
  `isReconnecting` stays true until `player:state_sync` (last snapshot message), which also sets "already
  answered". Storage keys `player_token` / `player_pin` / `player_nickname`; clearing also removes `player_code`.
  Dead helper stores removed. Shared question clock: ms, ADR §6 formula with `serverTime` offset, 250 ms tick.
- `src/routes/player/join/+page.svelte` — single submit path (`on:submit|preventDefault`), div keydown removed;
  per-box `chars[]` model (delete clears the box, Backspace on empty box clears/focuses previous, paste of a
  full code distributes); 6 boxes, 8 when an 8-char code comes from `?code=`; validation `^[A-Z0-9]{6,8}$`,
  nickname 1-20 chars without control chars; inline error instead of `alert()`; auto-redirect only if
  `player_token` AND `player_pin` exist and `?code=` is absent or equal to the stored pin; flash message shown.
- `src/routes/player/game/+page.svelte` — `?code&nickname` → `join`, else `resume()`, else `/player/join`;
  query string removed after `player:joined` so a refresh resumes instead of re-joining; result screen for every
  player ("Pas de réponse" when `answered: false`, `+{n} pts` rendered); distribution from
  `questionResults.answerDistribution`; "Réponse envoyée / enregistrée, en attente…" status; lobby countdown
  (`lobby:timer`, ms); connection-lost banner with reload; `<meta viewport>` moved to `<svelte:head>`;
  podium "Revenir à l'accueil" calls `leave()` (forgets the session).

### Interpretations / points for tech-lead-po
- I-1: task B says host fatal errors return to `/admin`; ADR §9 says `QUIZ_NOT_FOUND` → "back to the previous
  page". Implemented ADR: creation errors (`QUIZ_NOT_FOUND`, `QUIZ_INVALID` at creation) go back to `/public` or
  `/quiz/<shareToken>` with the message; all other host fatal errors go to `/admin`.
- I-2 (ADR gap, not changed): the `QUESTION_RESULT` snapshot (ADR §7) contains `question:ended` but not
  `question:started`, so after a refresh on the result screen the client has no option texts. UI degrades
  (leaderboard and own result shown, distribution/correct-answer text replaced by a note). Candidate for ADR v2.
- I-3: no outgoing message queue at all (game actions while disconnected show "connexion indisponible").

### Debt / risks discovered (for `docs/tech-debt.md`, consolidation by tech-lead-po)
- If the socket drops after `host:create_game` / `player:join` was sent but before the reply, the retry re-sends
  it: orphan game (expires via `LOBBY_EXPIRED`) / `NICKNAME_TAKEN` on the player's own nickname. Rare.
- Flash message is memory-only (lost on full reload) — acceptable for a one-shot notice.
- A player who closes the tab on the podium keeps a stale session; next visit to `/player/join` does one failed
  `player:reconnect` and lands back on the join form with "Session de jeu invalide".
- No frontend test framework (out of scope): the store logic (ordering, clock, error table) has no unit tests.
- Diff exceeds the 400-line PR guideline (≈ 1 100 lines changed, mostly rewrites of `game.ts`/`websocket.ts`).

### Commands to run (user approval required)
```
cd fastquizz-frontend
npm run check     # svelte-kit sync + svelte-check: expect 0 errors
npm run build
```

### Manual acceptance scenario (QA, once T-008 is in review)
Setup: backend (T-008) on :3000, `npm run dev` on :5173, browser A (host), browsers B and C (players, private windows).
1. Host with account: A logs in → `/admin` → "Créer la partie" → modal shows PIN (6 chars). DevTools: localStorage has
   `host_token_<PIN>`; URL never contains the token. "Ouvrir le lobby" → `/admin/lobby?pin=<PIN>`, countdown starts.
2. B opens `/player/join?code=<PIN>` (code prefilled), nickname "Alice", press Enter once → one `player:join` frame
   (WS tab), lands on waiting screen with countdown. C joins as "Bob" by typing the code. A lists both players.
3. Duplicate nickname: a 4th window joins as "alice" → back to `/player/join` with "Ce pseudo est déjà pris…" and the
   code prefilled. Wrong code: join with "ZZZZZZ" → back to join with "Partie introuvable…".
4. A clicks "Lancer le quiz" → A goes to `/admin/live?pin=<PIN>` without a new WS connection (WS tab: same socket,
   no `host:create_game`). Header "Question 1 / N", timer counts down in seconds, bar shrinks smoothly.
5. B answers → buttons disabled, "Réponse envoyée… / enregistrée…"; A's counter goes 1/2. C does not answer.
6. On timeout: B sees Correct/Incorrect with `+X pts` (a number), C sees "Pas de réponse" `+0 pts`; both see the
   correct option and the vote distribution. A sees distribution + leaderboard, presses Space → question 2.
7. Player refresh mid-question: B answers Q2 then presses F5 → "Reconnexion…" then the question screen with buttons
   disabled ("Réponse enregistrée"); WS tab shows only `player:reconnect { playerToken }`. A still lists 2 players.
8. Network cut: DevTools "Offline" on C for ~5 s then back online → automatic reconnect, no duplicate player on A.
9. Host refresh on live page: A presses F5 during a question → `host:join_game` sent, same question and remaining
   time restored, "Question n / N" correct.
10. Last question → "Voir le podium" → podium on A, B, C (own rank/score correct). A clicks "Terminer" →
    `host_token_<PIN>` removed. B clicks "Revenir à l'accueil" → `player_token`/`player_pin`/`player_nickname` removed.
11. Anonymous host: logged-out window → `/public` → "Jouer" → `/admin/lobby?quizId=…` then URL becomes `?pin=<6 digits>`;
    F5 in the lobby re-joins the same PIN (no second game). Share link `/quiz/<token>` → lobby URL carries
    `&shareToken=` until the PIN arrives. Non-public quiz without token → back to `/public` with "Quiz introuvable…".
12. Lobby expiry with 0 players (wait 59 s) → host back to `/admin` with "Le lobby a expiré…".
13. Stale storage: set `player_code=OLD` manually, open `/player/join` → no redirect; joining a game removes it.

### Pre-GO fixes after review (2026-11-20, fullstack-devops) — approx. +45 / -12 lines, no command run
- R-1 `src/routes/admin/+page.svelte` (room modal): the backdrop is now a separate sibling `div role="presentation"`
  (mouse shortcut only); the panel is `role="dialog" aria-modal="true" aria-labelledby="room-modal-title"` with no
  click handler (the `on:click|stopPropagation` is gone); Escape closes via `<svelte:window on:keydown>`; both
  `<label>`s have `for=` matching `id="room-modal-pin"` / `id="room-modal-join-url"`; close icon got
  `aria-label`. Checked against the Svelte 4.2.20 compiler: `role="presentation"` skips the click-events,
  static-element and noninteractive-element checks, so no `svelte-ignore` was needed. Label text "(6 caractères)"
  dropped (PIN can be 6-8 chars, ADR §2).
- R-2 `src/lib/utils/websocket.ts`: `reconnectAttempts` is reset on the first inbound frame of a socket (not on
  `open`). Close code `1008` (Origin rejected, ADR §1) → no retry; `onClose(event, false)` then local
  `error { MAX_RECONNECT, "Connexion refusée par le serveur (origine non autorisée)." }`.
  `src/lib/stores/game.ts`: for `MAX_RECONNECT` both stores now show the message emitted by the manager (fallback to
  the generic text). `src/routes/player/game/+page.svelte`: connection-lost banner shows that message.
- QA addition: point the backend's `app.frontendUrl` to another origin (e.g. `http://localhost:4000`), restart it,
  open a player game on `http://localhost:5173` → the server closes with 1008 → one connection attempt only
  (DevTools WS tab), banner "Connexion refusée…", no retry every 2 s. (Do not use `127.0.0.1:5173`: the client
  only targets `:3000` when the host is `localhost`.)
- To re-run (permission): `cd fastquizz-frontend && npm run check` → expect 0 warnings in `admin/+page.svelte`.

## Review
Reviewer: `tech-lead-po`, 2026-11-20. Reviewed by checkpoint (A-B ~620 lines, C-E ~520 lines) against ADR 0001 v1.

Verdict: APPROVED WITH PRE-GO FIXES. No blocking finding -> status `qa`. R-1 and R-2 below must land
before the GO recommendation (small, isolated, do not touch the game flow QA is testing).

### Quality gates (run by the main session, user approved)
- F1 `npm run check`: 0 errors in any file touched by T-009. 2 errors remain in
  `admin/quiz-builder/+page.svelte` (121:26, 147:26): pre-existing, outside T-009 -> T-019.
  15 a11y warnings: 6 in `admin/+page.svelte` 294-329 (attributed to T-009, see R-1); 9 in quiz-builder 69,
  auth/login 40/66/78, auth/register 52/78/90/102/116 (files not touched by T-009) -> T-019.
- F2 `npm run build`: success.

### Blocking
- None.

### Important (fix before GO, owner fullstack-devops, same task)
- R-1 `src/routes/admin/+page.svelte:294-295, 308, 329` - 6 a11y warnings (backdrop/inner `div on:click`,
  `<label>` without control). T-009 replaced the `onclick` strings of this modal with `on:click`, which is what
  makes Svelte emit the click/static-element warnings; criterion F1 says "no new warnings". Origin of the two label
  warnings cannot be proven without history; fixing all six is cheaper than investigating. Expected: Escape key via
  `<svelte:window on:keydown>`, inner panel `role="dialog" aria-modal="true"`, backdrop `role="presentation"`
  (or a scoped `svelte-ignore` with a comment justifying it), `<label for=...>` + matching `id` on both readonly inputs.
  Re-run `npm run check` (permission) -> 0 warnings in this file.
- R-2 `src/lib/utils/websocket.ts:69-70` + `:95-103` - `reconnectAttempts` is reset on `open`, and every close
  schedules a retry. A server that accepts then closes immediately (ADR 0001 §1: Origin mismatch -> close `1008`)
  makes the client retry every 2 s forever; `MAX_RECONNECT` is never reached. Expected: no auto-reconnect when
  `event.code === 1008` (surface `MAX_RECONNECT`-like fatal message), and reset `reconnectAttempts` on the first
  inbound frame instead of on `open`.

### Minor / suggestions (non-blocking, can go to T-019 or later)
- m-1 `src/routes/player/game/+page.svelte:210` - during a reconnect gap the previous question text can render
  under the new "Question n" header; render only if `$playerQuestion.questionIndex === $playerCurrentQuestionIndex`.
- m-2 `src/routes/player/game/+page.svelte:341` - after a reload in `QUESTION_RESULT` the distribution card silently
  disappears (the Implementation log says a note is shown: true on `admin/live:328`, not on the player page). Add the note.
- m-3 `src/lib/utils/websocket.ts:204-209` - dev detection hard-codes `localhost:5173`; `127.0.0.1` or another
  Vite port silently targets `/game` on the Vite server. Later: Vite proxy `/game` with `ws: true` (config change,
  user decision).
- m-4 `src/routes/admin/live/+page.svelte:83-86` - "Terminer" always goes to `/admin`; an anonymous host lands on the
  login wall. ADR-compliant for fatal errors; for "Terminer" consider `/public` when not authenticated.
- m-5 `admin/lobby` / `admin/live` - `MAX_RECONNECT` is shown as text without the reload action the player page has.
- m-6 `src/lib/stores/game.ts:454-457, 827-830` - `disconnect()` does not clear the transient-error timer (harmless).

### Checked explicitly (no finding)
- Types mirror ADR §4-§6/§9/§10 field by field; `ServerEventMap` single source; no `hostId`, no `playerToken` in `player:join`.
- One reconnection owner; callbacks detached before close; `createWebSocketManager` destroys the previous one;
  identity sent first on every open; no outgoing queue.
- Snapshot handling §7: `isReconnecting` until `player:state_sync`; `question:ended` / `player:feedback` order-independent
  with stale-index guards; `question:started` on the same index keeps the answer state.
- Error table §9 for host and player, including `QUIZ_INVALID` creation vs mid-game.
- Timers: ADR §6 formula with `serverTime` offset, 250 ms tick, ms everywhere, `Math.ceil` display.
- SSR: no `window`/`localStorage` at module top level; storage behind `browser`; reactive statements touching
  `window` are short-circuited by `mounted`; `onMount` returns cleanup; no `onDestroy` inside `onMount`.
- Security: `hostToken` only in a closure + `localStorage`, never in store state, URL or log; `{@html}` only with
  `getShapeSvg` (static strings on a clamped index); `shareToken` leaves the URL via `replaceState` once the pin arrives.
- Lobby -> live keeps the socket (`leavingToLive` + `isActiveFor`); live never creates a game.

### Rulings on the implementer's points
- I-1: ADR 0001 §9 is normative and wins over the task wording. Creation errors (`QUIZ_NOT_FOUND`, `QUIZ_INVALID`)
  return to `/public` or `/quiz/<token>`; every other host fatal goes to `/admin`. Approved as implemented.
- I-2: no ADR change in v1. The gap is real but rare (reload during a 10-20 s result screen) and degrades without
  blocking (host presses Next, player still sees correct/incorrect and points). Changing the contract while T-008 is
  in progress costs more than it returns. Recorded as debt D-011; candidate for ADR 0001 v2: additive
  `questionText` + `options` on `question:ended`.
- I-3: approved. No outgoing queue is stricter than criterion A and avoids flushing a stale answer
  (`INVALID_QUESTION`) after a reconnect. User retries after "connexion indisponible".
- Orphan game / own-nickname `NICKNAME_TAKEN` on a retry: accepted for v1, debt D-012. Host orphan self-cleans
  (`LOBBY_EXPIRED` after ~64 s, 0 players). Player ghost stays as a disconnected player in that game. Fix belongs to
  ADR v2 (idempotent join/create with a client request id), not to this task.

### Process
- Diff ~1 100 lines (> 400 rule). Accepted only because the task was framed size L with two checkpoints. When the
  user authorizes git: two commits (or two PRs) matching checkpoint 1 and checkpoint 2, R-1/R-2 as a third commit.
- Review depth on `game.ts` ordering logic is limited by the absence of unit tests: T-013 (Vitest on stores and
  `WebSocketManager`) stays required; QA scenario steps 5-9 are the real coverage until then.
- Integration notes sent to T-008 (no contract change): the client strictly relies on `player:state_sync` being the
  LAST message of every `player:reconnect` snapshot (all statuses, including LOBBY and PODIUM) - otherwise the player
  stays on "Reconnexion..." with answers disabled; on `host:game_created` being the FIRST message of every host
  snapshot; on correct `questionIndex` in `question:ended` / `player:feedback`; on close code `1008` for Origin rejection.

Prochaine action: fullstack-devops fixes R-1 and R-2 (status stays `qa`, logged in Implementation log), then
fullstack-qa runs the manual scenario once T-008 is in `review`.

## QA report
(filled by the QA agent)
