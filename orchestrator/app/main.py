from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, status
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from sqlalchemy import select

from .core.db import engine
from .core.generated_tables import t_accounts_user
from .core.observability import bind_debate_context, setup_observability
from .core.security import AuthContext, get_auth_context
from .core.temporal_client import get_temporal_client
from .debates.router import router as debates_router

setup_observability("dialex-orchestrator-api", Path(__file__).resolve().parent.parent / "logs" / "orchestrator.log", engine=engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # One Temporal connection for the process's lifetime, not one per
    # request to the start endpoint.
    app.state.temporal_client = await get_temporal_client()
    yield


app = FastAPI(title="Dialex FastAPI service", lifespan=lifespan)
FastAPIInstrumentor.instrument_app(app)
app.include_router(debates_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/me")
async def me(auth: AuthContext = Depends(get_auth_context)):
    """Proves the whole chain: JWT verified independently of Django, then a
    real read against the Django-owned Postgres table (spec 0004)."""
    bind_debate_context(session_id=auth.session_id, user_id=auth.user_id)
    async with engine.connect() as conn:
        result = await conn.execute(
            select(
                t_accounts_user.c.id,
                t_accounts_user.c.username,
                t_accounts_user.c.email,
            ).where(t_accounts_user.c.id == auth.user_id)
        )
        row = result.first()

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    return {"id": row.id, "username": row.username, "email": row.email}
