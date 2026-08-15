"""LangGraph StateGraphs — the per-turn reasoning layer (decision 3),
registered with Temporal's official plugin (ADR 0004) so each graph's node
runs as a real Activity. Deliberately single-node per graph this milestone
— multi-node reasoning (draft-then-critique, etc.) is a real future
enhancement, not needed to prove the two-layer integration works.

Each node binds `debate_id` for log/span correlation itself — a graph node
executes as its own Temporal Activity, with no shared memory with the
Workflow that invoked it (spec 0005)."""

import json
from datetime import timedelta
from typing import TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph

from ..core.observability import bind_debate_context
from .activities import _publish
from .schemas import ArgumentJudgment, ClosingJudgment

ARGUMENT_GRAPH = "argument-graph"
JUDGE_OPENING_GRAPH = "judge-opening-graph"
JUDGE_CLOSING_GRAPH = "judge-closing-graph"

# Temporal's LangGraphPlugin requires every "activity" node to declare its
# own timeout (found the hard way — it raises ValueError otherwise, not a
# guess): LLM calls get more headroom than the plain DB activities do.
_NODE_TIMEOUT = timedelta(seconds=60)


def _llm(model_name: str, temperature: float) -> ChatOpenAI:
    return ChatOpenAI(model=model_name, temperature=temperature)


class ArgumentState(TypedDict):
    debate_id: int
    agent_persona_id: int
    round_number: int
    system_prompt: str
    model_name: str
    temperature: float
    case_payload: dict
    position_options: list[str]
    prior_arguments: list[dict]
    own_last_position: str | None
    result: dict


async def _produce_argument(state: ArgumentState) -> dict:
    """Split per ADR 0007 decision 1: a plain-streamed call for `content`
    (published token-by-token, spec 0020) followed by a fast structured
    call for the judgment fields only (`position`/`confidence`/
    `responds_to_argument_id`) — those can only be judged from the
    complete text (ADR 0006), but the text itself never needed to be
    atomic. The judgment call is explicitly told not to rewrite the
    content, and its schema has no field for it, so what's persisted can
    never drift from what streamed."""
    bind_debate_context(debate_id=state["debate_id"])
    turn_meta = {
        "agent_persona_id": state["agent_persona_id"],
        "stage": "argument",
        "round_number": state["round_number"],
    }
    await _publish(state["debate_id"], {"type": "turn_token_reset", **turn_meta})

    options_note = (
        f"Your `position` must be exactly one of: {state['position_options']}."
        if state["position_options"]
        else "This case has no fixed position vocabulary — state your own candidate answer in `position`."
    )
    change_note = (
        f"Your position in the previous round was: {state['own_last_position']!r}. "
        "If your new position differs, you MUST set `responds_to_argument_id` to the specific "
        "prior argument (by id) that changed your mind — a vague or missing citation is not "
        "acceptable (decision 4)."
        if state["own_last_position"] is not None
        else "This is your first argument in this debate — `responds_to_argument_id` may be null."
    )
    prompt = (
        f"Case: {json.dumps(state['case_payload'])}\n\n"
        f"Prior arguments so far: {json.dumps(state['prior_arguments'])}\n\n"
        f"{options_note}\n{change_note}\n\n"
        "Produce your argument for this round as plain prose (2-4 sentences), in your own "
        "words. Do not output JSON and do not repeat the prior-arguments data verbatim — the "
        "structured-output call that used to constrain this response is gone (this call is "
        "plain text now, spec 0020), so write natural language explicitly, even if your "
        "position hasn't changed since last round."
    )

    llm = _llm(state["model_name"], state["temperature"])
    parts: list[str] = []
    async for chunk in llm.astream([SystemMessage(state["system_prompt"]), HumanMessage(prompt)]):
        if not chunk.content:
            continue
        parts.append(chunk.content)
        await _publish(state["debate_id"], {"type": "turn_token", "token": chunk.content, **turn_meta})
    content = "".join(parts)

    judgment_prompt = (
        f"Case: {json.dumps(state['case_payload'])}\n\n"
        f"Prior arguments so far: {json.dumps(state['prior_arguments'])}\n\n"
        f"{options_note}\n{change_note}\n\n"
        f"Your argument this round, already written:\n{content}\n\n"
        "Based on the argument above, give your position, confidence, and (if applicable) "
        "which prior argument changed your mind. Do not rewrite the argument."
    )
    judgment_llm = _llm(state["model_name"], state["temperature"]).with_structured_output(ArgumentJudgment)
    judgment: ArgumentJudgment = await judgment_llm.ainvoke(
        [SystemMessage(state["system_prompt"]), HumanMessage(judgment_prompt)]
    )
    return {"result": {"content": content, **judgment.model_dump()}}


def build_argument_graph() -> StateGraph:
    g = StateGraph(ArgumentState)
    g.add_node(
        "produce_argument",
        _produce_argument,
        metadata={"execute_in": "activity", "start_to_close_timeout": _NODE_TIMEOUT},
    )
    g.add_edge(START, "produce_argument")
    g.add_edge("produce_argument", END)
    return g


