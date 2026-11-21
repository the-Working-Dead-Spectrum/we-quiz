# FastQuiz Backlog

## Task Index

| ID | Title | Priority | Size | Owner | Status | Depends on |
|----|-------|----------|------|-------|--------|------------|
| [T-001](T-001-websocket-room-management.md) | WebSocket Room Management - O(1) Broadcast | P0 | M | fullstack-devops | qa* | QA after T-008, T-009 |
| [T-002](T-002-test-coverage.md) | Test Coverage - Unit & Integration Tests | P0 | L | fullstack-qa | blocked* | T-011..T-015 |
| [T-003](T-003-correct-answers-tracking.md) | Track Correct Answers Count in Podium | P1 | S | fullstack-devops | qa* | QA after T-008, T-009 |
| [T-004](T-004-validation-and-dto-hardening.md) | ValidationPipe Whitelist + DTO Hardening | P1 | S | fullstack-devops | qa* | QA after T-010 |
| [T-005](T-005-pin-collision-handling.md) | PIN Collision Handling & Uniqueness Guarantee | P1 | S | fullstack-devops | qa* | QA after T-008 |
| [T-006](T-006-env-config-validation.md) | Environment Config Validation at Startup | P2 | S | fullstack-devops | blocked* | T-017 |
| [T-007](T-007-room-persistence.md) | Room Persistence Layer with PostgreSQL | P1 | M | fullstack-devops | blocked* | T-008, T-018 |
| [T-008](T-008-backend-live-game-fix.md) | Backend - live game end to end (WS, protocol v1, host token, engine) | P0 | L | fullstack-devops | qa (review APPROUVÉ after B1; build + 263/263 unit + 9/9 gateway e2e) | - |
| [T-009](T-009-frontend-live-game-fix.md) | Frontend - live game playable (protocol v1, stores, pages) | P0 | L | fullstack-devops | qa (R-1/R-2 fixes in progress) | integration with T-008 |
| [T-010](T-010-quiz-api-security.md) | Quiz REST API - answer leaks, IDOR, transactional update, input validation (incl. ex T-016) | P1 | M | fullstack-devops | doing (review: fix B-1 `/:id/game` private access, B-2 `isCorrect` raw boolean) | no file overlap with T-008 |
| [T-011](T-011-backend-test-harness-and-rest-integration.md) | Backend test harness (dedicated test DB + ioredis-mock, no Docker) + REST integration tests + coverage gates | P1 | M | fullstack-devops | todo | T-008, T-010, user: `fastquizz_test` DB + `DATABASE_URL_TEST` |
| [T-012](T-012-ws-protocol-integration-tests.md) | WebSocket protocol integration tests (ADR 0001) | P1 | M | fullstack-devops | todo | T-008, T-011 |
| [T-013](T-013-frontend-store-unit-tests.md) | Frontend unit tests - Vitest on stores and WS manager | P2 | M | fullstack-devops | todo | T-009 |
| [T-014](T-014-playwright-live-game-e2e.md) | Playwright E2E - live game happy path | P1 | M | fullstack-devops | todo | T-008, T-009, T-011, T-012, user: Playwright dep + browser download |
| [T-015](T-015-ci-pipeline.md) | CI pipeline (prepared, not executed) | P2 | S | fullstack-devops | blocked | remote hosting decision (git is local only), T-011 |
| [T-017](T-017-production-config-guard.md) | Production config guard | P2 | S | fullstack-devops | todo | T-008 |
| [T-018](T-018-game-module-hygiene.md) | Game module hygiene after T-008 | P2 | M | fullstack-devops | todo | T-008 |
| [T-019](T-019-frontend-check-cleanup.md) | Frontend svelte-check cleanup - quiz-builder TS errors and a11y warnings | P1 | S | fullstack-devops | todo | T-009 R-1 merged |
| [T-020](T-020-ws-rate-limiting.md) | WebSocket rate limiting (per socket + per-IP anonymous create) | P1 | S | fullstack-devops | todo | T-008 in `qa`; before any exposure beyond localhost |
| [T-021](T-021-snapshot-consistency.md) | Host / player snapshots consistent under concurrent transitions | P1 | S | fullstack-devops | todo | T-008 in `qa` (same file as T-020) |
| [T-022](T-022-redis-command-budget.md) | Redis command budget - no polling in timers, pipelined cleanup (Upstash) | P1 | S | fullstack-devops | todo | T-008 in `qa` (same files as T-020/T-021) |
| [T-023](T-023-quiz-builder-backend-validation-alignment.md) | Quiz builder aligned with backend validation (image URL, integer time limit, empty options, French errors) | P1 | S | fullstack-devops | todo | T-010 merged, T-019 merged (same page) |

\* Retroactive review done on 2026-11-20 (T-001..T-007 had been marked `done` without review nor QA). `qa` = criteria OK or covered by T-008..T-010, recette scheduled after those land. `blocked` = review verdict CHANGEMENTS REQUIS, remaining criteria moved to the listed tasks.

Protocol contract shared by T-008 and T-009: [ADR 0001](../adr/0001-websocket-game-protocol.md). T-008 and T-009 run in parallel with zero file overlap (backend / frontend); T-010 starts when a `doing` slot frees up.

Superseded (kept for traceability, not in the active index): [T-016](T-016-quiz-dto-residual-validation.md) - merged into T-010 (user decision 2026-11-20).

**Git:** the repository is initialized locally (user decision 2026-11-20). No remote yet: T-015 stays blocked until a hosting decision. Branch / commit rules of `CLAUDE.md` apply (one branch per task, no commit without user approval).

**Warning:** do not run `npm run test:e2e` in `fastquizz-backend` before T-011: the specs `deleteMany()` against the configured (dev) database.

## Suggested order after T-008 / T-009
T-010 (incl. ex T-016) → T-019 → T-011 → T-012 → T-014 → T-018 → T-017 → T-013 → T-015. QA recettes of T-001, T-003, T-004, T-005 run as soon as their dependency lands.

## Workflow

1. **tech-lead-po** frames task → creates/updates markdown
2. **fullstack-devops** or **fullstack-qa** implements → fills `Implementation log`
3. **tech-lead-po** reviews → fills `Review`
4. **Other agent** (not author) QA → fills `QA report`
5. **tech-lead-po** proposes go/no-go → User decides

## WIP Limit

**Max 2 tasks in `doing`** at any time across all agents.

## Priority Legend

- **P0** = Blocking / Critical (do first)
- **P1** = High (next sprint)
- **P2** = Medium (backlog)
- **P3** = Low / Nice to have
