---
id: T-021
title: Host / player snapshots stay consistent when a game transition happens while they are built
status: todo
owner: fullstack-devops
author_of_code: (filled by the implementer)
priority: P1
size: S
---

## Context
Review T-008 finding I-1. `sendHostSnapshot` binds the host socket to the room right after `host:game_created`
(`game.gateway.ts` ~667), then builds the rest of the snapshot across several awaits (Redis + DB). The reconnect
path binds the player (~316) before reading the state (~724). A transition broadcast during that window reaches the
socket, then the rest of the snapshot sends the STALE status. Observed effects (by reading the T-009 stores):
host shown an expired question without the "next" button until refresh; a player reconnecting in LOBBY while the
host starts is reset to the lobby for question 0. Window ~100-300 ms with a remote Redis.

## User story
As a host or player who reconnects at any moment, I want my screen to always end in the current game state, so
that I never get stuck on a stale screen.

## Acceptance criteria
- [ ] Given a transition (LOBBY→QUESTION_ACTIVE, QUESTION_ACTIVE→QUESTION_RESULT, →PODIUM) happens while a host or
      reconnect snapshot is being built, then the last status-bearing message the socket receives reflects the new
      state. Unit tests with a transition injected between the awaits (host and player).
- [ ] ADR 0001 §7 ordering kept: `host:game_created` first, `player:state_sync` last (existing tests stay green).
- [ ] No event lost: broadcasts emitted during the snapshot are delivered after it (buffer per socket while the
      snapshot is in progress, flushed right after), OR the state is re-read after sending and the status part of
      the snapshot is re-sent if it changed. Implementer chooses, records the choice in the log.

## Out of scope
- Protocol changes (ADR 0001 stays v1).
- Multi-instance (D-003).

## Technical notes
- Files: `fastquizz-backend/src/modules/game/game.gateway.ts` (+ spec).
- Recommended: per-socket `pendingBroadcasts: string[] | null` set before binding, `send/broadcast` push to it when
  non-null, flushed after the snapshot (and in a `finally`). Simple, keeps ordering, no extra Redis round trip.
- Starts after T-008 is in `qa` or later. Can be grouped with T-020 in one `doing` slot if the user wants (same file).

## Estimate
Optimistic 0.3 d / probable 0.5 d / pessimistic 0.75 d.

## Implementation log
(filled by the implementer)

## Review
(filled by tech-lead-po)

## QA report
(filled by the QA agent)
