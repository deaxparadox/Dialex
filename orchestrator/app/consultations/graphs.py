"""LangGraph StateGraph for the consultant's per-turn reasoning (ADR 0005) —
same single-node shape as `debates/graphs.py`'s graphs, registered with
Temporal's LangGraph plugin so the node runs as a real Activity."""

import json
from datetime import timedelta
from typing import TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from temporalio.common import RetryPolicy

from ..core.observability import bind_consultation_context
from .schemas import ConsultantTurnOutput

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
    result: dict


async def _produce_turn(state: ConsultantTurnState) -> dict:
    bind_consultation_context(consultation_session_id=state["session_id"])

    transcript = "\n".join(f"{t['speaker']}: {t['content']}" for t in state["turns"])
    prompt = (
        f"Case type: {state['case_type']}\n\n"
        f"Conversation so far:\n{transcript}\n\n"
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
        "result": {
            "message": response.message,
            "ready_to_finalize": response.ready_to_finalize,
            "proposed_payload": proposed_payload,
        }
    }


def build_consultant_graph() -> StateGraph:
    g = StateGraph(ConsultantTurnState)
    g.add_node(
        "produce_turn",
        _produce_turn,
        metadata={
            "execute_in": "activity",
            "start_to_close_timeout": _NODE_TIMEOUT,
            "retry_policy": _NODE_RETRY,
        },
    )
    g.add_edge(START, "produce_turn")
    g.add_edge("produce_turn", END)
    return g
