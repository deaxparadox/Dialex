# ADR 0003 — FastAPI service architecture & scaffolding conventions

> Written before scaffolding any FastAPI code, per this repo's CLAUDE.md. Unlike Django/Angular, FastAPI has no official generator — verified rather than assumed (`fastapi-cli` only serves an existing app via `fastapi dev`/`fastapi run`; the "official" [Full Stack FastAPI Template](https://github.com/fastapi/full-stack-fastapi-template) is a full React+SQLModel+Postgres template, not a fit for this service's SQLAlchemy-Core-only, no-ORM shape). Hand-authoring the structure below is legitimate under this repo's "scaffold with the framework's own generator" rule, which only applies when a generator exists.
>
> Folder renamed from `fastapi_service/` to `orchestrator/` after this ADR was written — same content below, named by role (matching `frontend`/`backend`) rather than by the framework it happens to use.

## Scope of this first milestone

Service skeleton, DB access, and JWT verification only — proving FastAPI can authenticate a request and read/write the same Postgres tables Django owns. Temporal workflows, LangGraph agents, WebSocket streaming, and Redis pub/sub are explicitly a later milestone, not part of this ADR's scope.

## Versions (verified, not assumed — mid-2026)

- `fastapi==0.139.2` (still pre-1.0 by SemVer, production-stable per its own release notes)
- `uvicorn[standard]==0.51.0` (the `[standard]` extra is required now — `websockets`/`uvloop`/`httptools` are no longer bundled by default)
- `sqlalchemy==2.0.51` (2.1 has a beta line; staying on the stable 2.0.x series)
- `asyncpg==0.31.0` — chosen over `psycopg3` for the async driver specifically for raw throughput; psycopg3 is the modern alternative but generally benchmarks slower for this workload
- `pydantic-settings==2.14.2` — fail-fast required config, the same principle `django-environ` implements on the Django side
- `pyjwt==2.13.0` — verifies HS256 tokens; `djangorestframework-simplejwt` also uses PyJWT under the hood for HMAC signing, so both sides share the same underlying implementation, not just a compatible one

## Project structure — domain/module-based, not type-based

```
orchestrator/
  app/
    main.py              — FastAPI() instance, router includes
    core/
      config.py          — pydantic-settings, no defaults on required vars
      db.py               — SQLAlchemy Core async engine
      security.py         — JWT verification dependency (shared signing key, decision 13)
      generated_tables.py — sqlacodegen output (decision 9), never hand-edited
  requirements.txt
  Dockerfile
  .env.example
```
Domain folders (`debates/`, `consultations/`, each with `router.py`/`schemas.py`/`queries.py`) get added once orchestration work actually starts — not created speculatively now with nothing to hold.

## DB access — this milestone actually completes decision 9, not just smoke-tests it

The earlier `sqlacodegen` check (spec 0003) had no permanent home to commit its output to. This service is that home: `generated_tables.py` is generated now against the real schema and committed. The CI-diff enforcement mechanism decision 9 also describes (regenerate + diff on every build) is **not** set up in this milestone — this repo has no CI pipeline at all yet, so "regenerate and diff in CI" has nothing to run in. Tracked as a real gap, not silently dropped: needs a CI pipeline to exist first, which is its own future piece of work.

## JWT verification

FastAPI verifies tokens Django issued, independently, via the shared `SIMPLE_JWT_SIGNING_KEY` — no callback to Django per request (decision 13, already the plan since the very first auth discussion). `security.py` exposes a dependency (`get_current_user_id` or similar) that decodes and validates the token, raising `401` on failure — mirroring what `JWTAuthentication` does on the Django side, without depending on Django's code.

## What this doesn't cover

Temporal client/workflow wiring, LangGraph, WebSocket endpoints, Redis pub/sub — all later milestones, per the scope note above. Also not covered: an actual CI pipeline (noted above as a real, tracked gap).
