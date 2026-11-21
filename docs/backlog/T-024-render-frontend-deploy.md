---
id: T-024
title: Prepare frontend deployment on Render as a Web Service
status: review
owner: fullstack-devops
author_of_code: claude-main-session
priority: P1
size: S
---

## Context
The frontend must be deployable on Render as a Web Service (owner decision, see Review notes).
Front and back live on different hosts, but the client assumed same-origin `/api` and `/game`.

## User story
As the owner, I want to deploy the frontend on Render, so that players can reach the app online.

## Acceptance criteria
- [ ] Given `PUBLIC_BACKEND_URL` unset, when running `npm run dev`, then REST goes to `/api` (Vite proxy) and the socket to `ws://localhost:3000/game` (unchanged behaviour).
- [ ] Given `PUBLIC_BACKEND_URL=https://api.example.com`, then REST goes to `https://api.example.com/api/...` and the socket to `wss://api.example.com/game`.
- [ ] Given an invalid or non-http(s) `PUBLIC_BACKEND_URL`, then a clear error names the variable.
- [ ] `npm run build` produces `build/` and `node build` serves the app on `$PORT`.
- [ ] `docs/runbooks/render-frontend.md` describes the service settings.

## Out of scope
- Backend, Postgres and Redis deployment on Render (follow-up task).
- Actually deploying (local-only environment).

## Technical notes
- Adapter: `@sveltejs/adapter-node` replaces `adapter-auto` and the unused `adapter-vercel`.
- `PUBLIC_BACKEND_URL` read via `$env/dynamic/public` (runtime, no rebuild on change).
- Backend already restricts CORS and WS Origin to `FRONTEND_URL`: must be set to the frontend origin.
- Owner chose Web Service over Static Site despite the recommendation (Static Site: CDN, no sleep
  on free plan). Accepted trade-off: cold start on free plan.

## Implementation log
- `src/lib/utils/backend-url.ts`: pure resolvers (`parseBackendUrl`, `resolveApiBase`, `resolveGameSocketUrl`) + runtime getters.
- `api.ts`, `websocket.ts`: use the resolvers.
- `svelte.config.js`, `package.json` (`start`, `engines`), `.env.example`, runbook.
- `src/routes/+layout.ts`: `ssr = false` (Kit 2.70 + Svelte 4 SSR crash under adapter-node, see file comment).
- `tsconfig.json`: stop overriding `include` so `.svelte-kit/ambient.d.ts` (`$env/*` types) is loaded.
- Per-app `.gitignore` files; backend no longer ignores `prisma/migrations/`.
- Verified locally: `npm run build` OK, `node build` serves `/`, `/auth/login`, `/quiz/abc`, `/player/join` with 200 and injects `PUBLIC_BACKEND_URL`. Browser-level network check not done.
- `svelte-check`: 2 pre-existing errors in `admin/quiz-builder` (T-019), none introduced.
- No unit test added: the frontend has no test runner yet (T-013). Resolvers are pure and ready to test.

## Review
(filled by tech-lead-po)

## QA report
(filled by the QA agent)
