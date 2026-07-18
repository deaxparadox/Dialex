"""Plain Temporal Activities for the consultation workflow (ADR 0005,
spec 0009) — same shape as `debates/activities.py`. Every activity binds
`consultation_session_id` for log/span correlation itself, since an
Activity shares no memory with the Workflow that scheduled it."""

import logging

from temporalio import activity
from temporalio.exceptions import ApplicationError

from ..core.observability import bind_consultation_context
from . import queries

logger = logging.getLogger(__name__)


@activity.defn
async def fetch_consultation_context(session_id: int) -> dict:
    bind_consultation_context(consultation_session_id=session_id)
    session = await queries.get_session(session_id)
    consultant_persona = await queries.get_agent_persona(session["consultant_persona_id"])
    return {"session": session, "consultant_persona": consultant_persona}


@activity.defn
async def fetch_turns(session_id: int) -> list[dict]:
    bind_consultation_context(consultation_session_id=session_id)
    return await queries.get_turns(session_id)


@activity.defn
async def persist_turn(session_id: int, turn_number: int, speaker: str, content: str) -> int:
    bind_consultation_context(consultation_session_id=session_id)
    turn_id = await queries.insert_turn(session_id, turn_number, speaker, content)
    logger.info("persisted %s turn %d for session %d", speaker, turn_number, session_id)
    return turn_id


@activity.defn
async def create_case_and_debate(session_id: int, finalized_payload: dict) -> dict:
    """The approval activity (ADR 0005 decision 5) — fails loudly rather
    than silently creating a broken Debate if the case type has no
    configured participants."""
    bind_consultation_context(consultation_session_id=session_id)
    session = await queries.get_session(session_id)
    config = await queries.get_case_type_defaults(session["case_type"])
    if config is None:
        # non_retryable=True — a missing/misconfigured CaseTypeConfig won't
        # fix itself on retry; without this, Temporal's default retry
        # policy retries a permanent config error 3 times before giving up
        # (found during spec 0009 verification, same class of bug as the
        # LangGraph node's missing retry_policy — a permanent failure
        # dressed up as a transient one).
        raise ApplicationError(
            f"No CaseTypeConfig found for case_type={session['case_type']!r}", non_retryable=True
        )
    participant_ids = config["default_participant_persona_ids"]
    if not participant_ids:
        raise ApplicationError(
            f"CaseTypeConfig {session['case_type']!r} has no default_participant_personas "
            "configured — refusing to create a zero-participant Debate.",
            non_retryable=True,
        )

    outcome = await queries.create_case_and_debate(
        session_id=session_id,
        user_id=session["user_id"],
        case_type=session["case_type"],
        finalized_payload=finalized_payload,
        judge_persona_id=config["default_judge_persona_id"],
        max_rounds=config["default_max_rounds"],
        participant_persona_ids=participant_ids,
    )
    logger.info(
        "consultation %d approved -> case %d, debate %d",
        session_id, outcome["case_id"], outcome["debate_id"],
    )
    return outcome


@activity.defn
async def mark_consultation_failed(session_id: int) -> None:
    bind_consultation_context(consultation_session_id=session_id)
    await queries.mark_session_failed(session_id)
    logger.warning("consultation session %d marked FAILED — retries exhausted", session_id)


ALL_ACTIVITIES = [
    fetch_consultation_context,
    fetch_turns,
    persist_turn,
    create_case_and_debate,
    mark_consultation_failed,
]