class JudgeOpeningState(TypedDict):
    debate_id: int
    agent_persona_id: int
    system_prompt: str
    model_name: str
    temperature: float
    case_payload: dict
    result: dict


async def _produce_opening(state: JudgeOpeningState) -> dict:
    """No split needed (ADR 0007 decision 1) — `JudgeOpeningOutput` was
    100% prose (`opening_statement` only, no judgment field), so this graph
    never needed structured output in the first place. Streams directly."""
    bind_debate_context(debate_id=state["debate_id"])
    turn_meta = {
        "agent_persona_id": state["agent_persona_id"],
        "stage": "opening_statement",
        "round_number": None,
    }
    await _publish(state["debate_id"], {"type": "turn_token_reset", **turn_meta})

    prompt = (
        f"Case: {json.dumps(state['case_payload'])}\n\n"
        "Give your opening statement as judge/moderator for this debate: frame what a "
        "resolved outcome would look like, without pre-judging any participant's position."
    )
    llm = _llm(state["model_name"], state["temperature"])
    parts: list[str] = []
    async for chunk in llm.astream([SystemMessage(state["system_prompt"]), HumanMessage(prompt)]):
        if not chunk.content:
            continue
        parts.append(chunk.content)
        await _publish(state["debate_id"], {"type": "turn_token", "token": chunk.content, **turn_meta})
    return {"result": {"opening_statement": "".join(parts)}}


def build_judge_opening_graph() -> StateGraph:
    g = StateGraph(JudgeOpeningState)
    g.add_node(
        "produce_opening",
        _produce_opening,
        metadata={"execute_in": "activity", "start_to_close_timeout": _NODE_TIMEOUT},
    )
    g.add_edge(START, "produce_opening")
    g.add_edge("produce_opening", END)
    return g


class JudgeClosingState(TypedDict):
    debate_id: int
    agent_persona_id: int
    system_prompt: str
    model_name: str
    temperature: float
    case_payload: dict
    all_arguments: list[dict]
    decision_options: list[str]
    result: dict


async def _produce_closing(state: JudgeClosingState) -> dict:
    """Split per ADR 0007 decision 1: only `reasoning` is actually rendered
    live to a user (debate-thread.html's verdict card) — `closing_summary`
    is persisted but never displayed today, so it rides in the judgment
    call along with `decision`/`confidence`/`cited_argument_ids` rather than
    needing to stream. Applying spec 0020's lesson up front this time: the
    prompt explicitly forbids JSON/verbatim-echoing from the first draft,
    not after finding the same degeneration bug again."""
    bind_debate_context(debate_id=state["debate_id"])
    turn_meta = {
        "agent_persona_id": state["agent_persona_id"],
        "stage": "verdict",
        "round_number": None,
    }
    await _publish(state["debate_id"], {"type": "turn_token_reset", **turn_meta})

    options_note = (
        f"Your `decision` must be exactly one of: {state['decision_options']}."
        if state["decision_options"]
        else "This case has no fixed decision vocabulary — state your own recommendation in `decision`."
    )
    prompt = (
        f"Case: {json.dumps(state['case_payload'])}\n\n"
        f"Full argument history: {json.dumps(state['all_arguments'])}\n\n"
        f"{options_note}\n\n"
        "Write your reasoning for the final verdict as plain prose (3-5 sentences), in your own "
        "words. Do not output JSON, and do not repeat the argument history verbatim."
    )
    llm = _llm(state["model_name"], state["temperature"])
    parts: list[str] = []
    async for chunk in llm.astream([SystemMessage(state["system_prompt"]), HumanMessage(prompt)]):
        if not chunk.content:
            continue
        parts.append(chunk.content)
        await _publish(state["debate_id"], {"type": "turn_token", "token": chunk.content, **turn_meta})
    reasoning = "".join(parts)

    judgment_prompt = (
        f"Case: {json.dumps(state['case_payload'])}\n\n"
        f"Full argument history: {json.dumps(state['all_arguments'])}\n\n"
        f"{options_note}\n\n"
        f"Your reasoning, already written:\n{reasoning}\n\n"
        "Based on the reasoning above, give your final decision, confidence, a short closing "
        "summary, and which argument ids you cited. `cited_argument_ids` must reference real "
        "ids from the history above (decision 8's forced-citation rule) — never bare narration. "
        "Do not rewrite the reasoning."
    )
    judgment_llm = _llm(state["model_name"], state["temperature"]).with_structured_output(ClosingJudgment)
    judgment: ClosingJudgment = await judgment_llm.ainvoke(
        [SystemMessage(state["system_prompt"]), HumanMessage(judgment_prompt)]
    )
    return {"result": {"reasoning": reasoning, **judgment.model_dump()}}


def build_judge_closing_graph() -> StateGraph:
    g = StateGraph(JudgeClosingState)
    g.add_node(
        "produce_closing",
        _produce_closing,
        metadata={"execute_in": "activity", "start_to_close_timeout": _NODE_TIMEOUT},
    )
    g.add_edge(START, "produce_closing")
    g.add_edge("produce_closing", END)
    return g
