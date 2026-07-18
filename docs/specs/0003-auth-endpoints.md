# Spec 0003 — Auth endpoints (register/login/refresh/logout) + sqlacodegen smoke-test

> Implements `references/002-design-review-findings.md` decisions 13/13a — no new architecture decision here, this is the first implementation of what's already locked. Governed by [ADR 0002](../adr/0002-backend-architecture.md).

## What's being built

1. Four endpoints in `apps.accounts`: `POST /api/auth/register/`, `POST /api/auth/login/`, `POST /api/auth/refresh/`, `POST /api/auth/logout/` — matching `docs/API.md`'s auth table.
2. Hand-rolled cookie handling on top of `djangorestframework-simplejwt` (no new dependency — confirmed with the user over `dj-rest-auth`, given this project's learning focus and unconfirmed exact-version compatibility for that package). Access token returned in the response body; refresh token set as an `HttpOnly`/`Secure`/`SameSite=Strict` cookie, scoped to `/api/auth/refresh/`, never present in JSON.
3. Refresh-token rotation + blacklist-after-rotation (`rest_framework_simplejwt.token_blacklist`, its own migration).
4. CSRF protection explicitly re-enabled on the refresh/logout endpoints specifically — DRF's `APIView` exempts all views from Django's CSRF middleware by default, and `JWTAuthentication` doesn't reinstate it (unlike `SessionAuthentication`, which does). Since the refresh token rides in a cookie the browser sends automatically, this is real CSRF surface that needs explicit `csrf_protect` on just these two views.
5. Django's CSRF cookie/header names set to match Angular's built-in `HttpClient` XSRF defaults (`XSRF-TOKEN` cookie / `X-XSRF-TOKEN` header) — so the frontend doesn't need special CSRF configuration later, it already sends what Django expects.
6. A one-off smoke-test of `sqlacodegen` (decision 9) against the real schema in the running `db` container — proving the tool works against our actual tables before FastAPI needs it. Not committed anywhere yet (no FastAPI project exists to house the generated file) — this is a confidence-check, not the permanent CI-diffed artifact decision 9 describes; that gets built when FastAPI's own spec starts.

## Endpoint behavior

- **Register**: `RegisterSerializer` validates via Django's standard password validators (no custom rules, per ADR 0002); creates the user; no email verification (PRD §9, deferred deliberately).
- **Login**: subclasses `TokenObtainPairView`; `finalize_response` pops `refresh` out of the body and sets it as the cookie instead.
- **Refresh**: subclasses `TokenRefreshView`; reads the refresh token from the cookie (not the request body); re-sets the rotated cookie on the way out; `csrf_protect` applied.
- **Logout**: blacklists the refresh token read from the cookie, deletes the cookie; `csrf_protect` applied.

## SIMPLE_JWT settings

```python
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=10),
    "SIGNING_KEY": env("SIMPLE_JWT_SIGNING_KEY"),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}
```

## Explicitly out of scope

- Frontend wiring (Angular's `withXsrfConfiguration`, the auth HTTP interceptor from ADR 0001) — happens when frontend integration work starts, not blocked by this spec but not done here either.
- The permanent, CI-diffed `sqlacodegen` artifact (decision 9) — needs a FastAPI project to live in; this spec only smoke-tests the tool works.
- Per-debate WebSocket authorization (decision 13a) — no WebSocket exists yet (that's FastAPI's job).

## Branch

Continuing on `main`, per the established pattern.

## Status

Awaiting explicit approval before implementation, per this repo's CLAUDE.md.
