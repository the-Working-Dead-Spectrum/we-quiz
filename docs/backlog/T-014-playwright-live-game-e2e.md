---
id: T-014
title: Playwright E2E - live game happy path (create quiz → launch → 2 players → podium)
status: todo
owner: fullstack-devops
author_of_code: (filled by the implementer)
priority: P1
size: M
---

## Context
Follow-up of the T-002 retro review (criterion 6). The product's core feature (live game) was broken across
frontend and backend for several tasks marked `done`. Only a browser-level test catches contract drift
between the two sides. One happy path, not a suite.
No Docker (user decision 2026-11-20): backend and frontend are started locally by the test runner, backend on
the dedicated test DB (`DATABASE_URL_TEST`, guard of T-011).

## User story
As the product owner, I want one automated browser scenario that plays a full game, so that "the game
works" is a verifiable fact before every delivery.

## Acceptance criteria
- [ ] Playwright configured in `fastquizz-frontend` (`playwright.config.ts`, `npm run test:e2e`), Chromium only.
- [ ] `webServer` starts the frontend (`vite dev` or `preview`) and the backend through a dedicated e2e entrypoint (e.g. `fastquizz-backend/test/e2e-server.ts`) that: runs the T-011 guard, uses `DATABASE_URL_TEST` (never `DATABASE_URL`), and boots `AppModule` with the Redis factory overridden by `ioredis-mock` (single backend process, in-memory Redis). No test-only branch in production code.
- [ ] Scenario 1: register + login host → create a 2-question quiz → launch from `/admin` → 2 player browser contexts join via code → host starts → players answer (one right, one wrong) → result screen visible for both → next → podium visible on host and players with scores and correct-answer counts.
- [ ] Scenario 2: player page reload mid-question restores the question and the "already answered" state (ADR 0001 §7).
- [ ] Test DB cleaned before the run through the T-011 helper (guarded).
- [ ] No fixed `sleep`: waits on UI state only; lobby/question durations shortened through the injection point of T-012.
- [ ] README section: prerequisites and how to run. Execution requested from the user.

## Out of scope
- Cross-browser, mobile viewports, visual regression, load.

## Prerequisites and permissions (user)
- `fastquizz_test` database + `DATABASE_URL_TEST` (same as T-011), schema pushed via `test:db:push` (user permission).
- **Dependency + network action, user permission required:** adding `@playwright/test` to `fastquizz-frontend` devDependencies AND downloading the Chromium browser (`npx playwright install chromium`, ~150 MB from the internet).

## Technical notes
- Files: `fastquizz-frontend/playwright.config.ts`, `fastquizz-frontend/e2e/**`, `fastquizz-frontend/package.json` (scripts/devDeps), `fastquizz-backend/test/e2e-server.ts`.
- Option rejected for now: backend on the real Redis with a key prefix - only if the ioredis-mock limit of T-011 C is hit (same fallback rules).
- Ports: backend and frontend on fixed non-default ports for the e2e run (e.g. 3100 / 5180) so they never collide with a running dev instance; `FRONTEND_URL` of the e2e backend set accordingly (ADR 0001 origin check).
- Conflicts / deps: **starts after T-008, T-009 (in `qa` or later), T-011 and T-012** (Redis seam, guard, duration injection).

## Estimate
Optimistic 0.75 d / probable 1.5 d / pessimistic 2.5 d.

## Implementation log
(filled by the implementer)

## Review
(filled by tech-lead-po)

## QA report
(filled by the QA agent)
