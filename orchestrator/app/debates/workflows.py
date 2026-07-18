"""DebateWorkflow — the durable outer loop (decision 2), sequential turn
strategy only (ADR 0004's first-slice scope). LangGraph graphs are invoked
by name via Temporal's own plugin (`graph(name)`) — not by importing
graphs.py's builder functions here, which would pull langchain/langgraph/
openai imports into the workflow's deterministic-execution path for no
reason; only worker.py needs those, to build the graphs registered with
the plugin. The three name strings below must match graphs.py's."""

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.contrib.langgraph import graph

with workflow.unsafe.imports_passed_through():
    from . import activities

ARGUMENT_GRAPH = "argument-graph"
JUDGE_OPENING_GRAPH = "judge-opening-graph"
JUDGE_CLOSING_GRAPH = "judge-closing-graph"

_ACTIVITY_TIMEOUT = timedelta(seconds=30)
_ACTIVITY_RETRY = RetryPolicy(initial_interval=timedelta(seconds=1), maximum_attempts=3)


def _own_last_position(prior_arguments: list[dict], agent_persona_id: int, round_number: int) -> str | None:
    for arg in reversed(prior_arguments):
        if arg["agent_persona_id"] == agent_persona_id and arg["round_number"] == round_number - 1:
            return arg["position"]
    return None


@workflow.defn
class DebateWorkflow:
    @workflow.run
    async def run(self, debate_id: int) -> dict:
        try:
            return await self._run(debate_id)
        except Exception:
            await workflow.execute_activity(
                activities.mark_failed, debate_id, start_to_close_timeout=_ACTIVITY_TIMEOUT
            )
            raise

    async def _run(self, debate_id: int) -> dict:
        context = await workflow.execute_activity(
            activities.fetch_debate_context,
            debate_id,
            start_to_close_timeout=_ACTIVITY_TIMEOUT,
            retry_policy=_ACTIVITY_RETRY,
        )
        debate = context["debate"]
        case = context["case"]
        case_type_config = context["case_type_config"]
        participants = context["participants"]
        judge = context["judge"]

        await workflow.execute_activity(
            activities.set_debate_status,
            args=[debate_id, "ARGUING"],
            start_to_close_timeout=_ACTIVITY_TIMEOUT,
            retry_policy=_ACTIVITY_RETRY,
        )

        if not debate.get("opening_statement"):
            judge_model_config = judge.get("model_config") or {}
            opening_state = {
                "debate_id": debate_id,
                "system_prompt": judge["system_prompt"],
                "model_name": judge_model_config.get("model", "gpt-4o-mini"),
                "temperature": judge_model_config.get("temperature", 0.7),
                "case_payload": case["payload"],
                "result": {},
            }
            opening_result = await graph(JUDGE_OPENING_GRAPH).compile().ainvoke(opening_state)
            await workflow.execute_activity(
                activities.persist_opening_statement,
                args=[debate_id, opening_result["result"]["opening_statement"]],
                start_to_close_timeout=_ACTIVITY_TIMEOUT,
                retry_policy=_ACTIVITY_RETRY,
            )

        max_rounds = debate["max_rounds"]
        round_number = debate["current_round"]
        converged = False

        while round_number < max_rounds:
            # Fetched once per round, before any participant's turn — this
            # milestone's sequential strategy means each persona argues once
            # per round without seeing this round's peers yet (they become
            # visible next round), a deliberate simplification for the
            # first slice, not an oversight.
            prior_arguments = await workflow.execute_activity(
                activities.fetch_arguments,
                args=[debate_id, round_number - 1],
                start_to_close_timeout=_ACTIVITY_TIMEOUT,
                retry_policy=_ACTIVITY_RETRY,
            )

            for participant in participants:
                model_config = participant["persona_snapshot"].get("model_config") or {}
                arg_state = {
                    "debate_id": debate_id,
                    "system_prompt": participant["persona_snapshot"]["system_prompt"],
                    "model_name": model_config.get("model", "gpt-4o-mini"),
                    "temperature": model_config.get("temperature", 0.7),
                    "case_payload": case["payload"],
                    "position_options": case_type_config.get("position_options") or [],
                    "prior_arguments": prior_arguments,
                    "own_last_position": _own_last_position(
                        prior_arguments, participant["agent_persona_id"], round_number
                    ),
                    "result": {},
                }
                arg_result = await graph(ARGUMENT_GRAPH).compile().ainvoke(arg_state)
                await workflow.execute_activity(
                    activities.persist_argument,
                    args=[
                        debate_id,
                        participant["agent_persona_id"],
                        round_number,
                        arg_result["result"],
                    ],
                    start_to_close_timeout=_ACTIVITY_TIMEOUT,
                    retry_policy=_ACTIVITY_RETRY,
                )

            check = await workflow.execute_activity(
                activities.check_convergence,
                args=[debate_id, round_number],
                start_to_close_timeout=_ACTIVITY_TIMEOUT,
                retry_policy=_ACTIVITY_RETRY,
            )
            round_number += 1
            await workflow.execute_activity(
                activities.set_debate_round,
                args=[debate_id, round_number],
                start_to_close_timeout=_ACTIVITY_TIMEOUT,
                retry_policy=_ACTIVITY_RETRY,
            )
            if check["result"]:
                converged = True
                break

        await workflow.execute_activity(
            activities.set_debate_status,
            args=[debate_id, "CONVERGING"],
            start_to_close_timeout=_ACTIVITY_TIMEOUT,
            retry_policy=_ACTIVITY_RETRY,
        )

        all_arguments = await workflow.execute_activity(
            activities.fetch_arguments,
            args=[debate_id, None],
            start_to_close_timeout=_ACTIVITY_TIMEOUT,
            retry_policy=_ACTIVITY_RETRY,
        )
        judge_model_config = judge.get("model_config") or {}
        closing_state = {
            "debate_id": debate_id,
            "system_prompt": judge["system_prompt"],
            "model_name": judge_model_config.get("model", "gpt-4o-mini"),
            "temperature": judge_model_config.get("temperature", 0.7),
            "case_payload": case["payload"],
            "all_arguments": all_arguments,
            "decision_options": case_type_config.get("decision_options") or [],
            "result": {},
        }
        closing_result = await graph(JUDGE_CLOSING_GRAPH).compile().ainvoke(closing_state)

        # Judge always produces a Verdict, even on NO_CONSENSUS (decision 8)
        # — there's no separate "give up without a verdict" path.
        final_status = "JUDGED" if converged else "NO_CONSENSUS"
        await workflow.execute_activity(
            activities.persist_verdict_and_close,
            args=[debate_id, final_status, closing_result["result"]],
            start_to_close_timeout=_ACTIVITY_TIMEOUT,
            retry_policy=_ACTIVITY_RETRY,
        )
        return {"status": final_status}
