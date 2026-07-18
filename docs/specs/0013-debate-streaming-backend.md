# Spec 0013 — Redis pub/sub + WebSocket debate streaming, backend

> Governed by [ADR 0006](../adr/0006-redis-websocket-streaming.md). Implements decisions 12/13a, scoped to complete-event push (not token-by-token argument text — see ADR 0006 Decision 1 for the empirical reasoning). **Backend only** — frontend is a separate follow-up spec, same split as 0005→0006 and 0009→0010.

## What's being built

The moment an argument, status change, or verdict actually happens, it's pushed live to any connected WebSocket client watching that debate — instead of the client having to wait for its next poll. Verified via a real WebSocket test client against a live debate run, not curl (WS isn't curl-friendly the way REST is).

## 1. New dependency

`orchestrator/requirements.txt`: `redis==8.0.1` (current stable, ships `redis.asyncio` — no separate `aioredis` package).

## 2. Config (`orchestrator/app/core/config.py`)

New required setting, no default (fail-fast, matching `database_url`/`temporal_address`):
```python
redis_url: str  # e.g. redis://redis:6379/0 inside compose
```

## 3. `docker-compose.yml`

`orchestrator` and `orchestrator-worker` services both get:
```yaml
environment:
  REDIS_URL: redis://redis:6379/0
```
(same override pattern already used for `DATABASE_URL` — compose-internal hostname, not the host-side `.env` value). `orchestrator/.env`/`.env.example` get `REDIS_URL=redis://localhost:6380/0` (matching the existing `REDIS_PORT=6380` remap). Both services already `depends_on: db`; add `redis` to that list (no healthcheck needed beyond the container running — Redis starts near-instantly, and a missing connection fails loudly at first use anyway, not silently).

## 4. `orchestrator/app/core/redis_client.py` (new)

One shared async client, same shape as `core/db.py`'s module-level `engine`:
```python
from redis.asyncio import Redis
from .config import settings

redis_client: Redis = Redis.from_url(settings.redis_url, decode_responses=True)
```
`decode_responses=True` so publishers/subscribers work in `str`, not `bytes` — every message here is JSON text.

## 5. Publish calls — `orchestrator/app/debates/activities.py`

Each publish is `await redis_client.publish(f"debate:{debate_id}:stream", json.dumps({...}))`, added immediately after the existing DB write in the same Activity (no new Activities, no change to `workflows.py`'s control flow):

- `persist_argument` → after `queries.insert_argument`: publish `{"type": "argument_complete", "argument_id": argument_id}`.
- `set_debate_status` → after the existing update: publish `{"type": "status_change", "status": status}`.
- `persist_verdict_and_close` → after `queries.close_debate`: publish `{"type": "status_change", "status": final_status}`.
- `mark_failed` → after `queries.set_debate_status(debate_id, "FAILED")`: publish `{"type": "status_change", "status": "FAILED"}`.

No publish added to `fetch_debate_context`, `fetch_arguments`, `check_convergence`, `set_debate_round`, or `persist_opening_statement` (ADR 0006 Decision 3 — the last one is a known, accepted small gap, not silently different from what the ADR says).

## 6. WebSocket endpoint — `orchestrator/app/debates/router.py`

```python
@router.websocket("/{debate_id}/stream")
async def stream_debate(websocket: WebSocket, debate_id: int):
    subprotocols = websocket.scope.get("subprotocols", [])
    token = subprotocols[0] if subprotocols else None
    auth = decode_ws_token(token)  # shares the JWT-decode logic get_auth_context already uses
    if auth is None:
        await websocket.close(code=1008)  # policy violation
        return

    debate = await queries.get_debate(debate_id)
    if debate is None:
        await websocket.close(code=1008)
        return
    case = await queries.get_case(debate["case_id"])
    if case["created_by_id"] != auth.user_id:
        await websocket.close(code=1008)  # same 404-shaped reasoning as REST — don't distinguish
        return                             # "not yours" from "doesn't exist" even on close codes

    await websocket.accept(subprotocol=token)
    pubsub = redis_client.pubsub()
    await pubsub.subscribe(f"debate:{debate_id}:stream")
    try:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            await websocket.send_text(message["data"])
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(f"debate:{debate_id}:stream")
```
`decode_ws_token` — a small refactor of `core/security.py`'s existing JWT-decode logic into a callable both `get_auth_context` (HTTP) and this endpoint (WS) call, returning `None` on failure instead of raising `HTTPException` (a WebSocket has no HTTP response to attach an error status to — closing the connection with code `1008` is the correct WS-native equivalent of a 401/404, not a special case invented for this endpoint).

## Explicitly out of scope

The frontend (separate follow-up spec). The `retry` event (ADR 0006 Decision 1's consequence — nothing to clean up under complete-event push). The notification system / `app_notifications` channel (decision 17, a genuinely separate feature). Research-round event types (no research round exists yet).

## Found during implementation/verification

Rejection closes manifest as an **HTTP 403 at the WebSocket handshake**, not a WS close frame with code 1008 — `websocket.close()` called before `websocket.accept()` aborts the protocol upgrade at the ASGI level rather than sending a close frame over an established WS connection. Confirmed via a real client (`websockets` library raised `InvalidStatus: server rejected WebSocket connection: HTTP 403`) for both the invalid-token and wrong-owner cases. Same protective effect as intended (the connection never succeeds either way) — the spec's code above is accurate about *when* the rejection happens, just not the exact wire-level shape it takes.

## Verification plan

- `docker compose up -d redis orchestrator orchestrator-worker` — confirm `REDIS_URL` resolves, no startup failures.
- Confirm the worker/API fail loudly at startup if `REDIS_URL` is unset (no silent skip) — same check already done for `OPENAI_API_KEY`/`TEMPORAL_ADDRESS`.
- A small standalone Python script (using the `websockets` library, or equivalent) that: connects to `ws://localhost:8010/api/debates/{id}/stream` with the access token as its subprotocol, for a debate that's about to be started.
- Start that debate via the existing `POST /api/debates/{id}/start` (spec 0005) in parallel — confirm the WS client receives `argument_complete`/`status_change` events live, in real time, as the debate actually runs (not batched, not delayed) — cross-check each `argument_complete`'s `argument_id` against what actually landed in Postgres at roughly that moment.
- Confirm a WS connection attempt with an invalid/missing token, and one for a debate belonging to a different user, both get closed immediately (code 1008), not accepted.
- Confirm two simultaneous WS clients on the same debate both receive every event (Redis fan-out, no connection-manager code needed).
- Confirm the connection closes cleanly (or the client can simply disconnect) once the debate reaches `JUDGED`/`NO_CONSENSUS`/`FAILED` — no hang, no error.

## Verified against a real debate run with a real WebSocket client

Every item in the verification plan above confirmed directly (not assumed): `REDIS_URL` fails loudly if unset; a real client received `status_change`(ARGUING)→`argument_complete`×4→`status_change`(CONVERGING)→`status_change`(NO_CONSENSUS) live over a real ~26s debate run, timestamps spread across the whole run, not batched; every streamed `argument_id` matched exactly what actually landed in Postgres; invalid-token and wrong-owner connection attempts both rejected outright; two simultaneous viewers on the same debate received an identical event sequence with zero connection-manager code; connections sat idle harmlessly (no hang, no error) after the debate reached a terminal status. Django's existing test suite (8 tests) still passes unmodified.

## Branch

Continuing on `main`.

## Status

Implemented and verified end to end against a real running debate. No functional bugs found — one implementation detail (rejection-close mechanics) confirmed and documented above, not a defect.
