"""Shared async Redis client for live debate streaming (decision 12,
spec 0013) — same module-level-singleton shape as `db.py`'s `engine`.
`decode_responses=True` since every message on these channels is JSON text,
not binary."""

from redis.asyncio import Redis

from .config import settings

redis_client: Redis = Redis.from_url(settings.redis_url, decode_responses=True)
