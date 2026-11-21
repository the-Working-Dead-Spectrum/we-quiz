---
id: T-011
title: Backend test harness (dedicated test DB + ioredis-mock) + REST integration tests + coverage gates
status: todo
owner: fullstack-devops
author_of_code: (filled by the implementer)
priority: P1
size: M
---

## Context
Follow-up of the T-002 retro review (criteria 1, 3, 8). The e2e harness has never compiled
(`test/setup.ts` imports a non-existent `redis.service`, declares `request` twice), the REST specs target
wrong routes and payloads, and every spec runs `deleteMany()` against whatever `DATABASE_URL` is configured:
the day someone "fixes" the import, `npm run test:e2e` wipes the local dev database.
No integration test has ever run on this project.

**User decision (2026-11-20): no Docker.** Testcontainers (T-002 criterion 1) is replaced by:
- PostgreSQL: a separate database on the user's existing server, addressed ONLY by `DATABASE_URL_TEST`.
- Redis: `ioredis-mock` (already a devDependency), injected through the Redis provider. No real Redis.

## User story
As a developer, I want REST integration tests that run against a dedicated test database and an in-memory
Redis, so that regressions on auth / quiz / game endpoints are caught without any risk to my local data.

## Acceptance criteria

### A. Database safety guard (blocking - implement and test first)
- [ ] The e2e setup refuses to start (explicit error, no DB connection opened) unless ALL of: `DATABASE_URL_TEST` is set; the database name parsed from it ends with `_test`; it differs from `DATABASE_URL` (as resolved from the environment and `.env`) - full URL and database name both compared.
- [ ] `DATABASE_URL` is never used as a fallback. The app under test receives the test URL explicitly (e.g. `process.env.DATABASE_URL` overwritten with `DATABASE_URL_TEST` inside the test process only AFTER the guard passed, or Prisma `datasources` override) - documented in the code.
- [ ] Table cleanup between tests (`TRUNCATE ... CASCADE` or `deleteMany`) lives in one helper that re-checks the guard before running.
- [ ] The guard has its own unit test (missing var, name without `_test`, same URL as `DATABASE_URL`, valid case).

### B. Schema on the test DB
- [ ] A script `test:db:push` runs the same guard then `prisma db push --skip-generate` with `DATABASE_URL` overridden to `DATABASE_URL_TEST` for that child process only. The implementer writes the script; **running it requires user permission** (schema change).

### C. Redis via ioredis-mock
- [ ] Injection seam: `RedisModule` provides a client factory token (e.g. `REDIS_CLIENT_FACTORY`) used by `GameRedisService` to create its client and subscriber; default = current ioredis-from-URL behaviour (no runtime change). Tests override it with `ioredis-mock`. No `if (NODE_ENV === 'test')` branch in production code.
- [ ] Every Redis command used by `GameRedisService` after T-008 runs on the mock: `SET NX EX/PX`, `HSETNX`, `HINCRBY`, `ZINCRBY`, pipelines (`exec` result shape incl. per-command errors), TTL expiry. Any Lua script (`eval` / `defineCommand`) introduced by T-008 gets a dedicated test on the mock. **Known limit:** ioredis-mock's Lua support is partial. If a script does not run on the mock, record it in the Implementation log and stop: fallback to be approved by `tech-lead-po` + user = real Redis with a dedicated key prefix (`test:{runId}:` via ioredis `keyPrefix`) and cleanup of that prefix only (`SCAN` + `DEL`, never `FLUSHDB`). Note: with Upstash this is a network action.

### D. REST integration tests
- [ ] `test/setup.ts` compiles (no import of a missing module, no duplicate identifiers); one helper exposes `app`, `prisma`, `GameRedisService`. Jest e2e runs `--runInBand` (shared DB).
- [ ] `test/auth.e2e-spec.ts`, `test/quiz.e2e-spec.ts`, `test/game.e2e-spec.ts` use the real routes (`/api/auth`, `/api/quizzes`, `/api/games`) and DTOs (`name`, not `nickname`), and assert post-T-008 / post-T-010 behaviour (e.g. `POST /api/games` returns `pin === roomCode` + `hostToken`; another user's private quiz → 404; unknown body field → 400).
- [ ] Non-secret test values for the other required vars (`JWT_SECRET` ≥ 32 fake chars, `UPSTASH_REDIS_URL` dummy - never contacted, `FRONTEND_URL`) set inside the test setup, not read from `.env`.

### E. Coverage and docs
- [ ] Coverage thresholds: unit config ≥ 70% lines on `src/**/*.service.ts` and `src/**/*.gateway.ts`, ≥ 50% global (per-path `coverageThreshold`). Gaps listed in the Implementation log; thresholds not lowered silently.
- [ ] `fastquizz-backend/README.md`: prerequisites (create `fastquizz_test` database, set `DATABASE_URL_TEST`), `test:db:push`, unit and e2e commands, the guard rules.
- [ ] Execution of unit + e2e suites requested from the user; results pasted in the Implementation log.

## Out of scope
- WebSocket protocol tests (T-012), frontend tests (T-013), Playwright (T-014), CI (T-015).
- `test/game-gateway.e2e-spec.ts` (rewritten in T-012).
- Removing `@testcontainers/*` (dependency change - user decision).

## Prerequisites from the user
- Create an empty database (e.g. `fastquizz_test`) on the existing PostgreSQL server.
- Provide `DATABASE_URL_TEST` in his local environment (`.env` or shell). Agents never read nor write the real value.

## Technical notes
- Files: `fastquizz-backend/test/**`, `fastquizz-backend/src/common/redis/redis.module.ts` + `game-redis.service.ts` (factory seam only), `fastquizz-backend/package.json` (`jest` block and scripts only), `fastquizz-backend/README.md`, optionally `.env.example` (adds `DATABASE_URL_TEST` with a fake value - config change, user approval).
- Conflicts: `fastquizz-backend/**` owned by T-008, `src/modules/quiz/**` by T-010 → **starts after T-008 and T-010 are in `qa` or later**.
- No new dependency expected (`ioredis-mock` already present). Any addition = user approval.

## Estimate
Optimistic 0.75 d / probable 1.25 d / pessimistic 2 d (main risk: a T-008 Lua script unsupported by ioredis-mock).

## Implementation log
(filled by the implementer)

## Review
(filled by tech-lead-po)

## QA report
(filled by the QA agent)
