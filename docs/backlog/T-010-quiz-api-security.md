---
id: T-010
title: Quiz REST API - stop answer leaks and IDOR, transactional update, playable-quiz and input validation
status: doing
owner: fullstack-devops
author_of_code: fullstack-devops
priority: P1
size: M
---

## Context
The quiz REST API leaks correct answers to anonymous callers, lets any logged-in user list another user's
private quizzes, can wipe all questions of a quiz on a partial update, and accepts quizzes that freeze the
live game (no correct option). These are security and data-integrity defects, independent of the live
game fix (T-008/T-009) and confined to the quiz module.

## User story
As a quiz author, I want my private quizzes and their answers to stay private and my edits to be
all-or-nothing, so that players cannot cheat and I never lose content.

## File ownership (strict)
- Allowed: `fastquizz-backend/src/modules/quiz/**` only (controller, service, module, DTOs, custom validators, `*.spec.ts` inside this folder).
- Forbidden: everything else - in particular `src/main.ts`, `src/common/**`, `src/modules/game/**`, `prisma/**`, `test/**`, `package.json` (T-008 owns the rest of the backend and is in progress), `fastquizz-frontend/**`, `docs/adr/**`, any `.env*`.
- No file overlap with T-008: it can run in parallel with T-008. WIP: start when a `doing` slot is free (coordinator checks that T-009 R-1/R-2 fixes are not holding the second slot).
- Merged scope (user decision 2026-11-20): T-016 (residual quiz DTO validation) is merged into this task - section C below. T-016 is superseded.

## Acceptance criteria

### A. Answer leaks and IDOR
- [x] S2 - `GET /api/quizzes/:id` requires JWT. Owner → full quiz (with `isCorrect`). Non-owner and quiz public → quiz without `isCorrect` on any option. Non-owner and private → 404 (existence not revealed).
- [x] S2 - `GET /api/quizzes/public` never returns `isCorrect` (and no author email/password fields).
- [x] S2 - `GET /api/quizzes/shared/:token` and `GET /api/quizzes/:id/game` verified to never return `isCorrect` (regression test).
- [x] S3 - `GET /api/quizzes` ignores any `authorId` query parameter and always lists `req.user.sub`'s quizzes.

### B. Transactional update
- [x] M9 - `PUT /api/quizzes/:id`: ownership check, then question replacement and quiz update in ONE `prisma.$transaction`; questions are replaced only if `dto.questions` is provided; a payload without `questions` keeps them intact.

### C. DTO validation (B7 + merged T-016)
- [x] B7 - `CreateQuizDto` (and update DTO through it): each question has 2-4 options (`@ArrayMinSize(2) @ArrayMaxSize(4)`), exactly one `isCorrect: true` (custom class-validator constraint), `colorIndex` `@IsInt() @Min(0) @Max(3)` and unique within the question. Invalid → 400 with an explicit message.
- [x] (ex T-016) `CreateQuestionDto.timeLimit`: `@IsInt() @Min(5) @Max(120)`; `7.5` → 400 (column is `Int`: today it passes validation and fails in Prisma → 500).
- [x] (ex T-016) `CreateQuestionDto.pointsMultiplier`: `@IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0.1) @Max(10)`.
- [x] (ex T-016) `CreateQuestionDto.imageUrl`: optional, `@IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(2048)`; `javascript:alert(1)` and `data:...` → 400.
- [x] (ex T-016) `CreateQuizDto.questions`: `@ArrayMaxSize(100)` (101 → 400), keeps `@ArrayMinSize(1)`.
- [x] Every rule of section C also applies through `UpdateQuizDto` (partial: absent fields allowed, present fields validated).

