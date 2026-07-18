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
from .schemas import ArgumentOutput, JudgeClosingOutput, JudgeOpeningOutput

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
    system_prompt: str
    model_name: str
    temperature: float
    case_payload: dict
    position_options: list[str]
    prior_arguments: list[dict]
    own_last_position: str | None
    result: dict


async def _produce_argument(state: ArgumentState) -> dict:
    bind_debate_context(debate_id=state["debate_id"])

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
        "Produce your argument for this round."
    )

    llm = _llm(state["model_name"], state["temperature"]).with_structured_output(ArgumentOutput)
    response: ArgumentOutput = await llm.ainvoke(
        [SystemMessage(state["system_prompt"]), HumanMessage(prompt)]
    )
    return {"result": response.model_dump()}


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
    system_prompt: str
    model_name: str
    temperature: float
    case_payload: dict
    result: dict


async def _produce_opening(state: JudgeOpeningState) -> dict:
    bind_debate_context(debate_id=state["debate_id"])
    prompt = (
        f"Case: {json.dumps(state['case_payload'])}\n\n"
        "Give your opening statement as judge/moderator for this debate: frame what a "
        "resolved outcome would look like, without pre-judging any participant's position."
    )
    llm = _llm(state["model_name"], state["temperature"]).with_structured_output(JudgeOpeningOutput)
    response: JudgeOpeningOutput = await llm.ainvoke(
        [SystemMessage(state["system_prompt"]), HumanMessage(prompt)]
    )
    return {"result": response.model_dump()}


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
    system_prompt: str
    model_name: str
    temperature: float
    case_payload: dict
    all_arguments: list[dict]
    decision_options: list[str]
    result: dict


async def _produce_closing(state: JudgeClosingState) -> dict:
    bind_debate_context(debate_id=state["debate_id"])
    options_note = (
        f"Your `decision` must be exactly one of: {state['decision_options']}."
        if state["decision_options"]
        else "This case has no fixed decision vocabulary — state your own recommendation in `decision`."
    )
    prompt = (
        f"Case: {json.dumps(state['case_payload'])}\n\n"
        f"Full argument history: {json.dumps(state['all_arguments'])}\n\n"
        f"{options_note}\n\n"
        "Produce your final verdict. `cited_arguments` must reference specific argument ids "
        "from the history above (decision 8's forced-citation rule) — never bare narration."
    )
    llm = _llm(state["model_name"], state["temperature"]).with_structured_output(JudgeClosingOutput)
    response: JudgeClosingOutput = await llm.ainvoke(
        [SystemMessage(state["system_prompt"]), HumanMessage(prompt)]
    )
    return {"result": response.model_dump()}


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
