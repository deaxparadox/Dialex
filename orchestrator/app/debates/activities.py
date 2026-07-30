"""Plain Temporal Activities — DB reads/writes and the convergence-signal
computation (decision 6). Kept separate from graphs.py's LangGraph nodes
(which are also real Activities, dispatched by the Temporal LangGraph
plugin, ADR 0004) since these do no LLM calls.

Every activity binds `debate_id` for log/span correlation itself — an
Activity shares no memory with the Workflow that scheduled it, so nothing
propagates this implicitly (spec 0005)."""

import json
import logging

from temporalio import activity

from ..core.observability import bind_debate_context
from ..core.redis_client import redis_client
from . import queries

logger = logging.getLogger(__name__)


async def _publish(debate_id: int, event: dict) -> None:
    """Complete-event push (ADR 0006 Decision 1 — not token-by-token; the
    atomic response is a real constraint of needing structured judgments
    from a complete argument, verified empirically, not an implementation
    shortcut). Best-effort and explicitly non-fatal: the DB write this
    always runs after is the durable record (decision 12) — a Redis hiccup
    should cost a connected viewer one missed live update, never fail the
    Activity (and therefore never fail the whole debate) over a live-view
    concern."""
    try:
        await redis_client.publish(f"debate:{debate_id}:stream", json.dumps(event))
    except Exception:
        logger.warning("failed to publish stream event %s for debate %d", event.get("type"), debate_id, exc_info=True)


@activity.defn
async def fetch_debate_context(debate_id: int) -> dict:
    bind_debate_context(debate_id=debate_id)
    debate = await queries.get_debate(debate_id)
    case = await queries.get_case(debate["case_id"])
    case_type_config = await queries.get_case_type_config(case["type"]) or {
        "position_options": [],
        "decision_options": [],
    }
    participants = await queries.get_participants(debate_id)
    judge = await queries.get_judge_persona(debate["judge_persona_id"])
    logger.info("fetched debate context: %d participant(s)", len(participants))
    return {
        "debate": debate,
        "case": case,
        "case_type_config": case_type_config,
        "participants": participants,
        "judge": judge,
    }


@activity.defn
async def fetch_arguments(debate_id: int, up_to_round: int | None) -> list[dict]:
    bind_debate_context(debate_id=debate_id)
    return await queries.get_arguments(debate_id, up_to_round=up_to_round)


@activity.defn
async def persist_argument(
    debate_id: int, agent_persona_id: int, round_number: int, result: dict
) -> int:
    bind_debate_context(debate_id=debate_id)
    argument_id = await queries.insert_argument(
        debate_id=debate_id,
        agent_persona_id=agent_persona_id,
        round_number=round_number,
        content=result["content"],
        position=result["position"],
        confidence=result["confidence"],
        responds_to_id=result.get("responds_to_argument_id"),
    )
    logger.info("persisted argument %d (round %d, persona %d)", argument_id, round_number, agent_persona_id)
    await _publish(debate_id, {"type": "argument_complete", "argument_id": argument_id})
    return argument_id


@activity.defn
async def publish_turn_started(
    debate_id: int, agent_persona_id: int, agent_name: str, stage: str, round_number: int | None
) -> None:
    """Live "who's generating right now" signal (spec 0018) — distinct from
    decision 12's token-by-token ask, which ADR 0006 verified isn't possible
    with the current structured-output LLM call shape. This doesn't carry
    any content, just identifies which turn's LLM call has *started*, so the
    frontend can show a "thinking" indicator instead of silence until the
    corresponding complete event lands. `agent_name` rides in the event
    itself (not just an id) so the frontend can render immediately, even for
    the very first turn of a debate, before any Argument data exists to look
    a name up from."""
    bind_debate_context(debate_id=debate_id)
    await _publish(debate_id, {
        "type": "turn_started",
        "agent_persona_id": agent_persona_id,
        "agent_name": agent_name,
        "stage": stage,
        "round_number": round_number,
    })


