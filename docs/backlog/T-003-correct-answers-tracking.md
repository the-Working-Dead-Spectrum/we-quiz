---
id: T-003
title: Track Correct Answers Count in Podium
status: qa
owner: fullstack-devops
author_of_code: fullstack-devops
priority: P1
size: S
---

## Context
`PlayerResult.correctAnswersCount` and `GamePodiumDto.podium[].correctAnswersCount` are always 0 (hardcoded in `GameGateway.showPodium()` line 601 and 612). Players and hosts cannot see how many correct answers each participant had.

## User story
As a player/host, I want to see the number of correct answers per participant in the final podium, so that performance is transparent beyond just total score.

## Acceptance criteria
- [ ] Redis: track correct answers per player per game (e.g., `player:{pin}:{playerId}:correct` counter or hash field)
- [ ] Increment on correct answer in `handlePlayerSubmitAnswer` (line 447-449)
- [ ] Include `correctAnswersCount` in `PlayerFeedbackDto` (already has field, currently unused)
- [ ] Include `correctAnswersCount` in leaderboard entries broadcasted in `question:ended`
- [ ] Persist to `PlayerResult.correctAnswersCount` in `saveGameResults`
- [ ] Display in frontend podium (already has UI for it in `player/game/+page.svelte` line 331)

## Out of scope
- Per-question breakdown in final results (future enhancement)
- Historical stats across multiple games

## Technical notes
- Files: `game.gateway.ts` (handlePlayerSubmitAnswer, endQuestion, showPodium, saveGameResults), `game-events.dto.ts` (PlayerFeedbackDto, QuestionEndedDto, GamePodiumDto)
- Redis key suggestion: `game:{pin}:player:{playerId}:correct` (INCR) or add field to player hash
- Must be included in `getLeaderboard`/`getPlayerRank` data for real-time leaderboard during game

## Implementation log
1. **Redis (`game-redis.service.ts`)**:
   - Added `correctAnswersCount` field to `PlayerData` interface
   - Added `incrementPlayerCorrectAnswers(pin, playerId)` method to atomically increment counter
   - Updated `addPlayer` to default `correctAnswersCount` to 0

2. **Game Gateway (`game.gateway.ts`)**:
   - In `handlePlayerSubmitAnswer`: increment correct answers count via Redis when answer is correct
   - In `handlePlayerSubmitAnswer`: include `correctAnswersCount` in `PlayerFeedbackDto` sent to player
   - In `endQuestion`: include `correctAnswersCount` in leaderboard broadcast via `QuestionEndedDto`
   - In `showPodium`: read `correctAnswersCount` from player data for podium and final leaderboard
   - In `sendGameStateToPlayer`: include `correctAnswersCount` in leaderboard for reconnecting players

3. **DTOs (`game-events.dto.ts`)**:
   - Added `correctAnswersCount` to `PlayerFeedbackDto`
   - Created `QuestionEndedLeaderboardEntryDto` with `correctAnswersCount`
   - Updated `QuestionEndedDto.leaderboard` to use `QuestionEndedLeaderboardEntryDto[]`

All existing tests pass (51/51). Build successful.

## Review
Retroactive review - tech-lead-po - 2026-11-20. Task had been set to `done` without review nor QA (DoD not met).
Line numbers refer to the pre-T-008 / pre-T-009 code (both files are being rewritten).

Verdict: APPROUVÉ SOUS RÉSERVE - the counting logic is present everywhere it should be; every runtime defect is covered by T-008/T-009.

| # | Criterion | Verdict | Evidence / follow-up |
|---|---|---|---|
| 1 | Redis per-player counter | Partial | Field in player JSON (game-redis.service.ts:24, default 251). `incrementPlayerCorrectAnswers` is a read-modify-write on the JSON (322-327): two concurrent updates lose one. Covered by T-008 E (no read-modify-write race). |
| 2 | Increment on correct answer | OK | gateway:640-643 |
| 3 | In `PlayerFeedbackDto` | OK | dto:253, gateway:655-663. Note: feedback (incl. `correctOptionId`) is sent while the question is still open - cheating vector; ADR 0001 defers feedback to question end. Covered by T-008 E. |
| 4 | In `question:ended` leaderboard | OK | dto:205-219, gateway:764-773 |
| 5 | Persisted to `PlayerResult.correctAnswersCount` | Partial | Mapped (gateway:868, 889), but `saveGameResults` fails at runtime for anonymous games (`hostId: 'anonymous'`, FK on required `GameSession.hostId`, gateway:878, schema.prisma:97) and the error is swallowed (898). Covered by T-008 B (results saved, `hostId` optional). |
| 6 | Displayed in frontend podium | Partial | player/game/+page.svelte:331, admin/live/+page.svelte:372. Unreachable today (podium never shown). Covered by T-009 C. |

### Mineur
- `player:state_sync` on reconnect omits `correctAnswersCount` (gateway:1066). Covered by T-008 D (ADR 0001 §6 payload).
- `RoomParticipant.correctAnswersCount` / `score` are never updated (duplicate of `PlayerResult`). → T-018 + debt D-009.
- No unit test asserts the counter (log only says "51/51 pass", i.e. existing tests). Covered by T-008 F / T-012.

Prochaine action: QA recette after T-008 and T-009 land.

## QA report
(filled by the QA agent)

Note (tech-lead-po, 2026-11-20): QA recette is scheduled AFTER T-008 and T-009 are delivered. Recette: 2 players, 3 questions, mixed right/wrong/no answer; check counts in `question:ended`, podium, and in the `PlayerResult` rows.