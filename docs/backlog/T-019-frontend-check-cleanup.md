---
id: T-019
title: Frontend svelte-check cleanup - quiz-builder TS errors and remaining a11y warnings
status: todo
owner: fullstack-devops
author_of_code: (filled by the implementer)
priority: P1
size: S
---

## Context
`npm run check` run during T-009 (2026-11-20) reports 2 pre-existing TypeScript errors and 9 a11y warnings in
files T-009 did not touch. A red type-check hides new regressions and blocks a future CI gate (T-015).
The 6 warnings in `admin/+page.svelte` 294-329 are NOT in scope: they are fixed in T-009 (review item R-1).

## User story
As the team, I want `svelte-check` to report 0 errors and 0 warnings, so that any new finding is a real regression
and the CI gate (T-015) can be strict.

## Acceptance criteria
- [ ] `src/routes/admin/quiz-builder/+page.svelte:121:26` - `Property 'success' does not exist on type 'QuizBuilderState'`: fixed by using what the store actually returns (check `quiz-builder.ts` save path), no `any`, no cast to silence it. Behaviour after save unchanged (or the dead branch removed, documented).
- [ ] `src/routes/admin/quiz-builder/+page.svelte:147:26` - `bind:this` HTMLInputElement vs HTMLTextAreaElement: variable typed to the element actually bound.
- [ ] a11y warnings fixed (no blanket `svelte-ignore`; a scoped ignore only with a one-line justification): `admin/quiz-builder/+page.svelte:69`, `auth/login/+page.svelte:40, 66, 78`, `auth/register/+page.svelte:52, 78, 90, 102, 116`.
- [ ] Given `npm run check` (execution requested from the user), then 0 errors and 0 warnings in the whole frontend (assuming T-009 R-1 has landed).
- [ ] `npm run build` passes (execution requested from the user).
- [ ] Manual check: create/edit a quiz, register, log in - no visual or behavioural regression.

## Out of scope
- Any change to the quiz-builder features or auth flow.
- Files owned by T-009 (`admin/+page.svelte`, game pages, stores).
- Adding lint tooling or dependencies.

## Technical notes
- Starts after T-009 R-1 is merged to avoid two agents in `admin/**` at once (quiz-builder page is separate, but keep WIP low).
- No dependency or config change.

## Estimate
Optimistic 0.25 d / probable 0.5 d / pessimistic 1 d (hypothesis: the `success` error is a dead branch, not a missing store feature).

## Implementation log
(filled by the implementer)

## Review
(filled by tech-lead-po)

## QA report
(filled by the QA agent)
