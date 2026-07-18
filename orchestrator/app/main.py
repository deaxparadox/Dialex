from fastapi import Depends, FastAPI, HTTPException, status
from sqlalchemy import select

from .core.db import engine
from .core.generated_tables import t_accounts_user
from .core.security import get_current_user_id

app = FastAPI(title="Dialex FastAPI service")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/me")
async def me(user_id: int = Depends(get_current_user_id)):
    """Proves the whole chain: JWT verified independently of Django, then a
    real read against the Django-owned Postgres table (spec 0004)."""
    async with engine.connect() as conn:
        result = await conn.execute(
            select(
                t_accounts_user.c.id,
                t_accounts_user.c.username,
                t_accounts_user.c.email,
            ).where(t_accounts_user.c.id == user_id)
        )
        row = result.first()

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    return {"id": row.id, "username": row.username, "email": row.email}
