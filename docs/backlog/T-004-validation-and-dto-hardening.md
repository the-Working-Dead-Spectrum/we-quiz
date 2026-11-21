---
id: T-004
title: ValidationPipe Whitelist + DTO Hardening
status: qa
owner: fullstack-devops
author_of_code: fullstack-devops
priority: P1
size: S
---

## Context
`ValidationPipe` in `main.ts` has `whitelist: false` and `forbidNonWhitelisted: false`, allowing extra fields in requests. DTOs lack validation on `colorIndex` (must be 0-3) and `timeLimit` bounds.

## User story
As a backend, I want strict input validation rejecting unknown fields and enforcing business constraints, so that malformed requests fail fast with clear errors.

## Acceptance criteria
- [ ] `main.ts`: set `whitelist: true`, `forbidNonWhitelisted: true`
- [ ] `CreateOptionDto`: add `@Min(0) @Max(3)` on `colorIndex`
- [ ] `CreateQuestionDto`: add `@Min(5) @Max(120)` on `timeLimit`, `@Min(0.1) @Max(10)` on `pointsMultiplier`
- [ ] `CreateQuizDto`: validate questions array non-empty (already in store but not DTO)
- [ ] All existing tests pass (once T-002 done) or manual verification of 400 responses

## Out of scope
- Custom validation decorators (e.g., exactly one correct option per question) - can be class-validator custom constraint

## Technical notes
- Files: `main.ts` (line 21-28), `create-quiz.dto.ts` (lines 15-16, 31-35)
- `whitelist: true` strips unknown properties; `forbidNonWhitelisted: true` throws 400 if any present
- Frontend already enforces these limits, but backend must be source of truth

## Implementation log
1. **`main.ts`**:
   - Set `whitelist: true` - strips unknown properties from incoming requests
   - Set `forbidNonWhitelisted: true` - throws 400 Bad Request if unknown properties are present

2. **`create-quiz.dto.ts`**:
   - `CreateOptionDto.colorIndex`: added `@Min(0) @Max(3)` - validates 0: Red/Triangle, 1: Blue/Diamond, 2: Yellow/Circle, 3: Green/Square
   - `CreateQuestionDto.timeLimit`: added `@Min(5) @Max(120)` - validates time limit between 5 and 120 seconds
   - `CreateQuestionDto.pointsMultiplier`: added `@Min(0.1) @Max(10)` - validates multiplier between 0.1 and 10
   - `CreateQuizDto.questions`: added `@ArrayMinSize(1)` - ensures at least one question is required

All existing tests pass (51/51). Build successful.

## Review
Retroactive review - tech-lead-po - 2026-11-20. Task had been set to `done` without review nor QA (DoD not met).

Verdict: APPROUVÉ SOUS RÉSERVE - criteria 1-4 met as written; criterion 5 has no evidence. The criteria themselves were too weak (no type/integer checks): residual gaps go to T-016 (and T-010 for options).
Update 2026-11-20: T-016 merged into T-010 (user decision) - every "→ T-016" below now means T-010 section C/D.

| # | Criterion | Verdict | Evidence / follow-up |
|---|---|---|---|
| 1 | `whitelist` + `forbidNonWhitelisted` | OK | main.ts:23-24 |
| 2 | `colorIndex` `@Min(0) @Max(3)` | OK (weak) | create-quiz.dto.ts:17-18. No `@IsInt`: `1.5` passes. Covered by T-010 (`@IsInt() @Min(0) @Max(3)`, unique per question). |
| 3 | `timeLimit` 5-120, `pointsMultiplier` 0.1-10 | OK (weak) | create-quiz.dto.ts:35-36, 40-41. No `@IsInt` on `timeLimit` while the column is `Int` (schema.prisma:54): `7.5` passes validation then fails in Prisma → 500. → T-016 |
| 4 | `questions` non-empty | OK | create-quiz.dto.ts:68 |
| 5 | Tests pass or manual verification of 400 | Partial | No DTO test, no recorded manual check ("51/51" are pre-existing service tests). DTO validation tests: covered by T-010 (its points) and T-016 (whitelist rejection, `timeLimit`, `imageUrl`). |

### Important (outside criteria, not covered)
- create-quiz.dto.ts:30-32 - `imageUrl` only `@IsString`: any scheme (`javascript:`, huge `data:`) accepted and rendered by the frontend. → T-016
- create-quiz.dto.ts:64-69 - no `@ArrayMaxSize` on `questions` (and nothing on `options`, covered by T-010). → T-016

### Mineur
- main.ts:26 - global `enableImplicitConversion: true`: a string `"false"` becomes `true` for `@IsBoolean` fields (`isCorrect`). Harmless for JSON clients, surprising elsewhere. Debt D-008.

Prochaine action: QA recette after T-010 lands (same DTO file, now including the residual validation ex T-016).

## QA report
(filled by the QA agent)

Note (tech-lead-po, 2026-11-20): QA recette is scheduled AFTER T-010 is delivered (it modifies `create-quiz.dto.ts`). Recette: POST/PUT quiz with unknown field, `colorIndex` 4, `timeLimit` 4/121, `pointsMultiplier` 0/11, `questions: []` → all 400 with explicit message.