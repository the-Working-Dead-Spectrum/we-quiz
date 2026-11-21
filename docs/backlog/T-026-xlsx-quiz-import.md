---
id: T-026
title: XLSX quiz import with server-side preview
status: doing
owner: fullstack-devops
author_of_code: fullstack-devops
priority: P1
size: M
---

## Context
Hosts currently build quizzes one question at a time in the quiz-builder.
Allow them to upload an Excel file (`.xlsx`) built from the project template
(`quiz-import-template.xlsx` at repo root) to pre-fill a quiz, preview it,
then confirm. No silent creation.

## User story
As an authenticated host, I want to upload an Excel file, preview the parsed
quiz on screen and decide whether to save it as-is, open it in the builder for
fine tuning, or cancel.

## Acceptance criteria
- [ ] A new page `/admin/import` lets the user fill title/description/public
      flag, download the template and upload a `.xlsx`.
- [ ] `POST /quizzes/import/preview` parses the file server-side, returns
      `{ dto: CreateQuizDto | null, errors: [{ row, field, message }] }` and
      writes nothing in DB. JWT-protected, multipart upload capped at 2 MB,
      `.xlsx` only.
- [ ] Preview screen lists every question (image, time limit, points
      multiplier, 2 to 4 options with the correct one highlighted) and every
      error row by row.
- [ ] "Confirmer" button posts the dto to the existing `POST /quizzes` and
      redirects to the quizzes list on success.
- [ ] "Modifier dans le builder" hands the dto to the existing quiz-builder
      page pre-filled, then saves through the normal builder flow.
- [ ] "Annuler" wipes local state and goes back to the form.
- [ ] Errors cover: missing/duplicate headers, empty cells, `time_limit` out
      of 5..120, `points_multiplier` out of 0.1..10, 0 or >1 correct options,
      fewer than 2 or more than 4 options, non-http(s) `image_url`.

## Out of scope
- Multi-sheet imports.
- CSV import.
- `colorIndex` chosen by user (we derive it from column position 1..4).
- Draft persistence (parsing is stateless).

## Technical notes
- Reuses `CreateQuizDto` validation chain and `QuizService.create`.
- Backend deps added: `xlsx`, `multer`, `@types/multer`.
- `colorIndex` derived from option column index (1 -> 0 ... 4 -> 3).
- Template copied to `fastquizz-frontend/static/quiz-import-template.xlsx` so
  the frontend can serve it from `/quiz-import-template.xlsx`.

## Implementation log
(filled by fullstack-devops)

## Review
(filled by tech-lead-po)

## QA report
(filled by fullstack-qa)
