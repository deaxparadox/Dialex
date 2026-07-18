# Spec 0007 — Query-param-driven view state on debate-thread

> Small, contained refactor of the already-shipped `DebateThread` component (spec 0001/ADR 0001) — no new ADR needed.

## What's being built

`mode` (Minimal/Detail) and the selected argument node become part of the URL as query params, so a specific view of a debate is shareable/bookmarkable/deep-linkable, and back/forward navigate through view changes.

**Scope decision (engineering judgment, confirmed with the user):** `theme` (Light/Dark) stays local component state, not a query param — it's a personal display preference, not "which view of this debate," and putting it in the URL would mean a shared link forces the sharer's theme on whoever opens it.

## Behavior

- **On init:** read `mode`/`selected` from `ActivatedRoute`'s query params.
  - `mode`: valid values `minimal`/`detail`; anything else (missing, malformed) falls back to today's default (`detail`).
  - `selected`: must match an existing argument's `id`; if missing or no match, falls back to today's existing default logic (the currently-streaming argument, else the first mock argument).
- **On change:** `setMode()` and `select()` both update the URL via `router.navigate([], { queryParams: {...}, queryParamsHandling: 'merge', replaceUrl: true })`.
  - `replaceUrl: true` is deliberate — every click on a node or a mode toggle should **not** push a new browser-history entry (otherwise the back button would tediously step through every argument the user ever clicked instead of leaving the page). Direct URL edits/navigations (someone pasting a link) still work normally since that's a real navigation, not a `replaceUrl` call.
- Reading and writing both go through the same two query param names (`mode`, `selected`) — no separate internal state duplication beyond the existing `mode`/`selectedId` signals, which stay as the source of truth for the template; the URL is kept in sync with them, not the other way around.

## Explicitly out of scope

`theme` as a query param (see scope decision above). Persisting `theme` via `localStorage` — a real, separate possible improvement, not part of this spec.

## Verification plan

- Load `/` with no query params — confirm today's existing defaults (detail mode, streaming/first argument selected) still apply, and the URL updates to reflect them (e.g. lands on `/?mode=detail&selected=c3`).
- Load `/?mode=minimal&selected=g2` directly — confirm the page opens already in Minimal mode with the `g2` argument's text shown in the reading panel, not the default.
- Load `/?mode=bogus&selected=does-not-exist` — confirm it falls back to defaults rather than crashing or rendering a blank reading panel.
- Click a different node, confirm the URL's `selected` param updates and the browser's back button does **not** step back through it (`replaceUrl` working).
- Toggle Minimal/Detail, confirm the URL's `mode` param updates the same way.
- Confirm `theme` is untouched by any of the above — toggling it never touches the URL.

## Found during real-browser verification (Canary), fixed before landing

6 of 7 checks passed clean on the first real-browser run (defaults reflected into the URL on load, node-click/mode-toggle updating the right param, theme correctly excluded, a fresh navigation to a URL with query params loading directly into that state, invalid params falling back to sane defaults, no console errors from any of this feature's own logic).

One real finding on the 7th check (back-button/history behavior) — **a pre-existing gap from spec 0006, not something this spec's own logic caused**, but one this work made visible for the first time: `register.ts` (and, on inspection, `login.ts` too) navigated to `/` after auto-login without `replaceUrl`, leaving `/register`/`/login` as real history entries underneath. Pressing back re-entered `/register`, `guestGuard` correctly bounced the now-authenticated user back off it, but the already-mounted `DebateThread` route component doesn't re-run its constructor on that same-component redirect — so the address bar went bare while the page silently kept showing whatever state was previously interacted with (a URL/DOM mismatch). Before this spec, that would've been invisible (a bare `/` looked identical to any other fresh load, since there was no reflected query-param state to be stale about) — spec 0007 is what surfaced it.

Fixed by adding `replaceUrl: true` to both `login.ts`'s and `register.ts`'s post-auth navigation — logging in/registering is a continuation of that action, not a page the user meant to keep in back-history. Re-verified: back-button after login/register no longer re-enters the stale state.

## Branch

Continuing on `main`.

## Status

Implemented and verified against a real browser (Canary), including a fix to a pre-existing spec-0006-era navigation gap this work exposed.
