"""`ConsultationWorkflow` — the first long-running, externally-signaled
workflow in this codebase (ADR 0005). Unlike `DebateWorkflow` (fire-and-
forget, runs unattended start to finish), this one parks on
`workflow.wait_condition` between turns, since it's a live dialogue where a
human decides when to reply. Turns are delivered via `@workflow.update`
handlers, not signal+poll — see ADR 0005 decision 2 for why.

`CONSULTANT_GRAPH`'s name string is redeclared here rather than imported
from `graphs.py` — importing that module would pull langchain/langgraph/
openai into the workflow's deterministic-execution path for no reason, the
same reasoning `debates/workflows.py` already follows. Only `worker.py`
needs the actual graph-builder function."""

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.contrib.langgraph import graph
from temporalio.exceptions import ApplicationError

with workflow.unsafe.imports_passed_through():
    from . import activities

CONSULTANT_GRAPH = "consultant-graph"

_ACTIVITY_TIMEOUT = timedelta(seconds=30)
_ACTIVITY_RETRY = RetryPolicy(initial_interval=timedelta(seconds=1), maximum_attempts=3)


@workflow.defn
class ConsultationWorkflow:
    def __init__(self) -> None:
        self._status = "OPEN"
        self._turn_count = 0
        self._last_proposed_payload: dict | None = None
        self._result: dict | None = None

    @workflow.run
    async def run(self, session_id: int) -> dict:
        try:
            # Parked here for the session's entire interactive lifetime —
            # a workflow only accepts Updates while still open, so
            # returning early would mean `submit_message`/`approve` simply
            # can't reach it (ADR 0005 decision 2).
            await workflow.wait_condition(lambda: self._status in ("APPROVED", "FAILED"))
            return self._result or {"status": self._status}
        except Exception:
            await workflow.execute_activity(
                activities.mark_consultation_failed, session_id, start_to_close_timeout=_ACTIVITY_TIMEOUT
            )
            raise

    @workflow.update
    async def submit_message(self, session_id: int, text: str) -> dict:
        self._turn_count += 1
        await workflow.execute_activity(
            activities.persist_turn,
            args=[session_id, self._turn_count, "user", text],
            start_to_close_timeout=_ACTIVITY_TIMEOUT,
            retry_policy=_ACTIVITY_RETRY,
        )

        context = await workflow.execute_activity(
            activities.fetch_consultation_context,
            session_id,
            start_to_close_timeout=_ACTIVITY_TIMEOUT,
            retry_policy=_ACTIVITY_RETRY,
        )
        turns = await workflow.execute_activity(
            activities.fetch_turns,
            session_id,
            start_to_close_timeout=_ACTIVITY_TIMEOUT,
            retry_policy=_ACTIVITY_RETRY,
        )

        persona = context["consultant_persona"]
        model_config = persona.get("model_config") or {}
        state = {
            "session_id": session_id,
            "system_prompt": persona["system_prompt"],
            "model_name": model_config.get("model", "gpt-4o-mini"),
            "temperature": model_config.get("temperature", 0.7),
            "case_type": context["session"]["case_type"],
            "turns": turns,
            "result": {},
        }
        turn_result = await graph(CONSULTANT_GRAPH).compile().ainvoke(state)
        result = turn_result["result"]

        self._turn_count += 1
        await workflow.execute_activity(
            activities.persist_turn,
            args=[session_id, self._turn_count, "consultant", result["message"]],
            start_to_close_timeout=_ACTIVITY_TIMEOUT,
            retry_policy=_ACTIVITY_RETRY,
        )
        self._last_proposed_payload = result.get("proposed_payload")
        return {"message": result["message"], "ready_to_finalize": result["ready_to_finalize"]}

    @workflow.update
    async def approve(self, session_id: int) -> dict:
        if self._last_proposed_payload is None:
            raise ApplicationError(
                "Not ready to approve — the consultant hasn't proposed a payload yet."
            )
        outcome = await workflow.execute_activity(
            activities.create_case_and_debate,
            args=[session_id, self._last_proposed_payload],
            start_to_close_timeout=_ACTIVITY_TIMEOUT,
            retry_policy=_ACTIVITY_RETRY,
        )
        self._status = "APPROVED"
        self._result = outcome
        return outcome
