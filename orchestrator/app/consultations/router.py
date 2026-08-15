"""Consultation endpoints (ADR 0005, spec 0009). Every endpoint checks
ownership before touching Temporal — never fetch-then-check-after, the same
IDOR shape already caught once in spec 0005."""

import json
import logging
from collections.abc import AsyncIterable

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.sse import EventSourceResponse, ServerSentEvent
from temporalio.client import WorkflowUpdateFailedError
from temporalio.exceptions import ApplicationError
from temporalio.service import RPCError, RPCStatusCode

from ..core.observability import bind_consultation_context
from ..core.redis_client import redis_client
from ..core.security import AuthContext, get_auth_context
from ..core.temporal_client import TASK_QUEUE
from . import queries
from .schemas import (
    ApproveResponse,
    StartConsultationRequest,
    StartConsultationResponse,
    SubmitMessageRequest,
    SubmitMessageResponse,
)
from .workflows import ConsultationWorkflow

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/consultations", tags=["consultations"])


def _root_cause_message(exc: WorkflowUpdateFailedError) -> str:
    """`approve`'s ApplicationError unwraps differently depending on where it
    was raised: directly in the update handler ("not ready yet"), `exc.cause`
    *is* the ApplicationError; raised inside `create_case_and_debate` (an
    Activity), it's wrapped one level deeper as `ActivityError.cause` —
    verified empirically (spec 0009), not assumed. Walk down to the first
    real ApplicationError either way."""
    cause = exc.cause
    while cause is not None and not isinstance(cause, ApplicationError):
        cause = getattr(cause, "cause", None)
    return str(cause) if cause is not None else str(exc.cause)


async def _get_owned_session(session_id: int, auth: AuthContext) -> dict:
    session = await queries.get_session(session_id)
    # 404, not 403 — authentication alone doesn't prove the caller owns
    # THIS session (same reasoning as the debates start endpoint, spec 0005).
    if session is None or session["user_id"] != auth.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consultation not found")
    return session


async def _owned_session_dependency(session_id: int, auth: AuthContext = Depends(get_auth_context)) -> dict:
    """A `Depends(...)`-wrapped form of `_get_owned_session`, needed only for
    the SSE endpoint below. Found the hard way: raising `HTTPException`
    *inside* an async-generator route (the required shape for
    `response_class=EventSourceResponse`, per FastAPI's own docs) doesn't
    convert to a normal 404 response — by the time the exception fires,
    Starlette's streaming machinery has already committed to the response,
    so it surfaces as an unhandled `ExceptionGroup` and the client gets a
    bare 200 with an empty body instead. Run as a dependency instead: FastAPI
    resolves dependencies *before* invoking the generator body, so the same
    404 here happens during normal request handling, not inside the stream."""
    return await _get_owned_session(session_id, auth)


@router.post("/", response_model=StartConsultationResponse)
async def start_consultation(
    body: StartConsultationRequest, request: Request, auth: AuthContext = Depends(get_auth_context)
):
    bind_consultation_context(session_id=auth.session_id, user_id=auth.user_id)

    config = await queries.get_case_type_defaults(body.case_type)
    if config is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown case_type")

    session_id = await queries.insert_session(
        user_id=auth.user_id,
        case_type=body.case_type,
        consultant_persona_id=config["default_consultant_persona_id"],
    )
    client = request.app.state.temporal_client
    await client.start_workflow(
        ConsultationWorkflow.run,
        session_id,
        id=f"consultation-{session_id}",
        task_queue=TASK_QUEUE,
    )
    logger.info("consultation session %d started", session_id)
    return StartConsultationResponse(session_id=session_id)


@router.post("/{session_id}/messages", response_model=SubmitMessageResponse)
async def submit_message(
    session_id: int,
    body: SubmitMessageRequest,
    request: Request,
    auth: AuthContext = Depends(get_auth_context),
):
    bind_consultation_context(
        consultation_session_id=session_id, session_id=auth.session_id, user_id=auth.user_id
    )
    await _get_owned_session(session_id, auth)

    client = request.app.state.temporal_client
    handle = client.get_workflow_handle(f"consultation-{session_id}")
    try:
        result = await handle.execute_update(
            ConsultationWorkflow.submit_message, args=[session_id, body.text]
        )
    except RPCError as exc:
        if exc.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Consultation is already approved/failed — no longer accepting messages",
            ) from exc
        raise
    return SubmitMessageResponse(**result)


@router.get("/{session_id}/stream", response_class=EventSourceResponse)
async def stream_consultation_turn(
    session_id: int,
    auth: AuthContext = Depends(get_auth_context),
    _owned: dict = Depends(_owned_session_dependency),
) -> AsyncIterable[ServerSentEvent]:
    """Live step indicator only (ADR 0008 decision 5) — POST /messages
    remains the sole source of truth for the actual reply; this carries no
    content, just which reflection step is currently running.

    The endpoint itself must be the async generator (`yield` directly) —
    FastAPI's own documented pattern for `response_class=EventSourceResponse`
    (verified against the actual docs, not assumed). A function that
    constructs and returns `EventSourceResponse(some_generator())` instead
    breaks with `TypeError: 'coroutine' object is not iterable` (found the
    hard way running this against the real stack). The ownership check runs
    as a `Depends(...)` (see `_owned_session_dependency`), not a manual
    `await` in the body, for the same reason — raising inside the generator
    itself doesn't produce a clean 404."""
    bind_consultation_context(
        consultation_session_id=session_id, session_id=auth.session_id, user_id=auth.user_id
    )

    channel = f"consultation:{session_id}:stream"
    pubsub = redis_client.pubsub()
    await pubsub.subscribe(channel)
    try:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            yield ServerSentEvent(data=json.loads(message["data"]), event="step")
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()


@router.post("/{session_id}/approve", response_model=ApproveResponse)
async def approve_consultation(
    session_id: int, request: Request, auth: AuthContext = Depends(get_auth_context)
):
    bind_consultation_context(
        consultation_session_id=session_id, session_id=auth.session_id, user_id=auth.user_id
    )
    await _get_owned_session(session_id, auth)

    client = request.app.state.temporal_client
    handle = client.get_workflow_handle(f"consultation-{session_id}")
    try:
        result = await handle.execute_update(ConsultationWorkflow.approve, args=[session_id])
    except RPCError as exc:
        if exc.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Consultation is already approved/failed",
            ) from exc
        raise
    except WorkflowUpdateFailedError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_root_cause_message(exc)
        ) from exc
    logger.info("consultation %d approved -> case %d, debate %d", session_id, result["case_id"], result["debate_id"])
    return ApproveResponse(**result)
