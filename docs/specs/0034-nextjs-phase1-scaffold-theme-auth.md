# Spec 0034 — Next.js Phase 1: scaffold + theme + auth

Implements Phase 1 of ADR 0012 / spec 0033 (umbrella). Branch `migration/nextjs-frontend`.

## Root cause / current state, verified directly (not assumed)

- No `frontend-next/` directory exists yet — this spec is the first line of code in the migration.
- Angular's `Auth` service (`frontend/src/app/core/auth/auth.ts`): access token held **in memory only** (a signal, never `localStorage`/cookie — decision 13), refresh token is an `HttpOnly` cookie the frontend never reads directly. `bootstrapCsrf()` hits `GET /api/auth/csrf/` once; `restoreSession()` silently attempts a refresh on load (swallowing failure — "not logged in" is a valid start state, not an error). Both are awaited in `app.config.ts`'s `provideAppInitializer`, which **blocks app render** until they resolve.
- `auth-interceptor.ts`: attaches `X-XSRF-TOKEN` (read from the `XSRF-TOKEN` cookie) to every request to the Django API origin, attaches `Authorization: Bearer <token>` when present, and on a 401 (for any non-auth-endpoint request) calls `auth.refresh()` once and retries — redirecting to `/login` only if the refresh itself fails.
- `auth-guard.ts`: `authGuard` (redirect to `/login` if not authenticated) and `guestGuard` (redirect to `/` if already authenticated) are plain functions reading the same in-memory signal, applied per-route in `app.routes.ts`.
- Verified via context7 against current Next.js docs (v16.2.9): the documented "optimistic auth" proxy/middleware pattern (`docs/01-app/02-guides/authentication.mdx`) redirects based on a **readable session cookie**. That doesn't fit here — this app's access token is deliberately never in a cookie (decision 13 stays true in the port), so no server-side proxy/middleware can determine "is this user logged in" without a client round-trip. Route protection stays a **client-side check**, the direct equivalent of `authGuard`/`guestGuard`, not a Next.js proxy.
- Verified via context7 against current Tailwind CSS docs: v4's CSS-first `@theme` directive defines custom design tokens (colors, fonts) as CSS custom properties that also become utility classes; a custom attribute-based variant is defined with `@custom-variant name (&:where([data-attr=value], [data-attr=value] *));` — confirmed as the documented way to drive dark mode (or any variant) off a `data-*` attribute instead of a class, which is exactly this app's `data-brand`/`data-theme` mechanism (ADR 0011). `create-next-app`'s current default scaffold includes Tailwind v4 with no `tailwind.config.js` (CSS-first).
- `frontend/src/styles.css` (299 lines, read in full): a 6-block cascade (`:root`/citrus default, `:root[data-brand=electric]`, the `prefers-color-scheme: dark` fallback for both brands, explicit `[data-theme=dark]`/`[data-theme=light]`, and the two-attribute electric+dark/electric+light overrides) defining 22 custom properties per combination (`--page`, `--ground`, `--ink`, `--ink-muted`, `--ink-faint`, `--line`, `--divergence`, `--convergence`, `--judge`, `--agent-a`/`-bg`, `--agent-b`/`-bg`, `--status-action`/`-live`/`-done` + their `-bg` variants, plus `--font-display`/`-body`/`-mono`, `--panel-shadow`, `--transition-fast`/`-base`).
- `frontend/src/index.html`'s inline pre-paint `<script>` reads `dialex-theme-brand`/`dialex-theme-mode` from `localStorage` and sets `data-brand`/`data-theme` on `<html>` before any stylesheet loads, to avoid a flash of the wrong palette. `core/theme/theme.ts` is the Signals-based service that owns this state at runtime (defensive `try/catch` around every `localStorage` access).

## Fix

### 1. Scaffold

