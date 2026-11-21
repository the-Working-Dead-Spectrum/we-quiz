# fastquizz - Backend

Real-time quiz platform backend built with **NestJS**, **Fastify**, **WebSocket (ws)**, **PostgreSQL**, **Prisma**, and **Redis**.

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   NestJS API    │────▶│   PostgreSQL    │
│   (SvelteKit)   │     │   (REST + WS)   │     │   (Persistent)  │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │     Redis       │
                        │  (Game State    │
                        │   + Leaderboard)│
                        └─────────────────┘
```

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: NestJS 10 with Fastify adapter
- **Real-time**: Native WebSocket (`ws` library) via `@nestjs/platform-ws`
- **Database**: PostgreSQL 15 with Prisma ORM
- **Cache/State**: Redis 7 (ioredis)
- **Auth**: JWT with Passport
- **Validation**: class-validator + class-transformer
- **Documentation**: Swagger/OpenAPI

## Project Structure

```
src/
├── app.module.ts           # Root module
├── main.ts                 # Bootstrap entry point
├── config/
│   └── configuration.ts    # Configuration factory
├── prisma/
│   ├── prisma.service.ts   # Prisma client wrapper
│   └── prisma.module.ts    # Prisma module
├── common/
│   └── redis/
│       ├── game-redis.service.ts  # Redis game state management
│       └── redis.module.ts
├── modules/
│   ├── auth/               # Authentication (JWT)
│   │   ├── auth.service.ts
│   │   ├── auth.controller.ts
│   │   ├── strategies/jwt.strategy.ts
│   │   ├── guards/jwt-auth.guard.ts
│   │   └── dto/
│   ├── quiz/               # Quiz CRUD
│   │   ├── quiz.service.ts
│   │   ├── quiz.controller.ts
│   │   └── dto/
│   ├── game/               # WebSocket game logic
│   │   ├── game.gateway.ts
│   │   └── dto/game-events.dto.ts
│   └── player/             # Player queries
│       ├── player.service.ts
│       └── player.controller.ts
└── test/                   # E2E tests
```

## Redis Data Model

All keys of a game expire after 24 h and are deleted by the game cleanup (30 s after the podium).
Multi-key updates are atomic (Lua scripts / MULTI), see `src/common/redis/game-redis.service.ts`.

| Key | Type | Content |
|-----|------|---------|
| `game:{pin}:state` | Hash | `status` (`LOBBY` / `QUESTION_ACTIVE` / `QUESTION_RESULT` / `PODIUM`), `currentQuestionIndex`, `questionStartTime`, `startedAt`, `quizId`, `quizTitle`, `questionCount`, `hostId` (empty = anonymous), `roomId` (empty = no room), `maxPlayers`, `createdAt` |
| `game:{pin}:host_token` | String | Host token (uuid v4), compared in constant time |
| `game:{pin}:players` | Hash | `playerId` -> JSON `{ id, nickname, joinedAt }` (immutable profile) |
| `game:{pin}:leaderboard` | Sorted set | `playerId` -> score (`ZINCRBY`) |
| `game:{pin}:streaks` / `game:{pin}:correct` | Hash | `playerId` -> counter (`HINCRBY`) |
| `game:{pin}:connected` | Hash | `playerId` -> `1` / `0` |
| `game:{pin}:nicknames` | Hash | lower-cased nickname -> `playerId` (`HSETNX`, case-insensitive uniqueness) |
| `game:{pin}:answers:{questionIndex}` | Hash | `playerId` -> JSON `{ playerId, optionId, submittedAt, timeElapsed, isCorrect, pointsEarned }` (`HSETNX`: one answer per player) |
| `game:{pin}:lobby_timer` / `game:{pin}:question_timer` | String | Deadline (epoch ms), PX TTL |
| `game:pin:{pin}:reserved` | String | PIN / room code reservation |
| `player:token:{token}` / `game:{pin}:player_token:{playerId}` | String | Reconnection token mapping |

Scores, streaks and correct-answer counts are applied at the **end** of each question (nothing leaks while the
question is open).

## WebSocket protocol

The protocol (events, payloads, snapshots, error codes) is normative and documented in
[`docs/adr/0001-websocket-game-protocol.md`](../docs/adr/0001-websocket-game-protocol.md). Summary:

- URL: `ws://localhost:3000/game` (native WebSocket, `ws` through `@nestjs/platform-ws` `WsAdapter`, path `/game`, no `/api` prefix).
- Frames: one JSON text message `{ "event": string, "data": object }`, max 16 KB.
- Origin check: a browser `Origin` different from `FRONTEND_URL` is closed with code `1008`; no `Origin` (non-browser) is accepted.
- Game identifier: `pin` (`^[A-Z0-9]{6,8}$`, trimmed and upper-cased by the server). REST games: `pin` === room code. Anonymous WS games: 6 digits (8 as fallback).
- Host authorization: `hostToken` returned by `POST /api/games` and `host:game_created`, required by `host:join_game`, `host:start_game`, `host:next_step`.
- Every invalid payload (missing / extra / ill-typed field) gets `error { code: 'VALIDATION_ERROR' }`; unexpected failures get `INTERNAL_ERROR` (details only in server logs).

