# Spec 0006 — Wire the Angular frontend to real Django auth

> Governed by [ADR 0001 — frontend architecture](../adr/0001-frontend-architecture.md), which already covers this milestone's architecture (functional interceptors for decision 13's JWT handling, `core/` for app-wide singletons, SignalStore-vs-plain-signals scoping) — no new ADR needed. Implements decision 13/13a against the auth endpoints already built in spec 0003 (and this session's `session_id` claim addition).

## What's being built

A real user can register, log in, and log out through the running app for the first time — currently only possible via direct API calls. Debate-thread stays on mock data; wiring it to real orchestration is a separate follow-up (needs new Django read endpoints that don't exist yet).

### 0. Backend: CORS (a gap this spec missed when first written)
`localhost:4200` (Angular dev server) and `localhost:8000` (Django) are different origins — the cookie-based refresh flow (decision 13) needs CORS configured with credentials allowed, and nothing like this existed anywhere in the backend. Adding `django-cors-headers==4.9.0` (verified against PyPI, supports Django 5.2) to `backend/requirements.txt`: `corsheaders` in `INSTALLED_APPS`, `CorsMiddleware` early in `MIDDLEWARE` (before `CommonMiddleware`, per the package's own docs), `CORS_ALLOWED_ORIGINS = ["http://localhost:4200"]` (narrow, not a wildcard — a wildcard origin is incompatible with `CORS_ALLOW_CREDENTIALS` anyway), `CORS_ALLOW_CREDENTIALS = True`.

### 1. `src/environments/environment.ts`
Two base URLs, dev values only (no `environments/environment.prod.ts` yet — deployment tooling is explicitly out of ADR 0001's scope): `djangoApiBase: 'http://localhost:8000'`, `orchestratorApiBase: 'http://localhost:8010'`.

### 2. `core/auth/auth.service.ts`
Signals-based, matching ADR 0001's "feature/app-wide state → SignalStore or signals" guidance (this is small enough for plain signals, not a full SignalStore):
- `accessToken = signal<string | null>(null)` — in-memory only, never `localStorage` (decision 13).
- `isAuthenticated = computed(() => this.accessToken() !== null)`.
- `login(username, password)`, `register(username, email, password)`, `logout()` — call the Django endpoints from spec 0003.
- `refresh()` — calls `POST /api/auth/refresh/`; de-duplicated so concurrent 401s from multiple in-flight requests trigger exactly one refresh call, not one per request (a `refreshInProgress$` shared observable the interceptor awaits if already set).
- `bootstrapCsrf()` — calls `GET /api/auth/csrf/` once.

### 3. `core/auth/auth.interceptor.ts` (functional `HttpInterceptorFn`)
- Attaches `Authorization: Bearer <token>` to outgoing requests targeting `environment.djangoApiBase`/`environment.orchestratorApiBase` — skipped for the login/register/refresh/csrf calls themselves.
- On a 401 from any *other* request: calls `authService.refresh()` (or awaits the in-flight one), retries the original request once with the new token. If refresh itself fails, clears the session and navigates to `/login`.
- No `withXsrfConfiguration` needed — Angular's `HttpClient` default cookie/header names (`XSRF-TOKEN`/`X-XSRF-TOKEN`) already match what Django's configured to (ADR 0001/decision 13), confirmed against current Angular docs rather than assumed.

### 4. CSRF bootstrap
`provideAppInitializer(() => inject(AuthService).bootstrapCsrf())` in `app.config.ts` — the current idiom (replaces the deprecated `APP_INITIALIZER` token), verified against Angular's own docs. Ensures the CSRF cookie exists before any refresh/logout call, matching spec 0003's `CsrfBootstrapView` comment ("GET this once on app load").

### 5. `core/auth/auth.guard.ts`
Two functional guards: `authGuard` (redirect to `/login` if not authenticated) and `guestGuard` (redirect authenticated users away from `/login`/`/register` to `/`).

### 6. Routes (`app.routes.ts`)
`/login` and `/register` (both `guestGuard`), `''` (`DebateThread`, now `authGuard`-protected).

### 7. Login/register screens — minimal design pass, reusing existing tokens
`features/auth/login/` and `features/auth/register/`: a single centered card (`background: var(--ground)` on the `--page` backdrop, same visual language as debate-thread's header-card) with labeled inputs and a submit button, `--ink`/`--ink-muted` text, `--line` borders, `--font-body`. No new visual concept — reusing what's already validated, not a fresh design cycle.
- Login: username + password. On success, navigate to `/` (or a `?redirect=` query param if the guard redirected here from a protected route). On failure, an inline error message.
- Register: username + email + password + confirm-password (client-side match check). On success, auto-login with the same credentials (simpler UX than forcing a second manual login) then navigate to `/`.

### 8. Minimal authenticated-shell affordance
`app.html`/`app.ts`: a small top bar, shown only when `authService.isAuthenticated()`, with a "Log out" button — sits above `<router-outlet>`, doesn't touch debate-thread's own already-validated header-card.

## Explicitly out of scope

Wiring debate-thread to real orchestration data (needs new Django read endpoints — its own follow-up spec), password-reset/forgot-password flow, remember-me, social auth, a `environment.prod.ts`/deployment config.

## Verification plan

- Register a new user through the UI, confirm auto-login lands on `/` .
- Log out, confirm redirected to `/login` and `/` becomes inaccessible (guard redirects back to `/login`).
- Log in with wrong password, confirm the inline error shows (not a silent failure or unhandled console error).
- Force an access-token expiry (or manually clear `accessToken` mid-session) and trigger a request, confirm the interceptor transparently refreshes and retries rather than bouncing the user to `/login` unnecessarily.
- Confirm only one refresh call fires even if multiple requests 401 at once (check Network tab / a temporary log line).
- Confirm the CSRF cookie is present (DevTools) before the first logout/refresh call ever fires.

## Found during real-browser verification (Canary), fixed before landing

Four real bugs across three verification rounds, all surfaced by actually driving a Chromium browser through the flow rather than trusting unit tests alone — each round's fix was re-verified against a fresh browser context before moving on, not assumed fixed:

1. **CSRF header never attached to logout/refresh, causing a 403.** Angular's *built-in* XSRF interceptor deliberately skips cross-origin requests — verified against its source: it compares `new URL(req.url).origin` to the page's own origin and no-ops if they differ. `:4200` → `:8000` is exactly that case, so this spec's original assumption ("names match Django's defaults, no config needed") was wrong specifically for the cross-origin case. Fixed by reading the `XSRF-TOKEN` cookie and attaching `X-XSRF-TOKEN` manually in `auth-interceptor.ts` for requests to `environment.djangoApiBase` — an origin we explicitly trust, unlike Angular's conservative default.
2. **No silent refresh on app startup**, so any hard reload (including directly navigating to `/login` while authenticated, one of this spec's own verification steps) always lost the in-memory access token and landed on `/login` even with a valid `refresh_token` cookie still present. Fixed by adding `Auth.restoreSession()` — one `refresh()` attempt at startup, failure swallowed (no valid cookie just means starting logged out) — called from the app initializer right after the CSRF bootstrap.
3. **Fix #1 then broke CORS entirely**, once the app initializer started sending `X-XSRF-TOKEN` on every load: that's a non-simple header, so the browser now preflights, and `django-cors-headers`' own default `CORS_ALLOW_HEADERS` includes `x-csrftoken` (Django's *default* CSRF header name) but not `x-xsrf-token` (the name this project deliberately renamed it to, to match Angular's defaults) — the preflight's `Access-Control-Allow-Headers` response omitted it, so the browser blocked the real request before Django ever saw it. Fixed with an explicit `CORS_ALLOW_HEADERS = [*default_headers, "x-xsrf-token"]` in `backend/src/config/settings/base.py`.
4. **Fixing #3 still left a 403 on logout/refresh**, this time from `CsrfViewMiddleware`'s `Origin`-header check — a separate, independent protection from CORS entirely (easy to conflate the two, verified against Django's own docs). `CSRF_TRUSTED_ORIGINS` had no entry for `http://localhost:4200`. Fixed by adding it (scheme required, unlike `CORS_ALLOWED_ORIGINS`).
5. Also hardened `App.logout()`: it only called `router.navigateByUrl('/login')` *after* the server logout call resolved, so bug 1 above additionally meant a failed logout request left the user stranded (session cleared client-side, but never redirected, no error shown). Now navigates in a `finally`, unconditionally.

Final round (after all four fixes): all 7 verification checks passed clean on a fresh browser context — register → auto-login → logout (204) → re-login → full reload (session survives, `refresh/` returns 200 not 403) → direct `/login` navigation while authenticated (redirected away) — zero console/CORS/CSRF errors throughout.

## Branch

Continuing on `main`.

## Status

Implemented and verified against a real browser (Canary), three rounds, all passing.
