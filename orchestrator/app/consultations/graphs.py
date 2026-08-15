"""LangGraph StateGraph for the consultant's per-turn reasoning (ADR 0005,
extended by ADR 0008 into a real multi-node reflection graph). Registered
with Temporal's LangGraph plugin so each node runs as a real Activity."""

import json
from datetime import timedelta
from typing import TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from temporalio.common import RetryPolicy

from ..core.observability import bind_consultation_context
from .activities import _publish
from .schemas import ConsultantCritique, ConsultantTurnOutput

CONSULTANT_GRAPH = "consultant-graph"

_NODE_TIMEOUT = timedelta(seconds=60)
# Without an explicit retry_policy, Temporal's activity default retries
# near-indefinitely with backoff — fine for a transient network blip, not
# for a genuinely non-retryable error (e.g. a malformed structured-output
# schema), which would otherwise hang every caller forever instead of
# surfacing. Found the hard way during spec 0009 verification: an invalid
# schema retried 30+ times before being caught, not the transient failure
# Temporal's default retry behavior assumes.
_NODE_RETRY = RetryPolicy(initial_interval=timedelta(seconds=1), maximum_attempts=3)


class ConsultantTurnState(TypedDict):
    session_id: int
    system_prompt: str
    model_name: str
    temperature: float
    case_type: str
    turns: list[dict]
    draft: dict
    critique: dict | None
    result: dict


def _transcript(turns: list[dict]) -> str:
    return "\n".join(f"{t['speaker']}: {t['content']}" for t in turns)


async def _draft(state: ConsultantTurnState) -> dict:
    bind_consultation_context(consultation_session_id=state["session_id"])
    await _publish(state["session_id"], {"step": "draft"})

    prompt = (
        f"Case type: {state['case_type']}\n\n"
        f"Conversation so far:\n{_transcript(state['turns'])}\n\n"
        "Continue the conversation: either ask your next clarifying question, or, if you "
        "now understand the case well enough, set ready_to_finalize=true and include a "
        "proposed_payload (a JSON object capturing the case for debate)."
    )
    llm = ChatOpenAI(model=state["model_name"], temperature=state["temperature"])
    response: ConsultantTurnOutput = await llm.with_structured_output(ConsultantTurnOutput).ainvoke(
        [SystemMessage(state["system_prompt"]), HumanMessage(prompt)]
    )
    proposed_payload = json.loads(response.proposed_payload_json) if response.proposed_payload_json else None
    return {
        "draft": {
            "message": response.message,
            "ready_to_finalize": response.ready_to_finalize,
            "proposed_payload": proposed_payload,
        }
    }


async def _critique(state: ConsultantTurnState) -> dict:
    """ADR 0008 decision 1: catches the shallow pattern-completion behavior
    that let a real session parrot back an evident typo three times without
    ever questioning it — checks the draft against the transcript before it
    ever reaches the user."""
    bind_consultation_context(consultation_session_id=state["session_id"])
    await _publish(state["session_id"], {"step": "critique"})

    prompt = (
        f"Conversation so far:\n{_transcript(state['turns'])}\n\n"
        f"Drafted reply: {state['draft']['message']}\n\n"
        "Does this reply actually address anything unclear, inconsistent, or possibly "
        "mistaken in the user's last message — or does it just accept it at face value "
        "and move on? Set needs_revision=true only if there's a real, specific concern; "
        "don't flag stylistic preferences."
    )
    llm = ChatOpenAI(model=state["model_name"], temperature=state["temperature"])
    critique: ConsultantCritique = await llm.with_structured_output(ConsultantCritique).ainvoke(
        [SystemMessage(state["system_prompt"]), HumanMessage(prompt)]
    )
    return {"critique": critique.model_dump()}


async def _route_after_critique(state: ConsultantTurnState) -> str:
    """Must be async, not a plain sync function (found the hard way): the
    graph's own node-to-node routing runs inside the Workflow's sandboxed
    context (only individual nodes are dispatched out as Activities), and
    LangChain's runnable-coercion falls back to a background thread executor
    for sync callables when invoked via `ainvoke()` — Temporal's workflow
    sandbox forbids spawning real OS threads (determinism requirement), so a
    sync routing function fails immediately with `NotImplementedError`."""
    return "revise" if state["critique"]["needs_revision"] else "end"


async def _revise(state: ConsultantTurnState) -> dict:
    bind_consultation_context(consultation_session_id=state["session_id"])
    await _publish(state["session_id"], {"step": "revise"})

    prompt = (
        f"Conversation so far:\n{_transcript(state['turns'])}\n\n"
        f"Your drafted reply: {state['draft']['message']}\n\n"
        f"A concern was raised: {state['critique']['concern']}\n\n"
        "Rewrite your reply to actually address this concern. Continue the conversation "
        "as before: either ask your next clarifying question, or, if you now understand "
        "the case well enough, set ready_to_finalize=true and include a proposed_payload."
    )
    llm = ChatOpenAI(model=state["model_name"], temperature=state["temperature"])
    response: ConsultantTurnOutput = await llm.with_structured_output(ConsultantTurnOutput).ainvoke(
        [SystemMessage(state["system_prompt"]), HumanMessage(prompt)]
    )
    proposed_payload = json.loads(response.proposed_payload_json) if response.proposed_payload_json else None
    return {
        "result": {
            "message": response.message,
            "ready_to_finalize": response.ready_to_finalize,
            "proposed_payload": proposed_payload,
        }
    }


def build_consultant_graph() -> StateGraph:
    g = StateGraph(ConsultantTurnState)
    node_opts = {
        "execute_in": "activity",
        "start_to_close_timeout": _NODE_TIMEOUT,
        "retry_policy": _NODE_RETRY,
    }
    g.add_node("draft", _draft, metadata=node_opts)
    g.add_node("critique", _critique, metadata=node_opts)
    g.add_node("revise", _revise, metadata=node_opts)
    g.add_edge(START, "draft")
    g.add_edge("draft", "critique")
    g.add_conditional_edges("critique", _route_after_critique, {"revise": "revise", "end": END})
    g.add_edge("revise", END)
    return g
