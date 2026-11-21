# Runbook — Deploy the frontend on Render (Web Service)

The SvelteKit frontend is built with `@sveltejs/adapter-node` and served by `node build`.
It talks to the backend directly (cross-origin) through `PUBLIC_BACKEND_URL`.

## Prerequisites

- The backend is deployed and reachable over HTTPS (e.g. `https://we-quiz-api.onrender.com`).
  Until then the frontend renders but every API call and the game socket fail.
- The backend `FRONTEND_URL` env var is set to the exact frontend origin
  (e.g. `https://we-quiz-frontend.onrender.com`, no trailing slash). It drives both CORS and
  the WebSocket Origin check (a mismatch closes `/game` with code 1008).

## Create the Web Service

Render dashboard → **New** → **Web Service** → select the `we-quiz` repository.

| Field | Value |
|---|---|
| Branch | `main` |
| Runtime | Node |
| Root Directory | `fastquizz-frontend` |
| Build Command | `npm ci && npm run build` |
| Start Command | `node build` |
| Health Check Path | `/` |
| Env `NODE_VERSION` | `20` |
| Env `PUBLIC_BACKEND_URL` | backend origin, `https://…`, no path |

`PORT` is injected by Render and read by adapter-node; do not set it.

## Verify

1. Open the frontend URL: the home page loads.
2. DevTools → Network: login calls `https://<backend>/api/auth/login` (not the frontend host).
3. Start a game: the socket connects to `wss://<backend>/game` (status 101).

## Changing the backend URL

`PUBLIC_BACKEND_URL` is read at runtime: update it in the dashboard and restart the service.
No rebuild is needed.

## Known limits

- Free plan: the service sleeps after ~15 min idle; the first request takes 30–50 s.
  A sleeping backend adds the same delay. Upgrade to a paid instance before a live event.
- The Render free plan has no persistent disk; the frontend does not need one.
