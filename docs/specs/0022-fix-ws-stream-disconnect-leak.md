# Spec 0022 — Fix `stream_debate`'s disconnect-leak

No ADR — a concurrency bug fix to an existing endpoint (`WS /api/debates/{id}/stream`, ADR 0006), not a new dependency or cross-cutting pattern. The fix pattern (racing two `asyncio.Task`s, cancelling the loser) is a well-established idiom, verified directly against current FastAPI/Starlette docs below, not assumed from memory.

## Root cause (already logged in `TODO.md`, re-confirmed by reading the code directly)

`orchestrator/app/debates/router.py:98-108`, `stream_debate`'s only await is:
```python
async for message in pubsub.listen():
    ...
    await websocket.send_text(message["data"])
```
A client disconnect is only ever discovered when `send_text()` next raises — and since a finished debate never publishes again, that never happens. The loop blocks forever, so the `finally` block's `pubsub.unsubscribe()`/`aclose()` never runs: a leaked Redis subscription + orphaned asyncio task per finished debate, confirmed live (`redis-cli PUBSUB CHANNELS` still showing 6 finished debates' channels 10+ minutes after they closed).

## Fix — race the Redis-forward loop against a disconnect-watcher

Verified against current Starlette/FastAPI docs (context7, not memory): `websocket.receive_text()` raises `starlette.websockets.WebSocketDisconnect` the instant the client's close reaches the server — this is FastAPI's own documented idiom for detecting a disconnect (`docs/advanced/websockets`: "receiving data via `websocket.receive_text()` raises a `WebSocketDisconnect` exception"). This app's WS client never sends data (`debate-stream.ts`'s `connect()` has no `socket.send(...)` call anywhere — confirmed by reading it), so a loop calling `receive_text()` only ever unblocks on an actual disconnect, never a real inbound message.

`orchestrator/app/debates/router.py`:
```python
import asyncio
# ... existing imports ...

@router.websocket("/{debate_id}/stream")
async def stream_debate(websocket: WebSocket, debate_id: int):
    # ... unchanged: auth handshake through accept() ...

    channel = f"debate:{debate_id}:stream"
    pubsub = redis_client.pubsub()
    await pubsub.subscribe(channel)
    logger.info("stream client subscribed to %s", channel)

    async def _forward_redis() -> None:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            await websocket.send_text(message["data"])

    async def _watch_for_disconnect() -> None:
        # Push-only endpoint — the client never sends data, so this only
        # ever unblocks on an actual disconnect.
        while True:
            await websocket.receive_text()

    forward_task = asyncio.create_task(_forward_redis())
    watch_task = asyncio.create_task(_watch_for_disconnect())
    try:
        done, pending = await asyncio.wait(
            {forward_task, watch_task}, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
        for task in done:
            exc = task.exception()
            if exc is not None and not isinstance(exc, WebSocketDisconnect):
                raise exc
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()
        logger.info("stream client disconnected from %s", channel)
```

Whichever task finishes first wins (normally `_watch_for_disconnect`, immediately on client close); the other is cancelled. The `finally` block is unchanged and runs in both cases.

## Explicitly out of scope

Any change to the auth handshake, event publishing, or the Redis channel/message shape — this touches only how a disconnect is detected. The frontend needs no change (it already closes the socket normally on navigation/unmount, `debate-thread.ts`'s `closeStream()`).

## Verification plan

- Real WS test client: connect to a debate's stream, then close the client connection — confirm via orchestrator logs (`"stream client disconnected from ..."`) and `redis-cli PUBSUB CHANNELS` that cleanup happens within ~1s, not indefinitely. Test both a still-in-progress debate (client leaves mid-run) and an already-terminal one (the exact leak scenario logged).
- Confirm existing behavior is unaffected: a full debate run still delivers every event correctly to a connected client (same check as specs 0013/0014/0020/0021's verification).
- Check orchestrator logs for any noisy `asyncio.CancelledError` traceback from the cancelled task (should be clean — `task.cancel()` + the task exiting is expected, not an error).
- Confirm the invalid-token/non-owner rejection paths (earlier in the same handler, untouched) still work.

## Branch

Continuing on `main`.

## Found during verification

No new bugs found — a clean pass, plus one genuinely useful clarifying finding (not a bug) about when this fix actually matters in practice.

**Verified directly against a raw WS client (no Angular graceful-close logic involved) — the scenario this fix actually targets:**
- Connected to an already-terminal debate (37, `NO_CONSENSUS`), then closed the client. Before this fix, the "stream client disconnected" log line could never appear here (nothing left to publish, so `send_text()` never gets a chance to fail) — confirmed it now logs within ~1s of the client closing, and `redis-cli PUBSUB CHANNELS` shows zero leaked subscriptions immediately after.
- A connection held open from before a debate started (43) through to completion, then closed — same result: immediate cleanup, and a full run's worth of events (`turn_started`, `turn_token` ×369, `turn_token_reset` ×4, `argument_complete`, `status_change`, final `NO_CONSENSUS`) delivered correctly and in order throughout, confirming zero regression to normal delivery. No `asyncio.CancelledError` noise or other exceptions in the logs in either case.

**Verified in a real browser, three angles (debates 43/44/45), correlating browser-reported timestamps against orchestrator logs and independent Redis polling:**
- Fresh visit to an already-finished debate: the frontend correctly never opens a WebSocket at all (`isActive()` gates it) — nothing to leak here in the first place.
- Navigating away while a debate is still actively running: disconnect logged ~20ms after the browser's own navigation timestamp — clean, fast cleanup.
- Staying on the page through an entire debate run, then navigating away several seconds later: **a genuinely useful finding, not a bug** — `debate-thread.ts`'s existing `loadDebate()` logic (pre-dating this fix, from spec 0014) already calls `closeStream()` proactively the instant it detects the debate is no longer active, so the connection was already closed 24 seconds *before* the browser ever navigated away. This means the fix's practical value is specifically for cases where that graceful client-side path doesn't fire — an abrupt tab crash/force-quit, a network drop, or a missed final event — exactly what the raw-client tests above exercise directly, since a raw client has no such logic of its own.

## Status

Implemented and verified against the real running stack — the leak is confirmed closed (immediate cleanup on disconnect, both mid-run and post-terminal), with no regression to normal event delivery. No frontend changes needed.
