# ADR 0001 — Frontend architecture & design principles

> Written before scaffolding any frontend code, per this repo's CLAUDE.md: this is a genuine cross-cutting architecture decision (framework conventions, state management, folder structure) that every future frontend spec — including [0001-frontend-scaffold-debate-thread](../specs/0001-frontend-scaffold-debate-thread.md) — must follow, not re-decide.

## Framework

**Angular** — the user's own choice from the start of this project (`docs/PRD.md` §8), not re-litigated here. **Current stable: Angular 22** (verified against `angular.dev/reference/releases`, July 2026) — scaffold against this, not an older remembered version.

## Component model — standalone only, no NgModules

Standalone components have been the official recommendation since Angular v15 and the CLI/docs default since v19 — `ng generate` scaffolds `standalone: true` without extra flags. NgModules still work (`standalone: false`) but exist for legacy migration, not new projects. **Every component in this app is standalone; no `NgModule` gets written.**

## Templates — new control-flow syntax only

`@if` / `@for` / `@switch` (introduced v17) are the default for all new template code, not `*ngIf` / `*ngFor` / `[ngSwitch]`. `@for` requires an explicit `track` expression — for this app's lists (arguments, cases, notifications), track by the entity's `id`, never by index, since streamed/reordered data (decision 12) would silently misrender with index-tracking.

## Change detection — zoneless

`provideZonelessChangeDetection()` is stable (graduated in Angular 20.2) and the default for new projects from v21 on. **Confirm it explicitly when scaffolding** (don't assume the default silently applies) — this matters more than usual for this app specifically, since decision 12's live token/event streaming relies on the UI actually reflecting state changes as they arrive; don't let a stray `provideZoneChangeDetection` call or an old tutorial's zone.js setup override it.

## State management — scoped by where the state actually lives, not one default everywhere

No single library for everything; match the tool to the scope:
- **Local, component-only UI state** (which theme is active, which thread node is selected in the reading pane, whether a form is expanded) → plain **Signals**, nothing more.
- **Feature-level state** (the live debate view's current arguments, round, and convergence stats as they stream in; the notification inbox's read/unread list) → **NgRx SignalStore** — signals-based, no actions/reducers/effects boilerplate; current guidance calls this the "sweet spot" for exactly this kind of moderately-complex, streaming feature state.
- **Classic NgRx** (actions/reducers/effects/DevTools) is *not* the default — only reach for it if a genuine need for an enforced unidirectional audit trail shows up later. Don't default to it out of habit; that's over-engineering for this app's actual scope.

## HTTP — functional interceptors

`provideHttpClient(withInterceptors([...]))`, not the older class-based `HttpInterceptor` DI pattern (which Angular has signaled may be phased out). **This is where decision 13's JWT handling lives**: an interceptor attaches the in-memory access token to outgoing requests, and a separate interceptor (or the same one) handles the 401-triggered refresh flow against the refresh cookie.

## Real-time architecture — a dedicated core service, not raw sockets in components

Decisions 12/17 (Redis-backed per-debate streaming, general notifications) get one `core/` service wrapping WebSocket connections, exposing **Signals** (or a SignalStore) for components to read — components never touch a raw `WebSocket` object directly. For [spec 0001](../specs/0001-frontend-scaffold-debate-thread.md), this service doesn't exist yet; mock data stands in its place, structured so swapping in the real service later doesn't require restructuring the component.

## Testing — Vitest, not Karma/Jasmine

Vitest is now the Angular CLI's default test runner for new projects — Karma/Jasmine is legacy-only at this point. Scaffold with whatever `ng new` produces by default; don't hand-configure Karma from an old tutorial.

## Folder structure — feature-based

```
src/app/
  core/       — app-wide singletons: auth service + interceptors, the real-time/WebSocket service,
                anything that must exist once, at boot, regardless of feature
  features/   — one folder per domain: debate/, consultation/, human-review/, dashboard/, notifications/
                each owns its own components, routes, and (where needed) SignalStore
  shared/     — reusable presentational components, pipes, and the global design tokens —
                no feature-specific logic lives here
```
Folder name = domain, file name = responsibility. `debate-thread` (spec 0001) lives under `features/debate/`.

## Design tokens / theming — global CSS custom properties

Continues what was already validated in the two design previews built with the user: color/type tokens as CSS custom properties on `:root`, redefined under `@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"/"light"]` for the toggle. One thing worth knowing, not a change in approach: Angular's view encapsulation scopes component *selectors*, not custom-property *names* — variables still cascade across component boundaries. That's exactly the desired behavior here (every feature shares one token system), not a gap to work around.

## What this doesn't cover

Deployment/build tooling beyond `ng new`'s defaults, i18n, and accessibility auditing beyond what's already built into the validated component designs — out of scope for this ADR, revisit if they become relevant.