### D. Tests
- [x] Unit tests in `quiz.service.spec.ts` cover sections A and B (owner / non-owner public / non-owner private, no `isCorrect` on public/shared/game paths, `authorId` ignored, update without `questions` keeps them, transaction used). (`authorId` ignored is a controller concern: covered in `quiz.controller.spec.ts`.)
- [x] DTO validation spec inside `src/modules/quiz/` (e.g. `dto/create-quiz.dto.spec.ts`) runs a local `new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } })` - same options as `main.ts`, without touching `main.ts` - and covers each rule of section C, plus an unknown field → 400 (closes T-004 criterion 5).
- [x] Execution of `npm test` requested from the user; results pasted in the Implementation log. (Run by the main session with user permission, 2026-11-20: build OK; quiz suites `create-quiz.dto.spec.ts`, `quiz.service.spec.ts`, `quiz.controller.spec.ts` PASS; overall 261/263, the 2 failures are in T-008's Redis Lua spec. To re-run after the review fixes.)

## Out of scope
- Live game, game creation, `POST /api/games` (T-008).
- Frontend (the quiz builder already enforces exactly one correct answer; `api.quizzes.list` cleanup is in T-009).
- Pagination, quiz versioning, soft delete.
- Changing the global `ValidationPipe` options in `main.ts` (debt D-008; file owned by T-008).
- Image upload / hosting. Any frontend change: if the quiz builder lets the user enter values the backend now rejects (`imageUrl` scheme, decimal time limit, > 100 questions), report it in the Implementation log (read-only check of `fastquizz-frontend/src/routes/**/quiz*`); the fix goes to a frontend task.

## Technical notes
- Findings: `quiz.controller.ts` 36-51; `quiz.service.ts` 44-76 (`findAll`, `findOne`), 78-110 (`update`, `deleteMany` at 86), `findPublic` ~250; `create-quiz.dto.ts`.
- Reuse the existing stripping logic of `getQuizForGame` (one private mapper) rather than duplicating it.
- `update()` currently calls `findOne()` for the ownership check: after S2, use an internal lookup that does not apply the public/stripped logic.
- Editing a quiz while a live game runs on it is a known risk (questions are re-created with new ids) - documented as debt, not fixed here.
- The "exactly one correct" and "unique `colorIndex`" rules are cross-field: implement them as class-validator custom constraints on the `options` array (one file in `quiz/dto/`), with explicit messages (e.g. `Each question must have exactly one correct option`).
- `pointsMultiplier`: use `@IsNumber({ allowNaN: false, allowInfinity: false })`.
- Cross-references (retro review 2026-11-20): T-016 merged here (user decision). T-011 (REST integration tests) asserts this task's behaviour and starts after it. T-002 criterion 2 (`getQuizForGame` test) and T-004 criteria 2/3/5 (`colorIndex` int, `timeLimit` int, DTO tests) are satisfied by this task.
- PR size: expected well under 400 changed lines; if the DTO spec makes it exceed, deliver in two checkpoints (A+B, then C+D) recorded in the Implementation log.

## Estimate
Optimistic 0.75 d / probable 1.25 d / pessimistic 2 d (includes the merged T-016 scope, +0.25 d).

## Implementation log
2026-11-20 - fullstack-devops. Code written, **tests NOT executed yet** (no command run, per instructions). Criteria are checked on the basis of the code + written specs; the last D criterion stays open until the user runs the tests.

### Files touched (all inside `fastquizz-backend/src/modules/quiz/`)
- `quiz.service.ts` (rewritten, ~+130/-140): shared `QUIZ_INCLUDE` (author = `{id, name}` only); single private mapper `toPublicView()` (drops `isCorrect` and `shareToken`) reused by `findOne` (non-owner), `findPublic`, `getQuizByShareToken`, `getQuizForGame`; `findOne(id, userId)` owner/public/404; `findAll(userId)` mandatory; private `assertOwner(client, ...)` (narrow `select`, NOT `findOne()`) used by update/delete/togglePublic/share/revoke; `update()` = interactive `$transaction` (ownership → `deleteMany` only if `questions` present → `quiz.update`), timeout 15 s; `toQuestionCreateInput()` shared by create/update.
- `quiz.controller.ts` (~+8/-6): `GET /` drops `@Query('authorId')`; `GET /:id` gets `JwtAuthGuard` and passes `req.user.sub`.
- `dto/create-quiz.dto.ts` (~+45/-10): rules of section C; exported `QUIZ_LIMITS`.
- `dto/option-rules.validator.ts` (new, ~47): `@HasExactlyOneCorrectOption()`, `@HasUniqueColorIndexes()` (registerDecorator, no new dependency).
- `quiz.service.spec.ts` (rewritten, ~390): sections A + B, incl. call order deleteMany < update, non-owner writes nothing, error propagation.
- `quiz.controller.spec.ts` (new, ~45): `authorId` ignored, `JwtAuthGuard` metadata on `findOne`, caller id forwarded.
- `dto/create-quiz.dto.spec.ts` (new, ~250): local `ValidationPipe` with `main.ts` options; every rule of C on `CreateQuizDto` and `UpdateQuizDto`, unknown top-level and nested fields.
- `update-quiz.dto.ts`, `quiz.module.ts`: unchanged.
- Size: ~230 lines of production code, ~685 lines of tests. Above the 400-line guideline only because of the specs; production diff is well under. Single PR suggested (splitting the specs from the code they test adds review cost without benefit) - reviewer may ask for the 2-checkpoint split.

### Decisions
- `shareToken` is also removed from every non-owner view (`/public`, non-owner `/:id`, `/:id/game`, `/shared/:token`). Reason: `/public` exposed it, and per ADR 0001 §5 a share token allows anonymous `host:create_game` even after the owner makes the quiz private. Owner views (list, create, update, share) still return it. The frontend only reads `shareToken` on `/admin` (owner list) - no impact. Reviewer: revert = 1 line in `toPublicView` if you consider it out of scope.
- Non-owner PUT/DELETE/public/share keep returning **403** (unchanged contract) while non-owner GET of a private quiz returns 404. That is a minor existence oracle (UUID ids, low risk) - see suggestion below.
- `update()` ownership check runs inside the transaction (same `tx`), so check and write are atomic.
- Custom constraint messages start with `$property:` so Nest's flattened output reads e.g. `questions.0.options: each question must have exactly one correct option (isCorrect: true)`.

### Quiz-builder discrepancies (frontend NOT modified - for a frontend task)
1. `imageUrl` (`QuestionEditor.svelte` free text input): no scheme check client-side. Relative paths, `localhost` URLs (`@IsUrl` requires a TLD by default), `data:` URIs are now 400. Before: accepted (and `javascript:` too).
2. `timeLimit`: `<input type="number" step="5">` but free typing allows `7.5`, and `handleSave` only checks the `validationErrors` store, which does not check `timeLimit` at all (`validateQuiz()` does, but is not used on save). Before: 500 (Prisma Int); now: 400 with message.
3. Options: builder always sends 4 options with `colorIndex` 0-3 and enforces exactly one correct → compatible. But empty option text is not checked by `validationErrors` → backend 400 (`MinLength(1)`, pre-existing). The builder cannot create 2- or 3-option questions (backend now allows them).
4. Questions capped at 20 client-side (`canAddQuestion`) → under the 100 limit, compatible. `pointsMultiplier` select (0.5-2) → compatible.
5. Error display: `api.ts` builds `new Error(error.message)` with Nest's array of messages → comma-joined technical English messages shown to a French UI.
6. `api.quizzes.get` (`GET /quizzes/:id`) now requires a JWT: `fetchJson` sends it when present; no route currently calls it.

### Risks / debt (proposed entries for `docs/tech-debt.md` - not edited, file outside my allowed scope)
- `GET /api/quizzes/:id/game` has no auth and returns any quiz (incl. private ones) by id, answers stripped. Pre-existing, out of the criteria; IDs are UUIDs. Suggest a task: guard it or remove it if unused (no frontend caller found).
- `enableImplicitConversion` (D-008): a string `"false"` for `isCorrect` becomes `true` (`Boolean("false")`), which could make "exactly one correct" check pass on a wrong payload. JSON booleans from the builder are unaffected.
- Editing a quiz while a live game runs on it re-creates questions with new ids (known, per Technical notes).
- `test/quiz.e2e-spec.ts` is stale (calls `/api/quiz`, expects 403 on non-owner GET where the criterion now gives 404, `nickname` on register). Not touched (forbidden, T-011 scope).
- Interactive transaction timeout raised to 15 s for the 100x4 worst case; not measured.

### Commands for the user (permission required, nothing executed)
- `cd fastquizz-backend && npx jest src/modules/quiz` (this task's specs only)
- `cd fastquizz-backend && npm test` (full unit suite; T-008 files in progress may fail independently)
- `cd fastquizz-backend && npx tsc --noEmit -p tsconfig.json` (type check: `satisfies Prisma.QuizInclude` needs the generated Prisma client)
- Results: (to paste here)

### Suggestions for tech-lead-po (out of scope, not implemented)
- Return 404 instead of 403 for non-owner write endpoints (consistent "existence not revealed").
- Guard or remove `GET /quizzes/:id/game`.
- Frontend task for discrepancies 1, 2, 3 (empty option text), 5.

## Review
### Review — T-010 (tech-lead-po, 2026-11-20)
Verdict: **CHANGES REQUIRED** (2 blocking, both small and inside `src/modules/quiz/**`). Status → `doing`.

#### Blocking
- **B-1** `quiz.controller.ts:55-60` + `quiz.service.ts:100-108` - `GET /api/quizzes/:id/game` is unauthenticated and returns ANY quiz by id, private included (questions + option texts, answers stripped). It defeats S2 in practice: a non-owner gets 404 on `/:id` and the full content on `/:id/game`. It also survives share revocation: `/shared/:token` returns `id`, so a former link holder keeps reading the quiz after the owner revokes the token or makes it private. Inconsistent with ADR 0001 §5 / T-008 `game.service.ts:70-84` (anonymous access = public, or matching share token). **Fix:** `getQuizForGame` serves only `isPublic` quizzes; otherwise `NotFoundException('Quiz not found')` (same message as missing - existence not revealed). Tests: private → 404, public → stripped (existing). No frontend caller (`api.quizzes.getForGame` is dead code). Not chosen: removing the endpoint (API contract change, belongs to a hygiene task if ever needed).
- **B-2** `dto/create-quiz.dto.ts:36-38` - with `enableImplicitConversion` (D-008), `isCorrect: "false"` becomes `true` before `@IsBoolean` and before `@HasExactlyOneCorrectOption`: e.g. `["false", false, false, false]` is accepted and stores the wrong correct answer. This is an acceptance-criterion defect (C: "exactly one `isCorrect: true`, invalid → 400"), not just global debt. **Fix:** local `@Transform(({ obj, key }) => obj[key])` on `isCorrect` (same raw-value pattern as T-008's `game-events.dto.ts:19`; define it in `quiz/dto/`, do not import from `game/`). Test: `isCorrect: "false"` and `isCorrect: 1` → 400 `isCorrect must be a boolean value`. Global pipe untouched.

#### Important
- None beyond B-1/B-2.

#### Minor / suggestions (optional in this cycle)
- `quiz.service.ts:83` - `PartialType` + `@IsOptional` accept `title: null`; Prisma then fails on a non-nullable column → 500. Pre-existing. One-line fix (`title: dto.title ?? undefined`) if trivial; otherwise leave to T-011 to expose.
- `quiz.controller.spec.ts:16-24` - the `authorId` test is structural (the handler no longer reads the query); acceptable, the real HTTP assertion is in T-011.
- `UPDATE_TRANSACTION_TIMEOUT_MS` 15 s not measured: T-011 should include a 100 x 4 update through the real DB.

#### Checked and OK
- No `isCorrect` / `shareToken` / author `email` / `passwordHash` on `/public`, non-owner `/:id`, `/shared/:token`, `/:id/game` (single mapper `toPublicView`, regression tests via `expectNoSecrets`). Owner paths (list, create, update, toggle, share, revoke, owner `/:id`) return the full quiz - intended.
- IDOR: `GET /` ignores `authorId`; every write goes through `assertOwner` (narrow select, not `findOne`).
- Transaction: ownership check, `deleteMany` (options cascade, `schema.prisma:72`) and `quiz.update` on the same `tx`; questions untouched when absent or `null`; error propagates. Correct.
- DTO: all section C rules present, applied through `UpdateQuizDto` (`PartialType` keeps nested metadata), cross-field validators handle non-array / null entries, spec uses the `main.ts` pipe options and covers every rule + unknown fields.

#### Rulings on the implementer's points
1. `shareToken` removed from non-owner views: **approved** (real leak on `/public`; a token grants anonymous hosting per ADR 0001 §5). Keep.
2. 403 vs 404 on non-owner writes: **keep 403**. Not in the criteria, caller is authenticated, ids are UUIDs, the contract stays stable for T-011. No debt entry.
3. PR split: **single PR accepted**. Production diff ≈ 230 lines (< 400); the 685 test lines are table-driven and were read in full. Exception recorded here.
4. `/:id/game` private exposure: **blocking**, see B-1.
5. `"false"` → `true` on `isCorrect`: **blocking**, see B-2 (local fix; D-008 stays open for the global pipe).
6. `test/quiz.e2e-spec.ts` stale: **T-011** (already D-020). No action here.
- Live edit during a game: covered by D-001. No new entry.
- Quiz-builder discrepancies 1, 2, 3 (empty option text), 5 → new task **T-023** (P1, S, after T-019). Discrepancy 3 (2-3 options), 4 and 6: no action. Not folded into T-019 (its scope excludes builder feature changes).

Next action: fullstack-devops fixes B-1 and B-2 (+ tests), user re-runs `npx jest src/modules/quiz`, back to `review`; re-review limited to that diff.

## QA report
(filled by the QA agent)
