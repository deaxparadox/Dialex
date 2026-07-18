"""Consultation endpoints (ADR 0005, spec 0009). Every endpoint checks
ownership before touching Temporal — never fetch-then-check-after, the same
IDOR shape already caught once in spec 0005."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from temporalio.client import WorkflowUpdateFailedError
from temporalio.exceptions import ApplicationError
from temporalio.service import RPCError, RPCStatusCode

from ..core.observability import bind_consultation_context
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
