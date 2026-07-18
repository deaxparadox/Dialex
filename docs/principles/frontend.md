# Frontend principles

> Generic, industry-standard practices this project's frontend code is held to — distinct from `docs/adr/` (this project's *specific* decisions) and `references/` (the reasoning trail behind them). This document states the standard straight, without watering it down to match where the code currently is.
>
> **Relationship to known gaps:** where the code doesn't yet meet a principle below *because of core-first sequencing*, that gap is tracked in `docs/PRD.md` §9 — check there before treating a gap as a new audit finding. An undocumented gap is a real finding; a gap already listed in §9 is known backlog, not news.
>
> **Relationship to `CLAUDE.md`:** that file governs how work gets done on this repo (workflow, logging, no unapproved dependencies). This file governs what the code itself should conform to. Different scope, not a restatement.

## Accessibility — WCAG 2.1 AA

- Semantic HTML first; ARIA only where semantic HTML genuinely can't express the interaction (a `<button>` needs no `role="button"`).
- Full keyboard operability — every interactive element reachable and operable via keyboard, with a visible focus state (`:focus-visible`, never `outline: none` without a real replacement).
- Color contrast meets AA minimums (4.5:1 normal text, 3:1 large text/UI components).
- Respect `prefers-reduced-motion` — decorative animation must have a reduced/no-motion path, not just a shorter duration.
- Meaningful `alt`/`aria-label` text describes what an element *does* or *shows*, not its implementation.

## Framework conventions — official Angular style guide

- Standalone components, the current control-flow syntax (`@if`/`@for`/`@switch`), and signals for reactive state — per `docs/adr/0001-frontend-architecture.md`, not habit from older Angular versions.
- One clear responsibility per component/service; a component that's both fetching data and rendering a complex view is a signal to split it.
- Naming and file organization follow the official Angular style guide (kebab-case files, one exported concept per file).

## Security

- Never bypass Angular's built-in HTML sanitization (`bypassSecurityTrustHtml` and friends) without a specific, documented reason — it exists to prevent XSS.
- No secrets, API keys, or signing material in frontend source — anything sensitive stays server-side, full stop.
- Auth tokens handled per `docs/adr/0001-frontend-architecture.md`'s HTTP interceptor pattern, never read from `localStorage`.

## Performance

- Core Web Vitals as the target, not a vague "feels fast": LCP < 2.5s, INP < 200ms, CLS < 0.1.
- Route-level code-splitting for anything not needed on first paint; don't ship the whole app's JS for one screen.
- Set real bundle budgets in `angular.json` and pay attention when they're exceeded, don't just raise the limit.

## Responsive design

- Mobile-first layout; test at real breakpoints, not just by shrinking a desktop browser window.
- Touch targets sized appropriately (44×44px minimum) wherever the app might be used on a touchscreen.

## Testing

- Tests verify user-facing behavior ("clicking this node shows its argument"), not implementation details ("this private signal equals X").
- A generated `should create` test is a starting point, not a finished test suite — every component with real logic needs tests for that logic.

## Code quality

- TypeScript strict mode on; `any` requires a comment explaining why nothing more specific would work.
- Formatting via the project's configured Prettier, not ad hoc style — consistency over individual preference.
