---
id: T-023
title: Quiz builder aligned with backend validation (image URL, integer time limit, empty options, French errors)
status: todo
owner: fullstack-devops
author_of_code: (filled by the implementer)
priority: P1
size: S
---

## Context
T-010 hardened the quiz DTOs (backend). The quiz builder still lets the author enter values the backend now
rejects with a 400, and shows the raw English, comma-joined Nest messages in a French UI. Result: the author
fills a quiz, clicks save and gets an unreadable error. No data corruption (the backend rejects), but the main
author flow is degraded. Source: T-010 Implementation log, "Quiz-builder discrepancies" 1, 2, 3, 5.

## User story
As a quiz author, I want the builder to tell me in French, before saving, which field is invalid,
so that I can fix it instead of getting a technical error.

## Acceptance criteria
- [ ] Given an image URL that is not an absolute `http(s)://` URL with a host (e.g. `/img.png`, `data:...`, `javascript:...`) or longer than 2048 chars, when the author saves, then the save is blocked and the question shows a French message (e.g. "L'URL de l'image doit commencer par http:// ou https://"). An empty image field is allowed (sent as absent, as today).
- [ ] Given a time limit that is not an integer between 5 and 120 (e.g. `7.5`, empty, `0`, `121`), when the author saves, then the save is blocked with a French message. The check runs on the save path (today `handleSave` relies on `validationErrors`, which does not check `timeLimit`; `validateQuiz()` does but is not used on save) - one validation function, not two diverging ones.
- [ ] Given an option with empty (or whitespace-only) text, when the author saves, then the save is blocked with a French message naming the question and option.
- [ ] Given the backend still answers 400 (rule not mirrored client-side), when the save fails, then the builder shows a French generic message ("Le quiz contient des valeurs invalides") followed by the backend details, never a bare comma-joined string as the only feedback.
- [ ] Unit test or manual check recorded for each rule above (execution requested from the user).

## Out of scope
- Creating 2- or 3-option questions in the builder (backend allows it, product decision needed).
- Raising the 20-question client cap (backend allows 100).
- Image upload / hosting, image preview.
- Backend changes (T-010 is the reference for the rules: `fastquizz-backend/src/modules/quiz/dto/create-quiz.dto.ts`).

## Technical notes
- Files: `fastquizz-frontend/src/lib/stores/quiz-builder.ts` (`validationErrors`, `validateQuiz`), `src/lib/components/QuestionEditor.svelte`, `src/routes/admin/quiz-builder/+page.svelte` (`handleSave`), `src/lib/utils/api.ts` (error message building).
- `+page.svelte` is also touched by T-019: start after T-019 is merged (no two agents on the same file).
- No new dependency (a `new URL()` + protocol check is enough; mirror the backend's "host with a dot" rule only if simple, else let the 400 fallback handle `localhost`).
- Depends on T-010 being merged (rules must exist backend-side).

## Estimate
Optimistic 0.25 d / probable 0.5 d / pessimistic 1 d.

## Implementation log
(filled by the implementer)

## Review
(filled by tech-lead-po)

## QA report
(filled by the QA agent)
