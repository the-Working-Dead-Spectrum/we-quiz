---
id: T-013
title: Frontend unit tests - Vitest on stores (auth, quizBuilder, game) and WebSocket manager
status: todo
owner: fullstack-devops
author_of_code: (filled by the implementer)
priority: P2
size: M
---

## Context
Follow-up of the T-002 retro review (criterion 5). The frontend has zero tests. The game store and the
WebSocket manager hold most of the client logic that broke (reconnection loops, timer units, localStorage
keys, result screen ordering). T-009 fixes them without a test framework (dependency change excluded).

## User story
As a developer, I want unit tests on the stores and the WebSocket manager, so that the client-side game
logic cannot silently regress.

## Acceptance criteria
- [ ] Vitest configured (`vitest.config.ts` or `vite.config.ts` `test` block), `npm run test` script.
- [ ] Game store: handles `question:ended` and `player:feedback` in both arrival orders; `timeRemaining` in ms with `serverTime` offset (ADR 0001 §6); `ALREADY_ANSWERED` marks the question answered; fatal errors clear `player_token`, `player_pin`, `player_nickname` and legacy `player_code`.
- [ ] WebSocket manager: identity message sent first on (re)open; queued game actions dropped on reconnect; no callback after `disconnect()`; a second `connect` destroys the previous instance (fake `WebSocket`).
- [ ] Auth and quizBuilder stores: main transitions (login/logout persistence, add/remove question, exactly one correct option).
- [ ] Execution requested from the user; results in the Implementation log.

## Out of scope
- Component rendering tests beyond one smoke test; E2E (T-014); visual regression.

## Technical notes
- Files: `fastquizz-frontend/**` (config + `src/**/*.test.ts`).
- Dependencies to add (user approval required): `vitest`, `jsdom` (and `@testing-library/svelte` only if a component test is kept). Pick versions compatible with Svelte 4 / Vite 5.
- Conflicts: same files as T-009 → **starts after T-009 is in `qa` or later**.

## Estimate
Optimistic 0.75 d / probable 1 d / pessimistic 2 d.

## Implementation log
(filled by the implementer)

## Review
(filled by tech-lead-po)

## QA report
(filled by the QA agent)
