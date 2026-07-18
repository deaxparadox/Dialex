"""SQLAlchemy Core async engine — reads/writes the same Postgres tables
Django owns (decision 9). Never runs migrations; never writes to a table
Django doesn't already know about. Table definitions live in
generated_tables.py, produced by sqlacodegen — never hand-edited."""

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from .config import settings


def _to_asyncpg_url(url: str) -> str:
    # DATABASE_URL arrives as postgres://... (django-environ/12-factor
    # convention) — SQLAlchemy's asyncpg dialect needs the explicit
    # postgresql+asyncpg:// scheme.
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


engine: AsyncEngine = create_async_engine(_to_asyncpg_url(settings.database_url))
