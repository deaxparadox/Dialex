# Dialex orchestrator

The orchestration front door, built with FastAPI — see [docs/adr/0003-fastapi-architecture.md](../docs/adr/0003-fastapi-architecture.md) and [docs/specs/0004-fastapi-scaffold.md](../docs/specs/0004-fastapi-scaffold.md). (Folder renamed from `fastapi_service/` — named by role, matching `frontend`/`backend`, not by the framework it happens to use.)

This milestone: service skeleton, SQLAlchemy Core DB access, JWT verification only. **No Temporal, LangGraph, WebSocket, or Redis yet** — that's a later milestone.

## Running via docker-compose (recommended)

From the repo root: `docker compose up -d orchestrator` (brings up `db` too, via `depends_on`).

- Health check: http://localhost:8010/health
- Authenticated example: http://localhost:8010/api/me (needs a Django-issued access token — `Authorization: Bearer <token>`, obtained from `POST http://localhost:8000/api/auth/login/`)

## Running directly (without docker-compose)

```
cd orchestrator
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in real values — JWT_SIGNING_KEY must match Django's SIMPLE_JWT_SIGNING_KEY exactly
uvicorn app.main:app --reload --port 8001
```

## Regenerating `generated_tables.py`

Whenever Django's migrations change the schema:

```
pip install -r requirements-dev.txt
sqlacodegen --generator tables "$DATABASE_URL" > app/core/generated_tables.py
```

Never hand-edit this file — see the header comment inside it. There's no CI check enforcing this yet (no CI pipeline exists in this repo) — tracked as a known gap in ADR 0003, not silently dropped.
