# Spec 0026 — App-wide motion pass

Implements ADR 0009. Scope agreed directly with the user: interactive hover/focus/active states, route transitions, and mount/unmount transitions for existing `@if`-gated messages. Scroll-behavior polish explicitly excluded (ADR 0009 — nothing in the app has a scroll interaction that wouldn't conflict with the two existing streaming auto-follow effects).

## 1. Shared motion tokens (`frontend/src/styles.css`)

```css
:root {
  --transition-fast: 150ms ease;
  --transition-base: 220ms ease;
}
```

## 2. Fix the `prefers-reduced-motion` gap (`frontend/src/styles.css`)

Current rule only zeroes `animation-duration`. Extend to `transition-duration`, and explicitly add the view-transition pseudo-elements (not reached by `*`):

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation-duration: 0.001ms !important;
  }
}
```

## 3. Route transitions (`frontend/src/app/app.config.ts`, `frontend/src/styles.css`)

```ts
import { provideRouter, withViewTransitions } from '@angular/router';
// ...
provideRouter(routes, withViewTransitions()),
```
No new dependency (verified against current Angular docs — native router feature, progressive enhancement: browsers without View Transitions API support get a plain DOM swap, no errors, no fallback code needed). The browser's default cross-fade applies automatically; only override the duration to match this app's shared token instead of the browser default:
```css
::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: var(--transition-base);
}
```

## 4. Interactive state transitions — add `transition` to properties that already change, no new hover states invented

| File | Selector | Property already changing (instantly today) |
|---|---|---|
| `app.css` | `.topbar-nav a`, `.topbar-nav button` (`:hover`) | `color`, `border-color` |
| `login.css` | `button` (`:disabled`) | `opacity` |
| `register.css` | `button` (`:disabled`) | `opacity` |
| `consultation-chat.css` | `button` (`:disabled`) | `opacity` |
| `debate-thread.css` | `.toggle button`, `.mode-toggle button` (`.active` class swap) | `color`, `background` |
| `debate-thread.css` | `.start-button` (`:disabled`) | `opacity` |

Each gets `transition: <property> var(--transition-fast)[, <property2> var(--transition-fast)]` added to the base (non-hover/non-disabled) rule — only the properties named above, not a blanket `transition: all`.

**Explicitly not touched**: `input:focus`'s outline appearance (login/register/consultation-chat) and the global `:focus-visible` rule in `styles.css` — an outline snapping in/out is a discrete accessibility focus indicator, intentionally instant today, and transitioning `outline` is visually awkward (a width jump, not a clean interpolation). Not a gap, a deliberate exclusion.

## 5. Mount/unmount transitions via native `animate.enter`/`animate.leave` — no new dependency

Verified against current Angular docs: `@angular/animations` is deprecated as of v20.2; these are the documented replacement, plain CSS underneath.

Applied to every existing `@if`-gated `.error`/`.state-message` block outside the two screens spec 0015/0019/0021/0024 already animate:
- `login.html:16` (`.error`)
- `register.html:26`, `:30` (`.error`)
- `consultation-chat.html:31`, `:62`, `:77` (`.error` ×2, `.state-message` ×1)

Template change (same shape at each site):
```html
@if (error()) {
  <p class="error" animate.enter="fade-in" animate.leave="fade-out">{{ error() }}</p>
}
```

CSS added to each of the three components' own stylesheets (`login.css`/`register.css`/`consultation-chat.css`, matching this codebase's existing per-component convention rather than inventing a new shared-CSS-file abstraction):
```css
.fade-in {
  animation: fade-slide-in var(--transition-base);
}
.fade-out {
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity var(--transition-base), transform var(--transition-base);
}
@keyframes fade-slide-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
```

## What this doesn't cover

Scroll-behavior polish (excluded per ADR 0009 — logged in `TODO.md` as not applicable today). Any change to the two already-animated screens' existing mechanisms (specs 0015/0019/0021/0024). `@angular/animations` — not installed, not needed.

## Verification plan

- `npx ng test` — full suite, confirm no regressions from the template/CSS changes (none of these touch component logic).
- Real browser, reduced-motion off: confirm each interactive-state transition actually eases (not just present in CSS — use `getComputedStyle`/`getAnimations()` the same way spec 0024 did, not a glance) for at least one instance of each row in the Decision 4 table; confirm a route navigation (e.g. consultation → a debate) shows a visible cross-fade; confirm at least 2 of the `animate.enter`/`animate.leave` sites show a real enter and a real leave (trigger an error, then clear it).
- Real browser, `prefers-reduced-motion: reduce` (via devtools emulation): confirm every transition/animation added by this spec collapses to near-instant, including the route cross-fade — re-verify the two already-animated screens (spec 0015/0024) aren't accidentally double-covered or broken by the extended global rule.
- Confirm no visual regression to the two already-animated screens' own behavior (debate-thread's node transitions, consultation-chat's thinking indicator) — this spec's `styles.css` changes are additive, not a replacement of their local `@media (prefers-reduced-motion: reduce)` blocks.

## Branch

Continuing on `main`.

## Found during verification

No bugs found. One correction to this spec's own verification plan, caught during the real-browser pass: "debate-thread's node transitions" (spec 0015) don't exist anymore — that whole scatter-plot mechanism was deleted in spec 0016's chat restyle, well before this spec was written. The actual pre-existing animations to protect in debate-thread are the `.typing-indicator` bounce and the `.live-dot::before` pulse (both still present, both confirmed unaffected below) — the verification plan's wording was stale, not the app.

- `npx ng test`: 26/26 pass, zero regressions.
- Real browser (Chrome 145), reduced-motion off: navbar link hover confirmed `transitionDuration: "0.15s, 0.15s"` on `color, border-color` with a running animation mid-hover; disabled login button confirmed `transition: opacity 0.15s` easing between `0.5`↔`1`; debate-thread's Light/Dark and Minimal/Detail toggle buttons and the "Start debate" button confirmed running transitions via `getAnimations()` right after interaction. Login's wrong-password error and register's "Passwords don't match" message both confirmed a full leave→enter cycle via `getAnimations()` (opacity stepping through real intermediate values, e.g. 1→0.81→0.48→0.25→0.07→0, not a single-frame jump). A real route navigation (`/` → `/consultation`) produced genuine `::view-transition-group/old/new(root)` pseudo-animations via `document.getAnimations()` — real native View Transitions firing, not just CSS present with no effect.
- Real browser, `prefers-reduced-motion: reduce` emulation: navbar hover's `transitionDuration` and the login error's `animationDuration` both collapsed to `"1e-06s"` — confirming the deliberate `0.001ms` (not a literal `0`, which can suppress `transitionend`/`animationend` events) is doing its job.
- Pre-existing animations confirmed unaffected across real consultation/debate runs: consultation-chat's thinking spinner (`0.9s spin`, running through two consultation turns), debate-thread's `.typing-indicator` (`typing-bounce`, `1.1s`, running during live argument generation), and `.live-dot::before` (`1.5s` pulse while active, correctly gone once judged).
- Zero console errors throughout.

## Status

Implemented and verified against the real running stack. Closes the app-wide motion TODO item (scroll-behavior polish explicitly excluded, logged separately). One out-of-scope finding surfaced during verification (a consultation session's `ready_to_finalize` never triggering across two full test conversations) logged separately in `TODO.md`, not investigated here.