`npx create-next-app@latest frontend-next` from the repo root, accepting the verified current defaults: App Router, TypeScript, Tailwind CSS, ESLint, `src/` directory (matches `frontend/src/`'s existing convention), Turbopack, no `import alias` change. `frontend/` is untouched and keeps running on its existing dev port; `frontend-next/` gets a different port (Next's default `3000`, vs. Angular's `4200` — no collision).

### 2. Theme tokens, rebuilt in Tailwind's approach (not ported verbatim — the user's explicit choice, ADR 0012 decision 2)

`frontend-next/src/app/globals.css`:
- One `@theme` block mapping every existing custom property to a Tailwind theme color/font token (`--color-page`, `--color-ground`, `--color-ink`, ... `--font-display`, etc.) — same names/values as `styles.css`, so `bg-page`, `text-ink`, `border-line` etc. become real utility classes.
- Two `@custom-variant` declarations: `brand-electric` (`&:where([data-brand="electric"] *)`) and a manual `dark` override keyed to `[data-theme="dark"]`/the `prefers-color-scheme` fallback — mirroring `styles.css`'s existing cascade shape (citrus-default, electric override, dark-fallback, explicit-mode overrides, electric+dark combo) as CSS custom-property re-assignments inside each variant block, not a rewrite of the actual color values.
- The full 22-property matrix (4 combinations) is a direct value-for-value port from `styles.css` — no new colors, no re-design, per ADR 0012's explicit scope.

### 3. Pre-paint bootstrap, ported

A synchronous inline script in `app/layout.tsx`'s `<head>` (same technique `next-themes` and other theme libraries use for Next.js — a raw `<script dangerouslySetInnerHTML>`, not `next/script`, since it must run synchronously before first paint), reading the same two `localStorage` keys and setting the same two attributes on `<html>` — byte-for-byte the same logic as `index.html`'s current bootstrap script, just relocated.

### 4. `Theme`, ported as a small client-side module (not a React Context — no consumer needs to react to brand/mode changes except the toggle UI itself, which isn't built until Phase 2's nav)

`frontend-next/src/lib/theme.ts`: the same `readBrand`/`readMode`/`setBrand`/`setMode`/`applyToDocument`/`effectiveMode` functions, using plain module-level state instead of Angular Signals (no toggle UI consumes this yet in Phase 1 — verification exercises it directly via `localStorage` + reload, same as the bootstrap script's own job).

### 5. Auth, ported as a React Context (the direct equivalent of Angular's root-scoped injectable service)

`frontend-next/src/lib/auth-context.tsx` — a client component `AuthProvider` holding the access token in `useState` (never `localStorage`, decision 13 unchanged) and exposing `login`/`register`/`logout`/`refresh`/`isAuthenticated`, wrapping the root layout. On mount, it awaits `bootstrapCsrf()` then `restoreSession()` before rendering `children` — the direct port of `provideAppInitializer`'s blocking behavior — showing nothing (or a minimal loading state) until that resolves, so no route ever flashes a logged-out UI while a valid refresh cookie is still being checked.

`frontend-next/src/lib/api-fetch.ts` — a thin wrapper around `fetch` (no new HTTP-client dependency; `create-next-app` doesn't bundle one and CLAUDE.md requires asking before adding any) that: attaches `X-XSRF-TOKEN` from the `XSRF-TOKEN` cookie, attaches `Authorization: Bearer <token>` when the caller has one, and on a 401 calls the auth context's `refresh()` once and retries — the direct port of `auth-interceptor.ts`'s logic as a function every API call goes through, since there's no Angular-style HTTP interceptor pipeline in this stack.

### 6. Route protection, client-side (no proxy/middleware — see verified rationale above)

Two route groups: `app/(guest)/` (`login`, `register`) and `app/(protected)/` (everything else). Each group's `layout.tsx` is a client component reading `AuthProvider`'s `isAuthenticated` (only after the provider's initial restore has resolved) and redirecting via `useRouter().replace(...)` — `(guest)` redirects to `/` if already authenticated, `(protected)` redirects to `/login` if not. Direct behavioral equivalent of `guestGuard`/`authGuard`.

### 7. Pages this phase actually needs

`login`, `register` (ported from `frontend/src/app/features/auth/{login,register}` — same fields/validation, Tailwind classes instead of the current component CSS) and one minimal placeholder at `/` (inside `(protected)`) showing the logged-in username and a logout button — just enough to prove the full loop end to end without building Phase 2's real dashboard early. No consultation/debate pages, no realtime, no data fetching from `/api/cases/`, `/api/debates/`, or any orchestrator endpoint — those are later phases.

## Explicitly out of scope

Home dashboard, My-debates list, consultation chat, debate thread, Human Review, notifications — Phases 2-6. Any change to `frontend/` (Angular) or to any backend/orchestrator contract. A reverse proxy or shared origin between the two frontends (ADR 0012 decision 3 — side-by-side ports only). Porting `Theme` to React Context/Signals-equivalent reactivity — deferred until Phase 2 actually needs a toggle UI to react to it.

## Verification plan

Real browser, both apps running side by side (`frontend/` on its existing port, `frontend-next/` on Next's default): register a new user, log in, confirm the placeholder page shows the username; hard-reload and confirm the session survives (refresh-cookie restore working, matching `restoreSession`'s current behavior); log out and confirm redirect to `/login`; hit `/` while logged out and confirm redirect to `/login`; hit `/login` while logged in and confirm redirect to `/`. Theme: toggle `localStorage`'s two keys directly and reload for all 4 brand×mode combinations plus the no-value (follow-system) case, confirming the same computed colors `styles.css` produces today (cross-checked via `getComputedStyle`, not just visually) and no flash of the wrong palette on load. Confirm `frontend/` is completely unaffected (its own test suite still passes, still runs on its own port) — this phase adds a new app, it does not touch the old one.

## Found during implementation

- Django's `CORS_ALLOWED_ORIGINS`/`CSRF_TRUSTED_ORIGINS` (`backend/src/config/settings/base.py`) only allow-listed `http://localhost:4200` (the Angular dev server) — ADR 0012 decision 3 (side-by-side dev servers, real cross-origin calls) needs `http://localhost:3000` added too, or every request from `frontend-next/` is CORS-blocked. Added to both lists' defaults, matching the existing code comment's own instruction ("extend this list... if more dev origins show up").
- `AuthProvider`'s init effect (`lib/auth-context.tsx`) had the CSRF-bootstrap `fetch` outside any `try/catch` — if it throws for any reason (the CORS failure above, or later just a network blip), the effect never reaches `setReady(true)`, permanently stranding the whole app on a blank screen (`ready` stays `false` forever). Fixed by wrapping that fetch in its own `try/catch` so a bootstrap failure degrades to "attempt restore anyway, then render" instead of "never render."
- A benign React hydration-mismatch warning on `<html data-theme>` (the pre-paint script sets it before hydration, same category of intentional SSR/client attribute disagreement every dark-mode-via-inline-script library has) — silenced with `suppressHydrationWarning` on the root `<html>` element, not a real bug.

## Found during verification

Two real, full-run Canary sessions against the actual running stack (Django + the Next.js dev server), not a dry read of the code:
- First run: confirmed the CORS/blank-app bug above — every route (`/`, `/login`, `/register`) rendered nothing, caught via Next's dev error overlay pointing at the exact unguarded `fetch` call. Root-caused (not patched around) via a direct `curl -H "Origin: http://localhost:3000"` against the CSRF endpoint showing no `Access-Control-Allow-Origin` header at all.
- Second run, after both fixes: full pass — register → redirected to `/` and shown the placeholder; hard-reload kept the session; logout redirected to `/login`; direct nav to `/` while logged out redirected to `/login?redirect=%2F`; re-login restored the session; direct nav to `/login` while authenticated redirected back to `/`. Theme: electric+dark computed `rgb(6, 11, 24)`, citrus+light computed `rgb(255, 253, 248)` — both exact matches. Zero console errors of any kind (the CORS error from the first run confirmed gone).
- `frontend/` (Angular) confirmed genuinely unaffected: `git status` shows zero diff in that directory, and its own test suite (40/40, `ng test`/vitest) still passes unchanged.

## Status

Implemented and verified against the real running stack (Django + a live Next.js dev server, both real browser sessions via Canary). Closes Phase 1 of ADR 0012/spec 0033. Phase 2 (Home dashboard + My debates list) is next, its own spec (0035+) to be written before it starts.

## Branch

`migration/nextjs-frontend` (continuing).