@activity.defn
async def check_convergence(debate_id: int, round_number: int) -> dict:
    """Decision 6's structured signals: position stability, confidence-
    spread shrinkage, no new rebuttals, and uncited position changes
    (decision 4's dissent-preserving signal). Needs at least two rounds run
    before convergence can even be considered — round 0 has nothing to
    compare against yet."""
    bind_debate_context(debate_id=debate_id)
    all_args = await queries.get_arguments(debate_id, up_to_round=round_number)
    current_round_args = [a for a in all_args if a["round_number"] == round_number]
    previous_round_args = [a for a in all_args if a["round_number"] == round_number - 1]

    no_new_rebuttals = not any(a["responds_to_id"] for a in current_round_args)

    if round_number < 1 or not previous_round_args:
        signals = {
            "position_stable": False,
            "confidence_spread": None,
            "confidence_spread_shrank": False,
            "no_new_rebuttals": no_new_rebuttals,
            "uncited_changes": 0,
        }
        check_id = await queries.insert_convergence_check(debate_id, round_number, signals, False, 0.0)
        logger.info("convergence check %d: round %d too early to converge", check_id, round_number)
        return {"result": False, "score": 0.0, "signals": signals}

    prev_by_persona = {a["agent_persona_id"]: a for a in previous_round_args}
    stable = True
    uncited_changes = 0
    for arg in current_round_args:
        prev = prev_by_persona.get(arg["agent_persona_id"])
        if prev is None or arg["position"] == prev["position"]:
            continue
        stable = False
        if not arg["responds_to_id"]:
            uncited_changes += 1

    confidences = [a["confidence"] for a in current_round_args if a["confidence"] is not None]
    prev_confidences = [a["confidence"] for a in previous_round_args if a["confidence"] is not None]
    spread = (max(confidences) - min(confidences)) if confidences else None
    prev_spread = (max(prev_confidences) - min(prev_confidences)) if prev_confidences else None
    spread_shrank = spread is not None and prev_spread is not None and spread < prev_spread

    sub_signals = [
        1.0 if stable else 0.0,
        1.0 if spread_shrank else 0.0,
        1.0 if no_new_rebuttals else 0.0,
        1.0 if uncited_changes == 0 else 0.0,
    ]
    score = sum(sub_signals) / len(sub_signals)
    result = score >= 0.75

    signals = {
        "position_stable": stable,
        "confidence_spread": spread,
        "confidence_spread_shrank": spread_shrank,
        "no_new_rebuttals": no_new_rebuttals,
        "uncited_changes": uncited_changes,
    }
    check_id = await queries.insert_convergence_check(debate_id, round_number, signals, result, score)
    logger.info("convergence check %d: round %d score=%.2f result=%s", check_id, round_number, score, result)
    return {"result": result, "score": score, "signals": signals}


@activity.defn
async def set_debate_status(debate_id: int, status: str) -> None:
    bind_debate_context(debate_id=debate_id)
    await queries.set_debate_status(debate_id, status)
    logger.info("debate status -> %s", status)
    await _publish(debate_id, {"type": "status_change", "status": status})


@activity.defn
async def set_debate_round(debate_id: int, round_number: int) -> None:
    bind_debate_context(debate_id=debate_id)
    await queries.set_debate_round(debate_id, round_number)


@activity.defn
async def persist_opening_statement(debate_id: int, opening_statement: str) -> None:
    bind_debate_context(debate_id=debate_id)
    await queries.set_debate_opening_statement(debate_id, opening_statement)
    logger.info("opening statement persisted")
    # Found during spec 0019 verification: without this, the frontend only
    # learned the opening statement was ready via whatever WS event happened
    # to arrive next — which, once turn_started (spec 0018) existed, was the
    # first participant's turn_started, and that one deliberately doesn't
    # trigger a re-fetch. Result: the opening-statement slot went blank for
    # ~2s between the two. This is the actual missing signal.
    await _publish(debate_id, {"type": "opening_statement_complete"})


@activity.defn
async def persist_verdict_and_close(debate_id: int, final_status: str, closing: dict) -> None:
    """Judge always produces a Verdict, even on NO_CONSENSUS (decision 8) —
    there's no separate 'give up without a verdict' path."""
    bind_debate_context(debate_id=debate_id)
    await queries.insert_verdict(
        debate_id=debate_id,
        decision=closing["decision"],
        confidence=closing["confidence"],
        reasoning=closing["reasoning"],
        cited_argument_ids=closing["cited_argument_ids"],
    )
    await queries.close_debate(debate_id, final_status, closing["closing_summary"])
    logger.info("debate closed: status=%s decision=%s", final_status, closing["decision"])
    await _publish(debate_id, {"type": "status_change", "status": final_status})


@activity.defn
async def mark_failed(debate_id: int) -> None:
    bind_debate_context(debate_id=debate_id)
    await queries.set_debate_status(debate_id, "FAILED")
    logger.warning("debate marked FAILED — retries exhausted")
    await _publish(debate_id, {"type": "status_change", "status": "FAILED"})


ALL_ACTIVITIES = [
    fetch_debate_context,
    fetch_arguments,
    persist_argument,
    publish_turn_started,
    check_convergence,
    set_debate_status,
    set_debate_round,
    persist_opening_statement,
    persist_verdict_and_close,
    mark_failed,
]
