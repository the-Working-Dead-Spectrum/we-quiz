---
id: T-015
title: CI pipeline (prepared, not executed) - lint, type-check, unit + integration tests, coverage gates
status: blocked
owner: fullstack-devops
author_of_code: (filled by the implementer)
priority: P2
size: S
---

## Context
Follow-up of the T-002 retro review (criterion 7). There is no CI and the project root is not a git
repository, so a GitHub Actions workflow cannot run anywhere today. Blocked on a user decision
(git init + hosting). Environment is local only: the workflow is prepared as an artifact, never executed by an agent.

## User story
As a developer, I want every PR to run lint, type-check and tests automatically, so that a red build blocks
the merge instead of a human finding the breakage later.

## Acceptance criteria
- [ ] `.github/workflows/ci.yml`: on `pull_request` and push to the main branch; jobs backend (install, `prisma generate`, lint, build, unit tests with coverage gates, e2e per T-011: `DATABASE_URL_TEST` pointing to a `fastquizz_test` database of a PostgreSQL service on the CI runner, `test:db:push`, Redis via `ioredis-mock` - no Redis service) and frontend (install, `svelte-check`, build, Vitest if T-013 is done).
- [ ] Node version pinned and identical to the local one; npm cache; no secret needed (CI-only throwaway database, fake env values inline). The T-011 guard (`_test` suffix, differs from `DATABASE_URL`) stays active in CI.
- [ ] Playwright job (T-014) added as a separate, optional job if T-014 is done.
- [ ] README: what CI runs and how to reproduce locally.

## Out of scope
- Deployment, preview environments, release automation.

## Technical notes
- Files: `.github/workflows/ci.yml`, READMEs. CI configuration = sensitive action: user approval before writing.
- No-Docker decision (2026-11-20) applies to the user's machine. A PostgreSQL `services:` container on a hosted CI runner runs on the provider's infrastructure, not locally; if the user also refuses that, use the runner's preinstalled PostgreSQL (`ubuntu-latest`) started by a setup step. User to confirm when unblocking this task.
- **Blocked by**: remote hosting decision (GitHub assumed). Update 2026-11-20: git is now initialized locally (user decision); a workflow only runs once a remote exists. Then starts after T-011 (T-013/T-014 optional).

## Estimate
Optimistic 0.25 d / probable 0.5 d / pessimistic 1 d.

## Implementation log
(filled by the implementer)

## Review
(filled by tech-lead-po)

## QA report
(filled by the QA agent)
