---
id: T-025
title: weQuiz rebrand, full responsive UI, installable PWA
status: review
owner: fullstack-devops
author_of_code: claude-main-session
priority: P1
size: L
---

## Context
Owner request: rename the product to "weQuiz", align the visual identity with the We.info logo
(`src/logo-weinfo.png`), make every screen usable on phones (answers were unreadable in the game
screen), and make the app installable on iOS and Android.

## Acceptance criteria
- [ ] No user-facing "fastquizz" left (UI, titles, Swagger title, README heading).
- [ ] Palette derived from the logo: primary `#2c83c0`, ink `#0b141f` (navy-tinted gray scale).
- [ ] Header/footer logos use the official We.info image (compact without tagline at small sizes,
      white-ink variant on dark screens); square app mark (magnifier + "?") for icons.
- [ ] Player game: answers stack full-width on phones with left shape badge and wrapping text;
      2 columns from `sm`. No horizontal scroll at 320px on any page.
- [ ] Manifest, icons (any + maskable + apple-touch), service worker; install banner:
      native prompt on Chromium/Android, menu instructions on other Android browsers,
      Share → Add to Home Screen steps on iOS/iPadOS. "Installer l'app" button on home and join.
- [ ] Safe areas handled (notch / home indicator) in standalone mode.
- [ ] Player lobby lists every participant: those who joined before (player:joined snapshot) and
      those who join after (lobby:player_joined broadcast), in arrival order, own nickname highlighted.

## Out of scope
- Renaming technical identifiers (folders, npm packages, DB name, seed demo email): would break
  Render root directories and existing data.
- iOS splash screens (`apple-touch-startup-image`), offline gameplay.

## Implementation log
- Tokens: `tailwind.config.js` (primary, gray, answer colors, fonts Poppins/Inter), `app.css`
  (`answer-tile`, `btn-icon`, 44px touch targets, safe-area utilities).
- Brand: `$lib/brand.ts`, `BrandLogo.svelte`, logo variants in `$lib/assets`, icons in `static/`.
- PWA: `static/manifest.webmanifest`, `src/service-worker.ts` (cross-origin API/WS never cached),
  `$lib/pwa.ts`, `InstallPrompt.svelte`, `InstallButton.svelte`, early `beforeinstallprompt`
  capture in `app.html`.
- All routes reworked for mobile; fixes on the way: login/register double submit on Enter,
  quiz-builder "Annuler" navigating away even when the confirmation was declined, unlabeled inputs,
  `alert()` on copy replaced by inline feedback, user zoom no longer blocked on the game page.
- Player lobby list: `players` added to the player store (snapshot + `lobby:player_joined`,
  deduplicated via `withJoinedPlayer`, shared with the host store). No backend change needed.
- Android install: early `beforeinstallprompt` capture + browser-menu fallback for every Android
  browser without the native event; "Installer l'app" button re-opens help after a dismissal.
- Checks: `svelte-check` 2 pre-existing errors (T-019), 0 warnings (was 9); `npm run build` OK.
- Not done: real-device testing on iOS/Android, browser-level visual pass (interrupted).

## Review
(filled by tech-lead-po)

## QA report
(filled by the QA agent)
