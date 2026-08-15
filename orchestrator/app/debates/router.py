"""`POST /api/debates/{debate_id}/start` — decision 2's "FastAPI starts
workflows." No case-submission/consultant UI exists yet (ADR 0004's scope
note), so this milestone's test path is: create Case/Debate/participants
via Django admin, then call this endpoint directly."""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect, status

from ..core.observability import bind_debate_context
from ..core.redis_client import redis_client
from ..core.security import AuthContext, decode_access_token, get_auth_context
from ..core.temporal_client import TASK_QUEUE
from . import queries
from .schemas import StartDebateResponse
from .workflows import DebateWorkflow

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/debates", tags=["debates"])

# WebSocket close codes (RFC 6455 doesn't define a generic "unauthorized";
# 1008 "Policy Violation" is the conventional choice apps use for this).
_WS_POLICY_VIOLATION = 1008


@router.post("/{debate_id}/start", response_model=StartDebateResponse, status_code=status.HTTP_202_ACCEPTED)
async def start_debate(
    debate_id: int, request: Request, auth: AuthContext = Depends(get_auth_context)
):
    bind_debate_context(debate_id=debate_id, session_id=auth.session_id, user_id=auth.user_id)

    debate = await queries.get_debate(debate_id)
    if debate is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Debate not found")

    # Authentication alone only proves who's asking, not that they're
    # allowed to start THIS debate — the same gap decision 13a already
    # flagged for the WebSocket endpoint applies here too (caught by
    # automated security review during spec 0005's implementation, not
    # anticipated in the spec itself). 404 rather than 403, so a debate
    # belonging to someone else doesn't even reveal it exists.
    case = await queries.get_case(debate["case_id"])
    if case["created_by_id"] != auth.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Debate not found")

    if debate["status"] != "OPEN":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Debate is '{debate['status']}', not 'OPEN' — cannot start",
        )

    client = request.app.state.temporal_client
    handle = await client.start_workflow(
        DebateWorkflow.run,
        debate_id,
        id=f"debate-{debate_id}",
        task_queue=TASK_QUEUE,
    )
    logger.info("debate workflow started: %s", handle.id)
    return StartDebateResponse(workflow_id=handle.id, run_id=handle.first_execution_run_id or "")


@router.websocket("/{debate_id}/stream")
async def stream_debate(websocket: WebSocket, debate_id: int):
    """Live push (ADR 0006/spec 0013) — complete events (argument_complete,
    status_change, etc.) plus token-by-token streaming events (turn_token/
    turn_token_reset, ADR 0007/specs 0020-0021) for all three turn types.
    JWT rides the WebSocket subprotocol field (decision 13a) since browsers
    can't set custom headers on the handshake; the ownership check mirrors
    `start_debate` above — same IDOR-avoidance shape, just closing the
    socket instead of raising an HTTPException (nothing to attach a status
    code to on a WebSocket)."""
    subprotocols = websocket.scope.get("subprotocols", [])
    token = subprotocols[0] if subprotocols else None
    auth = decode_access_token(token)
    if auth is None:
        await websocket.close(code=_WS_POLICY_VIOLATION)
        return

    bind_debate_context(debate_id=debate_id, session_id=auth.session_id, user_id=auth.user_id)

    debate = await queries.get_debate(debate_id)
    if debate is None:
        await websocket.close(code=_WS_POLICY_VIOLATION)
        return
    case = await queries.get_case(debate["case_id"])
    if case["created_by_id"] != auth.user_id:
        # Same reasoning as start_debate's 404 — don't let a close code
        # distinguish "not yours" from "doesn't exist" either.
        await websocket.close(code=_WS_POLICY_VIOLATION)
        return

    await websocket.accept(subprotocol=token)
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
        # Push-only endpoint — the client never sends data (debate-stream.ts's
        # connect() has no socket.send() call), so this only ever unblocks on
        # an actual disconnect, raising WebSocketDisconnect (verified against
        # current Starlette/FastAPI docs, not assumed).
        while True:
            await websocket.receive_text()

    forward_task = asyncio.create_task(_forward_redis())
    watch_task = asyncio.create_task(_watch_for_disconnect())
    try:
        # Without this race, a disconnect is only ever discovered when
        # send_text() next raises — which never happens once nothing more is
        # published to a finished debate's channel, leaking the subscription
        # and this task forever (the bug this fix closes).
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
