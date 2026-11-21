---
id: T-017
title: Production config guard - reject placeholder secrets, remove dead Redis env vars, schema tests
status: todo
owner: fullstack-devops
author_of_code: (filled by the implementer)
priority: P2
size: S
---

## Context
Follow-up of the T-006 retro review (criterion 3 KO). The `.env.example` `JWT_SECRET` placeholder is 59
chars and passes validation: a production started from the example file signs JWTs with a publicly known
secret (anyone can forge a token). No `NODE_ENV=production` rule exists. `REDIS_HOST/PORT/PASSWORD/DB` are
validated and documented but read by nothing.
Not urgent today (local only, nobody deploys) but cheap and must be done before any first deployment.

## User story
As an operator, I want a production start to fail when configuration is insecure, so that a copied example
file can never reach production.

## Acceptance criteria
- [ ] Given `NODE_ENV=production` and `JWT_SECRET` equal to the `.env.example` value (or containing `change`/`secret-key` placeholder markers, deny-list kept in one constant), then startup fails with `JWT_SECRET uses a placeholder value`.
- [ ] Given `NODE_ENV=production`, `FRONTEND_URL` must be `https://` (startup fails otherwise); in development `http://localhost` stays valid.
- [ ] Dead legacy vars `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB` removed from `config.validation.ts`, `configuration.ts` (`redisConfig` keeps `url` only) and `.env.example`.
- [ ] `main.ts` dead fallback `|| 'http://localhost:5173'` removed (`FRONTEND_URL` is required).
- [ ] Unit tests on `configValidationSchema` (missing var, short secret, placeholder in production accepted in development, http frontend in production).
- [ ] Execution requested from the user.

## Out of scope
- Secrets manager, runtime reload, Redis TLS policy (T-008).

## Technical notes
- Files: `fastquizz-backend/src/config/config.validation.ts`, `src/config/configuration.ts`, `src/main.ts` (1 line), `.env.example`, new `src/config/config.validation.spec.ts`.
- Sensitive: editing `.env.example` and env-var definitions = configuration change → user approval before editing.
- Conflicts: `main.ts` and `fastquizz-backend/**` are owned by T-008 → **starts after T-008 is in `qa` or later**.
- Removing `@types/joi` (deprecated, joi 18 ships its types) is a dependency change: propose it to the user, not part of the acceptance criteria (debt D-007).

## Estimate
Optimistic 0.25 d / probable 0.5 d / pessimistic 0.75 d.

## Implementation log
(filled by the implementer)

## Review
(filled by tech-lead-po)

## QA report
(filled by the QA agent)
