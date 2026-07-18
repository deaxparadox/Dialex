# Spec 0001 — Scaffold Angular frontend, build the live-debate thread screen (mock data)

> Governed by [ADR 0001 — Frontend architecture & design principles](../adr/0001-frontend-architecture.md), written after this spec but decided before any implementation started — this spec's approach below conforms to it, not the reverse.

## What's being built

The real Angular frontend project (not scaffolded yet — this repo currently has no application code, only planning docs), plus one real, interactive component: the live-debate "thread" view — arguments plotted on a divergence-to-convergence axis by round, with a click-to-read reading pane showing full argument text, including a word-by-word streaming reveal for the "currently generating" argument. Driven entirely by static mock data for now; no Django/FastAPI/Temporal/Redis involved at this stage (confirmed scope with the user — frontend-only, fake data, so interaction feel can be judged in a running app before committing further).

## Why

Two static HTML previews of this screen were built and iterated on with the user (see `references/002-design-review-findings.md` for the full design-system reasoning, and the design conversation that produced the branching-thread concept over card-based dashboard defaults). The user wants to actually click through this as a real, running app — not just react to a static artifact — before the rest of the screens or any backend work happens.

## Design source (already validated, not being re-decided here)

- Color/type tokens: divergence (`#D9713E`/`#E8834F` dark), convergence (`#1E9E82`/`#2FBF9F` dark), judge accent (`#6E63B6`/`#9A8FE0` dark), light/dark theme via CSS custom properties.
- Layout: arguments as nodes on an SVG divergence↔convergence axis by round, connected by dashed lines representing `Argument.responds_to`; a reading pane below shows the full text of whichever argument is selected, with a word-by-word reveal for the one currently "generating."
- Reference implementation to port from: the validated preview file (built during this session, contains the full CSS token system, SVG layout, and reveal logic to translate into Angular component code — not to be re-designed from scratch).

## Proposed approach

- Scaffold via Angular CLI (`ng new`) — per this repo's own CLAUDE.md rule, generator output, not hand-authored project files. Confirm zoneless change detection is on (ADR 0001) rather than assuming the default silently applies.
- Generate the component via `ng generate component` (standalone by default per ADR 0001 — no NgModule), placed at `src/app/features/debate/debate-thread/`.
- Template written with `@if`/`@for` (never `*ngIf`/`*ngFor`); the argument list tracks by `id`, not index, since this same list will later reorder/append live (decision 12).
- Component-local UI state (selected node, active theme) as plain Signals, per ADR 0001 — no store needed for this spec's scope, since there's no live-updating feature state yet (that's what decision 12's real service will need later, out of scope here).
- Port the design tokens into a global stylesheet (light/dark via `prefers-color-scheme` + a `data-theme` override, matching the validated preview).
- Mock data as a small static TypeScript file/service standing in for what will later be real data over the per-debate WebSocket (decisions 12/17 in `references/002-design-review-findings.md`) — structured to be easy to swap for the real stream later without restructuring the component.
- No routing/dashboard/other screens yet — this spec is scoped to the one component plus the minimum app shell needed to render it.
- Whatever `ng new` scaffolds for testing (Vitest, per ADR 0001) is kept as-is — no hand-configuring an alternate test runner.

## Branch

Not yet named — branch creation is human-directed per this repo's CLAUDE.md; needs the user to confirm a branch name (or confirm committing directly to `main`) before implementation starts.

## Status

Awaiting explicit approval before any implementation code is written, per this repo's CLAUDE.md.
