# Spec 0011 — Consultation chat polish + app branding

> No new ADR — pure UI polish on already-built screens (spec 0010's consultation chat, the app shell topbar), no new architecture. User-reported, with screenshots, after using the running app.

## What's being built

Four small, independent fixes, verified against the actual current code (not assumed):

1. **Chat doesn't auto-scroll.** Confirmed in `consultation-chat.html`/`.ts`: `.messages` has `overflow-y: auto` but nothing ever sets `scrollTop` — new messages append below the visible area and the user has to scroll manually. Fix: track the messages container via `viewChild`, and use `afterRenderEffect` (Angular's current API for "run DOM work after a render triggered by signal changes," verified against Angular's own docs rather than assumed) to set `scrollTop = scrollHeight` whenever `messages()` or `sending()` changes — covers new messages from either side and the "Thinking…" row appearing/disappearing.
2. **"Thinking…" is static italic text.** Replace with a small animated three-dot typing indicator (pure CSS `@keyframes`, no new dependency) inside the same pending-message row.
3. **Topbar → real navbar with a Dialex logo.** Currently `app.html`'s `.topbar` only has right-aligned nav items, no branding at all (confirmed — no logo/wordmark anywhere, `index.html`'s `<title>` is still the generic scaffolded "Frontend", the favicon is Angular's default `public/favicon.ico`). Fix: a small abstract SVG mark (two overlapping circles in `--divergence`/`--convergence` — the app's own divergence→convergence visual language, already used throughout the debate-thread graph) as `public/dialex-logo.svg`, placed left-aligned in the topbar next to a "Dialex" wordmark; same file wired as the favicon (`<link rel="icon" type="image/svg+xml">`, replacing the unbranded default); `<title>` updated to "Dialex".
4. **Chat/picker cards should look like floating panels.** Confirmed: `.chat-card`/`.picker-card` currently have only `background`/`border-radius`, no border or shadow, so they blend into `--page`. Fix: add `border: 1px solid var(--line)` and a soft `box-shadow` using `--page`-derived tones (works in both light/dark themes, no new tokens needed).

## Files touched

- `frontend/public/dialex-logo.svg` (new) — the mark, static hardcoded colors (a favicon file can't read the app's CSS custom properties).
- `frontend/src/index.html` — `<title>Dialex</title>`, favicon link swapped to the SVG.
- `frontend/src/app/app.html`/`.css` — topbar restructured `justify-content: space-between` (logo+wordmark left, nav right, was right-only).
- `frontend/src/app/features/consultation/consultation-chat/consultation-chat.ts` — `viewChild` for the messages container, `afterRenderEffect` import and call.
- `frontend/src/app/features/consultation/consultation-chat/consultation-chat.html`/`.css` — template ref on the messages div, typing-indicator markup/animation, border+shadow on the two card classes.

## Explicitly out of scope

Applying the same border/shadow treatment to login/register's `.card` (not asked for — flagging as a natural follow-up if wanted, not doing it silently). Theme-reactive favicon (favicons are conventionally static branding, not toggled with the app's light/dark switch).

## Verification plan

Real browser (Canary): confirm the chat auto-scrolls to the latest message after sending and after a reply arrives (test with enough messages to overflow the visible area); confirm the typing indicator animates while waiting; confirm the navbar shows the logo+"Dialex" on the left and nav items on the right, and the browser tab shows the new icon and "Dialex" title; confirm the chat/picker cards visually read as bordered/shadowed panels against the page background, in both light and dark theme.

## Verified in a real browser (Canary)

All four items confirmed working via DOM/computed-style inspection and screenshots, not just visual glance: auto-scroll measured at exactly 0px from the bottom after every message across a real 5-round OpenAI exchange (10 messages total, list genuinely overflowing its fixed height); the typing indicator confirmed via `document.getAnimations()` as 3 real running Web Animations (1100ms duration, staggered 0/150/300ms delays), not static text; tab title exactly "Dialex" and favicon serving the new SVG; navbar showing the logo+wordmark on the left via DOM inspection; both cards' computed styles showing the new `border`/`box-shadow` values. Zero console errors, zero failed requests across the whole check.

## Branch

Continuing on `main`.

## Status

Implemented and verified in a real browser. No bugs found — pure polish on already-verified screens (spec 0010), not new architecture. Angular's existing test suite (15 tests across 10 files) still passes unmodified.
