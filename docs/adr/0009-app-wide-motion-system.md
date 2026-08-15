# ADR 0009 — App-wide motion system

> Triggers the ADR bar as a cross-cutting pattern change: a shared motion-token vocabulary (mirroring `--panel-shadow`'s "one value app-wide" convention, spec 0012) applied across every screen, plus two Angular router/template mechanisms (`withViewTransitions`, `animate.enter`/`animate.leave`) never used anywhere in this codebase before. Prompted by the user flagging, after testing spec 0020's live token streaming, that the streaming work highlighted how abrupt the rest of the UI feels by comparison — logged in `TODO.md`, explicitly noted there as needing its own design pass before a spec, not a one-off CSS tweak per component.

## Current state, verified by reading the code directly (not assumed)

Zero CSS transitions exist outside two components: `consultation-chat.css` (spec 0024's spinner/flip/width transition) and `debate-thread.css` (spec 0015's node-position/color transitions, both gated behind their own local `@media (prefers-reduced-motion: reduce)` blocks). Every interactive element app-wide — `.topbar-nav a/button` hover (`app.css`), every `button`/`button:disabled` state (`login.css`/`register.css`) — changes color/border/background instantly, no `transition` property at all. No `@angular/animations` package is installed. `app.routes.ts` has 4 routes (`login`, `register`, `debates/:id`, `consultation`, plus a bare `''`) with no route-transition mechanism and no scroll-position-restoration config. The global `prefers-reduced-motion` rule in `styles.css:112-116` only zeroes `animation-duration`, not `transition-duration` — a real gap: any transition added by this ADR would ignore reduced-motion unless either extended globally or given its own per-component media query (the pattern spec 0024 had to use locally, since this global gap existed before it).

Discussed scope directly with the user rather than assuming: **interactive hover/focus/active states, route transitions, and component mount/unmount transitions are in scope. Scroll-behavior polish is explicitly excluded** — verified by grep that the only two scroll interactions anywhere in the app (`debate-thread.ts`/`consultation-chat.ts`'s auto-follow-to-bottom effects) reassign `el.scrollTop = el.scrollHeight` on every render tick while tokens are actively streaming; layering `scroll-behavior: smooth` on top would restart the glide on every tick (jank, not a smoother feel), and nothing else in the app has a scroll interaction to apply this to at all.

## Decision 1 — Shared motion tokens in `styles.css`, not per-component magic numbers

```css
--transition-fast: 150ms ease;   /* color/border/background hover-style changes */
--transition-base: 220ms ease;   /* larger state changes: opacity, width, transform */
```
Same reasoning as `--panel-shadow` (spec 0012): one shared value so every screen reads as one consistent motion language, not independently-guessed durations per component. Applied to existing interactive selectors app-wide (`.topbar-nav a`/`button`, every `button` in `login.css`/`register.css`, the case-type `<select>`) via `transition: color var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast);` (only the properties that actually change on hover/focus/active in each case — no blanket `transition: all`).

## Decision 2 — Route transitions via `withViewTransitions()`, no new dependency

Verified against current Angular docs (context7, not memory): Angular's router ships `withViewTransitions()` natively (`provideRouter(routes, withViewTransitions())`), wrapping the browser's native View Transitions API. It's progressive enhancement by design — the Angular docs confirm that on a browser without View Transitions API support, the router just performs a standard DOM update with no animation and no errors, so no fallback code is needed. A simple cross-fade via the default root transition (`::view-transition-old(root)`/`::view-transition-new(root)` in `styles.css`) covers all 4 routes without per-route configuration.

## Decision 3 — Mount/unmount transitions via native `animate.enter`/`animate.leave`, no new dependency

Verified against current Angular docs: `@angular/animations` is explicitly deprecated as of Angular v20.2, with `animate.enter`/`animate.leave` template bindings as its replacement — plain CSS (`@starting-style` for enter, a transition-triggering class for leave), no package, no dependency question to ask about. Unlike a bare CSS `animation` on mount (the trick spec 0024 used, which only works for *entry* since Angular removes `@if`-gated DOM nodes immediately), `animate.leave` is the first mechanism in this codebase that can play an exit transition before removal at all. Scope: `@if`-gated messages/banners outside the two screens already covered by specs 0015/0019/0021/0024 — login/register error and validation messages, consultation-chat's case-type-picker loading state.

## Decision 4 — Fix the `prefers-reduced-motion` gap globally, not per-component

Extend `styles.css`'s existing reduced-motion rule to also zero `transition-duration` (currently only `animation-duration`), and explicitly add `::view-transition-group(*)`, `::view-transition-old(*)`, `::view-transition-new(*)` to it — verified these pseudo-elements aren't reached by the plain `*` universal selector already in that rule, since they aren't real DOM elements. One fix, so every transition this ADR's specs add (and any future one) is automatically covered — not a per-component `@media` block added each time, the pattern spec 0024 was forced into before this gap existed.

## What this doesn't cover

Scroll-behavior polish (Decision above, explicitly excluded — nothing to apply it to today). Any change to the two screens' existing, purpose-built animations (spec 0015's node transitions, spec 0019's turn indicators, spec 0021's streaming swap, spec 0024's thinking indicator) — those already work and aren't being redone. `@angular/animations` itself — not installed, not needed, explicitly avoided given it's the deprecated path.

## Sequencing

Unlike ADR 0007's three independent, sequentially-risky call sites, these are small, additive, low-risk changes to already-static screens (a token rollout, a router feature flag, a handful of `animate.enter`/`leave` bindings) with one shared verification concern (visual feel + reduced-motion compliance) — one spec covers the whole pass, not a big-bang split.
