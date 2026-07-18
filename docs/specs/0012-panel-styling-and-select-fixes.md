# Spec 0012 — App-wide panel styling, navbar floating, typing-bubble width, custom select

> No new ADR — pure UI polish, no architecture change. Follow-up to spec 0011, recalled by the user after using its changes in the running app.

## What's being built

Four fixes, verified against the actual current code:

1. **Every card-like container gets the floating-panel treatment, not just consultation's.** Confirmed: `login.css`/`register.css`'s `.card` and `debate-thread.css`'s `.header-card`/`.graph-panel`/`.reading-panel` all share the exact same `background: var(--ground); border-radius: 14px;` pattern spec 0011 gave a border+shadow to on `.chat-card`/`.picker-card`, but none of the others got it — this is exactly the situation where a shared design token (not a new utility class needing template changes) is the right fix, matching how `--page`/`--ground`/etc. already work: a `--panel-shadow` custom property in `styles.css`, referenced by every card-like class's `box-shadow` (each still declares its own `border: 1px solid var(--line)` line, one extra line per class, not a refactor of the class structure).
2. **Navbar still reads as attached to the page, not floating.** Confirmed: `.topbar` currently uses `border-bottom: 1px solid var(--line)` — a flat line, not the shadow treatment the cards now have, which is exactly why it still reads as "integrated" per the report. Fix: drop the border-bottom, add `box-shadow: var(--panel-shadow)` instead — same token as every panel, so the navbar and the cards floating beneath it read as one consistent visual language.
3. **The "Thinking…" bubble stretches to the same width as a real message.** Confirmed: `.message-content` is a block-level `<p>` that fills its parent's available width (up to `.message`'s 85% max-width) — fine for real text, wrong for a 3-dot indicator that should hug its own content. Fix: `.message-content--pending` gets `width: fit-content` so it sizes to its dots + padding, not the message column's full width.
4. **The case-type `<select>` uses raw browser-default styling.** Confirmed: `consultation-chat.css`'s `select` rule only sets background/border/padding/color — the dropdown arrow and native chrome are whatever the OS/browser renders, which doesn't match anything else in the app. Fix: `appearance: none` + a custom SVG chevron via `background-image`, sized/positioned to match the existing input padding, same border/focus-outline treatment already used for `input`.

## Files touched

- `frontend/src/styles.css` — new `--panel-shadow` token (theme-independent, base `:root` — matches how `--font-*` tokens already aren't per-theme).
- `frontend/src/app/features/auth/login/login.css`, `.../register/register.css` — `.card` gets `border` + `box-shadow: var(--panel-shadow)`.
- `frontend/src/app/features/debate/debate-thread/debate-thread.css` — `.header-card`, `.graph-panel`, `.reading-panel.open` get the same.
- `frontend/src/app/features/consultation/consultation-chat/consultation-chat.css` — swap the spec-0011 hardcoded shadow values for `var(--panel-shadow)` (single source of truth now that it's shared); `.message-content--pending` width fix; custom `select` styling.
- `frontend/src/app/app.css` — `.topbar` border-bottom → box-shadow.

## Explicitly out of scope

Any other browser-default form control beyond this one `<select>` (no others exist in the app yet). Redesigning the navbar's layout/content beyond the shadow swap.

## Verification plan

Real browser (Canary), both light and dark theme: confirm login/register cards, and debate-thread's header/graph/reading panels, all now show a visible border+shadow matching the consultation cards (a consistent look across every screen, not just one). Confirm the navbar now has a shadow beneath it rather than a flat line, reading as elevated above the content below. Confirm the "Thinking…" bubble is now a small, tight pill around the 3 dots, not a full-width bar. Confirm the case-type dropdown has custom (non-browser-default) styling — a visible custom arrow, matching border/background/focus outline to the rest of the form controls.

## Verified in a real browser (Canary)

Computed-style inspection (not just a visual glance) on every affected surface: login (`.card`, post-logout) and register cards both show `border: 1px solid #DDE1EA` + a non-`none` `box-shadow`; two real debate pages' `.header-card`/`.graph-panel` show the same; the navbar shows `background-color: #F5F6F9` (`--ground`, distinct from `--page` behind it) with a non-`none` shadow and `border-bottom: 0px none` (the old flat line genuinely gone, not just papered over); the pending "Thinking…" bubble measured 50px wide against a 414px message container (a small pill, not full-width — the exact number checks out: 3×6px dots + 2×4px gaps + 24px padding = 50px, matching the CSS exactly); the `<select>` confirmed `appearance: none` with a real custom `background-image` data URI, not browser defaults. Zero console errors across the whole check.

## Branch

Continuing on `main`.

## Status

Implemented and verified in a real browser. No bugs found — pure CSS polish, no new architecture. Angular's existing test suite (15 tests across 10 files) still passes unmodified.