| Client -> Server | `data` |
|------------------|--------|
| `host:create_game` | `{ quizId, shareToken? }` (public quiz, or matching share token) |
| `host:join_game` / `host:start_game` / `host:next_step` | `{ pin, hostToken }` |
| `player:join` | `{ pin, nickname }` |
| `player:reconnect` | `{ playerToken }` |
| `player:submit_answer` | `{ pin, questionIndex, optionId, playerToken }` |

Server -> client events: `host:game_created`, `game:state_changed`, `lobby:player_joined`, `lobby:timer`,
`player:joined`, `player:state_sync`, `question:started`, `question:answer_count`, `player:answer_accepted`,
`question:ended`, `player:feedback`, `game:podium`, `error`. See the ADR for payloads and snapshot ordering.

## Score Calculation

```typescript
// Formula: Round((1 - (timeElapsed / (timeLimit * 2))) * maxPoints)
const maxPoints = 1000 * pointsMultiplier;
const timeFactor = 1 - timeElapsedMs / (timeLimitMs * 2);
const score = Math.round(Math.max(0, timeFactor) * maxPoints);
```

- **Correct answer**: Time-based score (faster = more points)
- **Wrong answer**: 0 points
- **Streak**: Consecutive correct answers (visual only)

## Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- Redis 7+

### Local Development

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your database/redis credentials

# Apply the schema, then generate the Prisma client
# (T-008: GameSession.hostId is optional, pin / room code are VarChar(8)).
# Warning: the local DB was built with `prisma db push` and prisma/migrations is gitignored, so
# `prisma migrate dev` will likely detect drift and propose a reset (data loss). Prefer:
npx prisma db push        # never add --accept-data-loss without a backup
npm run prisma:generate

# Seed database (optional)
npm run prisma:seed

# Start development server
npm run start:dev
```

### Docker Development

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f backend

# Run migrations
docker-compose exec backend npm run prisma:migrate

# Seed database
docker-compose exec backend npm run prisma:seed
```

### Production Build

```bash
npm run build
npm run start:prod
```

## API Documentation

Swagger UI available at: `http://localhost:3000/api/docs`

### Main Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | No | Register user |
| POST | `/api/auth/login` | No | Login user |
| GET | `/api/auth/me` | Yes | Get profile |
| POST | `/api/quizzes` | Yes | Create quiz |
| GET | `/api/quizzes` | Yes | List own quizzes |
| GET | `/api/quizzes/public` | No | List all quizzes |
| GET | `/api/quizzes/:id` | No | Get quiz details |
| GET | `/api/quizzes/:id/game` | No | Get quiz for game (no answers) |
| PUT | `/api/quizzes/:id` | Yes | Update quiz |
| DELETE | `/api/quizzes/:id` | Yes | Delete quiz |
| GET | `/api/players/game/:pin` | No | Get game players |
| GET | `/api/players/session/:id` | No | Get game results |

## WebSocket Connection

```
ws://localhost:3000/game
```

## Game Flow

```
1. Host: POST /api/games { quizId } (JWT) -> { roomCode, pin, quizTitle, questionCount, hostToken }
   or anonymous host: WS host:create_game { quizId, shareToken? } -> host:game_created { pin, ..., hostToken }
2. Host: WS host:join_game { pin, hostToken } -> snapshot; starts the 59 s lobby countdown
3. Players: WS player:join { pin, nickname } -> player:joined { playerId, playerToken, ... }
4. Host: WS host:start_game { pin, hostToken } (>= 1 player), or auto-start when the lobby expires
5. Loop per question:
   a. Server: question:started -> everyone
   b. Players: player:submit_answer -> player:answer_accepted (no correctness yet)
   c. Server: question:answer_count every 500 ms
   d. Timeout -> question:ended (broadcast) + player:feedback (every player, also non-answerers)
   e. Host: host:next_step { pin, hostToken }
6. After the last question: game:podium; results saved (GameSession ENDED + PlayerResult); cleanup after 30 s
```

## Reconnection Flow

1. Player stores `playerToken` in localStorage
2. On reconnect: WS `player:reconnect { playerToken }`
3. Server validates token, restores player state
4. Server sends current game state to player
5. Player resumes seamlessly

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `REDIS_HOST` | Redis host | localhost |
| `REDIS_PORT` | Redis port | 6379 |
| `REDIS_PASSWORD` | Redis password | (empty) |
| `REDIS_DB` | Redis database number | 0 |
| `JWT_SECRET` | JWT signing secret | Required |
| `JWT_EXPIRES_IN` | Token expiration | 7d |
| `PORT` | HTTP server port | 3000 |
| `NODE_ENV` | Environment | development |
| `FRONTEND_URL` | CORS origin | http://localhost:5173 |

## Scaling Considerations

- **Horizontal scaling**: Run multiple backend instances behind a load balancer
- **Redis Pub/Sub**: Use `publishGameEvent` / `subscribeToGameEvents` for cross-instance events
- **Sticky sessions**: WebSocket connections require sticky sessions or Redis-backed session store
- **Connection limits**: Each instance handles ~10,000 concurrent WebSocket connections

## Testing

No Docker needed for unit tests: Redis is mocked (hand mocks + `ioredis-mock`, which also runs the Lua scripts).

```bash
# Unit tests
npm run test

# WebSocket transport e2e (real ws server, mocked services, no DB / Redis)
npx jest --config ./test/jest-e2e.json test/game-gateway.e2e-spec.ts

# Full E2E tests (require a valid .env with PostgreSQL + Redis)
npm run test:e2e

# Coverage
npm run test:cov
```

## License

MIT