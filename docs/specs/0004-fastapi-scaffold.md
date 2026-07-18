# Spec 0004 — Scaffold FastAPI service: skeleton, DB access, JWT verification

> Governed by [ADR 0003 — FastAPI service architecture](../adr/0003-fastapi-architecture.md).

## What's being built

1. The `orchestrator/` project (hand-authored structure per ADR 0003 — no official generator exists).
2. `GET /health` — trivial liveness check.
3. `GET /api/me` — an authenticated example endpoint: verifies the JWT (shared signing key with Django, decision 13), reads the corresponding user's row from the Django-owned `accounts_user` table via SQLAlchemy Core, returns it. Proves the whole chain works: token verification + real cross-service DB read.
4. `generated_tables.py` — `sqlacodegen` output against the real schema, committed for the first time (decision 9's artifact now has a home).
5. An `orchestrator` service added to `docker-compose.yml`, alongside the existing 6.

## Explicitly out of scope (per ADR 0003)

Temporal, LangGraph, WebSocket, Redis — later milestone. CI pipeline for the regenerate-and-diff check — doesn't exist yet, tracked as a gap, not built here.

## Verification plan

- `GET /health` returns 200 with no auth.
- `GET /api/me` without a token returns 401.
- `GET /api/me` with a valid Django-issued access token (from the auth endpoints built in spec 0003) returns the correct user's data — an actual end-to-end test using a real token from `POST /api/auth/login/`, not a fabricated one.
- `GET /api/me` with an expired/tampered token returns 401.

## Branch

Continuing on `main`.

## Status

Awaiting explicit approval before implementation, per this repo's CLAUDE.md.
