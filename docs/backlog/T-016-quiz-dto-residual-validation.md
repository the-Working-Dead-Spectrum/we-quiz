---
id: T-016
title: Quiz DTO residual validation - integer timeLimit, safe imageUrl, max questions, validation tests
status: superseded
superseded_by: T-010
owner: fullstack-devops
author_of_code: (none - never started)
priority: P1
size: S
---

> **Merged into T-010** (user decision 2026-11-20). All acceptance criteria and technical notes below were moved to
> `T-010-quiz-api-security.md` (section C and D). Do not implement this file; it is kept for traceability only and
> is no longer in the active backlog index.

## Context
Follow-up of the T-004 retro review. T-004's criteria were met literally but were too weak:
`timeLimit` accepts decimals (column is `Int` → Prisma error → 500), `imageUrl` accepts any string
(`javascript:`, multi-MB `data:` URIs) that the frontend renders, `questions` has no upper bound, and no test
proves the 400 responses. Options count, exactly-one-correct and integer `colorIndex` are already in T-010.

## User story
As a quiz author, I want invalid quiz payloads rejected with a clear 400, so that I never get a 500 nor
store content that breaks or endangers the players' screens.

## Acceptance criteria
- [ ] `CreateQuestionDto.timeLimit`: `@IsInt() @Min(5) @Max(120)`; `7.5` → 400.
- [ ] `CreateQuestionDto.pointsMultiplier`: `@IsNumber() @Min(0.1) @Max(10)`.
- [ ] `CreateQuestionDto.imageUrl`: optional, `@IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(2048)`; `javascript:alert(1)` and `data:...` → 400.
- [ ] `CreateQuizDto.questions`: `@ArrayMaxSize(100)` (101 → 400).
- [ ] DTO validation tests (`ValidationPipe` with the same options as `main.ts`): each rule above + an unknown field → 400 (`forbidNonWhitelisted`, T-004 criterion 5) + the same rules through `UpdateQuizDto` (partial).
- [ ] Execution requested from the user.

## Out of scope
- Rules owned by T-010 (2-4 options, exactly one correct, `colorIndex` int + unique).
- Changing the global `ValidationPipe` options (debt D-008).
- Image upload / hosting.

## Technical notes
- Files: `fastquizz-backend/src/modules/quiz/dto/create-quiz.dto.ts`, a DTO spec file in `src/modules/quiz/`.
- Conflicts: same file as T-010 → **starts after T-010 is in `qa` or later**. Recommended alternative (user decision): merge these criteria into T-010 before T-010 starts (one PR on the same file, +0.25 d).
- Frontend quiz builder may need the same bounds displayed; not in scope unless the builder currently allows values the backend now rejects (check and report).

## Estimate
Optimistic 0.25 d / probable 0.5 d / pessimistic 0.75 d.

## Implementation log
(filled by the implementer)

## Review
(filled by tech-lead-po)

## QA report
(filled by the QA agent)
