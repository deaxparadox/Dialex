# Spec 0009 — `ConsultationWorkflow`: backend for the consultant/case-submission stage

> Governed by [ADR 0005 — Consultation workflow: interactive Temporal workflow via Updates](../adr/0005-consultation-workflow.md). Implements decision 10 from [references/002-design-review-findings.md](../../references/002-design-review-findings.md). **Backend only** — the frontend chat UI is a separate follow-up spec, same split as 0005→0006.

## What's being built

A real user can now: start a consultation for a `case_type`, exchange messages with an AI consultant persona, and — once the consultant proposes a payload it's confident in — approve it, which creates a real `Case` + `Debate` (+ `DebateParticipant` rows) automatically, no admin involved. Verified via curl/Temporal against the real running stack, same as spec 0005 was before any frontend touched it.

## 1. Migration — `cases` app: `CaseTypeConfig` gains default persona/round config

Per ADR 0005 decision 5:
```python
class CaseTypeConfig(models.Model):
    ...
    default_consultant_persona = models.ForeignKey(
        "debates.AgentPersona", on_delete=models.PROTECT,
        related_name="+", limit_choices_to={"role": "consultant"},
    )  # required — every case type must have one (decision 10: consultant runs for every case)
    default_participant_personas = models.ManyToManyField(
        "debates.AgentPersona", related_name="+", limit_choices_to={"role": "participant"},
    )
    default_judge_persona = models.ForeignKey(
        "debates.AgentPersona", on_delete=models.PROTECT,
        related_name="+", limit_choices_to={"role": "judge"},
    )  # required
    default_max_rounds = models.PositiveIntegerField(default=3)
```
`default_consultant_persona`/`default_judge_persona` have no `null=True` — a `CaseTypeConfig` missing either simply can't be saved (fail-fast per CLAUDE.md, not a silent fallback at usage time). `default_participant_personas` can't express "non-empty" at the DB level — enforced explicitly in the approval Activity instead (§5). Register all three on `CaseTypeConfigAdmin` (`filter_horizontal` for the M2M).

## 2. Migration — `consultations` app: `ConsultationSession.Status` gains `FAILED`

```python
class Status(models.TextChoices):
    OPEN = "OPEN", "Open"
    AWAITING_APPROVAL = "AWAITING_APPROVAL", "Awaiting approval"
    APPROVED = "APPROVED", "Approved"
    FAILED = "FAILED", "Failed"
```
Gives `ConsultationWorkflow`'s top-level exception handler somewhere real to put a session that hit an unrecoverable error (mirrors `DebateWorkflow`'s `mark_failed`), instead of leaving it silently stuck `OPEN`.

## 3. New orchestrator structure

```
orchestrator/app/consultations/
  graphs.py       — single-node LangGraph StateGraph: consultant_graph
  activities.py    — fetch_consultation_context, fetch_turns, persist_turn, create_case_and_debate, mark_failed
  workflows.py     — ConsultationWorkflow
  router.py        — POST /api/consultations/, /{id}/messages, /{id}/approve
  schemas.py        — Pydantic models
  queries.py        — SQLAlchemy Core helpers (reads/writes against generated_tables.py)
```
`worker.py` gets `ConsultationWorkflow` added to `workflows=[...]`, its activities appended to the activities list passed to `Worker(...)`, and `CONSULTANT_GRAPH: build_consultant_graph()` added to the `LangGraphPlugin`'s `graphs={...}` dict. `main.py` gets `app.include_router(consultations_router)`.

## 4. `consultant_graph` — single node, structured output

```python
class ConsultantTurnState(TypedDict):
    session_id: int
    system_prompt: str
    model_name: str
    temperature: float
    case_type: str
    turns: list[dict]   # full transcript so far, oldest first, including the just-added user turn
    result: dict

class ConsultantTurnOutput(BaseModel):
    message: str                        # shown to the user as the consultant's reply
    ready_to_finalize: bool             # self-determined depth (decision 10) — no requires_consultant flag anywhere
    proposed_payload: dict | None = None  # populated only when ready_to_finalize is True
```
Node builds a prompt from `case_type` + the formatted transcript, calls `ChatOpenAI(...).with_structured_output(ConsultantTurnOutput).ainvoke(...)`, returns `{"result": response.model_dump()}`. Same `metadata={"execute_in": "activity", "start_to_close_timeout": _NODE_TIMEOUT}` shape as the debate graphs — one Activity call per turn, not per token (streaming explicitly deferred, ADR 0005 decision 3).

## 5. Activities (`activities.py`)

- `fetch_consultation_context(session_id)` — session row (`user_id`, `case_type`, `status`), consultant persona's `system_prompt`/`model_config`. 404-worthy (returns `None`)-checked in the workflow, not the activity.
- `fetch_turns(session_id)` — ordered `ConsultationTurn` rows as dicts (mirrors `fetch_arguments`'s shape for a different table).
- `persist_turn(session_id, turn_number, speaker, content)` — one `ConsultationTurn` insert.
- `create_case_and_debate(session_id, finalized_payload)` — the approval activity:
  1. Re-fetch `CaseTypeConfig` for the session's `case_type`.
  2. **Fail loudly, don't silently create a broken `Debate`**, if `default_participant_personas` is empty — raise, which the workflow surfaces as a clean error back through `approve`'s Update call.
  3. Insert `Case` (`type`, `payload=finalized_payload`, `created_by=session.user_id`, `consultation_session=session_id`).
  4. Insert `Debate` (`case=new_case.id`, `turn_strategy="sequential"` — hardcoded, the only strategy `DebateWorkflow` implements, ADR 0004 — `status=OPEN`, `max_rounds=CaseTypeConfig.default_max_rounds`, `judge_persona=CaseTypeConfig.default_judge_persona`).
  5. Insert one `DebateParticipant` per `default_participant_personas`, `persona_snapshot` frozen from each `AgentPersona`'s current `system_prompt`/`model_config` (same freezing decision 7 already uses for admin-seeded debates).
  6. Update `ConsultationSession`: `status=APPROVED`, `finalized_payload`, `approved_at=now`.
  7. Return `{"case_id": ..., "debate_id": ...}`.
- `mark_failed(session_id)` — `ConsultationSession.status=FAILED`.

## 6. `ConsultationWorkflow`

```python
@workflow.defn
class ConsultationWorkflow:
    def __init__(self):
        self._status = "OPEN"
        self._turn_count = 0
        self._result: dict | None = None

    @workflow.run
    async def run(self, session_id: int) -> dict:
        try:
            await workflow.wait_condition(lambda: self._status in ("APPROVED", "FAILED"))
            return self._result or {"status": self._status}
        except Exception:
            await workflow.execute_activity(activities.mark_failed, session_id, start_to_close_timeout=_ACTIVITY_TIMEOUT)
            raise

    @workflow.update
    async def submit_message(self, session_id: int, text: str) -> dict:
        self._turn_count += 1
        await workflow.execute_activity(activities.persist_turn, args=[session_id, self._turn_count, "user", text], ...)
        context = await workflow.execute_activity(activities.fetch_consultation_context, session_id, ...)
        turns = await workflow.execute_activity(activities.fetch_turns, session_id, ...)
        state = {..., "turns": turns}
        result = await graph(CONSULTANT_GRAPH).compile().ainvoke(state)
        self._turn_count += 1
        await workflow.execute_activity(activities.persist_turn, args=[session_id, self._turn_count, "consultant", result["result"]["message"]], ...)
        self._last_proposed_payload = result["result"].get("proposed_payload")
        return {"message": result["result"]["message"], "ready_to_finalize": result["result"]["ready_to_finalize"]}

    @workflow.update
    async def approve(self, session_id: int) -> dict:
        if self._last_proposed_payload is None:
            raise ApplicationError("Not ready to approve — no proposed payload yet.")
        outcome = await workflow.execute_activity(
            activities.create_case_and_debate, args=[session_id, self._last_proposed_payload], ...
        )
        self._status = "APPROVED"
        self._result = outcome
        return outcome
```
(Illustrative shape — exact Activity timeout/retry-policy constants mirror `DebateWorkflow`'s `_ACTIVITY_TIMEOUT`/`_ACTIVITY_RETRY`, defined once in this module.) `workflow.wait_condition` is what keeps the workflow open for `submit_message`/`approve` to reach it at all; the moment `approve` sets a terminal `_status`, `run()` unblocks and the workflow completes — which is also what makes "approval is final" structural rather than a guard clause (ADR 0005 decision 2). A `submit_message` call arriving after completion fails at the Temporal-client layer in the router (§7), not inside the workflow.

## 7. Router (`orchestrator/app/consultations/router.py`)

All three endpoints auth-protected (`get_auth_context`, matching the existing pattern), all check ownership before touching Temporal (never fetch-then-check-after — the same IDOR shape already caught once in spec 0005):

- `POST /api/consultations/` — body `{case_type: str}`. Looks up `CaseTypeConfig` (404 if unknown), inserts a `ConsultationSession` row directly (`user_id=auth.user_id`, `case_type`, `consultant_persona=CaseTypeConfig.default_consultant_persona_id`, `status=OPEN`) via `queries.py`, then `client.start_workflow(ConsultationWorkflow.run, session_id, id=f"consultation-{session_id}", task_queue=TASK_QUEUE)` (fire-and-forget — the row already exists, matching how a `Debate` row exists before `DebateWorkflow` is started). Returns `{"session_id": ...}`.
- `POST /api/consultations/{id}/messages` — body `{text: str}`. Fetches the session's `user_id` via `queries.py`; 404 if it doesn't exist or doesn't belong to the caller. `handle.execute_update(ConsultationWorkflow.submit_message, args=[id, text])`. Catches the Temporal error raised when the workflow has already completed (approved/failed) and returns a clean `409`, not a raw exception.
- `POST /api/consultations/{id}/approve` — same ownership check, `handle.execute_update(ConsultationWorkflow.approve, args=[id])`. Catches the "not ready" `ApplicationError` from §6 and returns `400`; catches an already-completed workflow the same way as `/messages` and returns `409`.

## Explicitly out of scope

The frontend chat UI (separate follow-up spec). Redis/WebSocket streaming for consultation turns (deferred, ADR 0005 decision 3 — SSE flagged as the likely later direction, not decided now). Cancelling/abandoning a consultation (no `ABANDONED` status, no endpoint — real future scope, not built speculatively). Editing a `proposed_payload` before approving (approval uses the latest one verbatim). A `GET` endpoint to re-fetch a session's transcript (not needed by any curl-based verification path here — the frontend follow-up spec will decide whether a reload needs to recover an in-progress session).

## Verification plan

- Django admin: extend an existing `CaseTypeConfig` (or create a new one) with `default_consultant_persona`, 2+ `default_participant_personas`, `default_judge_persona`, leave `default_max_rounds` at its default.
- `POST /api/consultations/` with a valid access token and that `case_type` → `200`, a `session_id` back; confirm a `ConsultationSession` row exists (`status=OPEN`) and the workflow shows up polling/running in the Temporal Web UI.
- `POST /api/consultations/{id}/messages` with an opening message → confirm a synchronous reply comes back in the response (no polling); confirm two new `ConsultationTurn` rows exist (`user` then `consultant`, `turn_number` 1 and 2).
- Send a follow-up message referencing something from the first exchange → confirm the consultant's reply reflects it (proves `turns` history is actually being reconstructed and passed in, not just the latest message).
- Continue until `ready_to_finalize: true` comes back with a `proposed_payload`.
- `POST /api/consultations/{id}/approve` → confirm the response has `case_id`/`debate_id`; confirm in Django admin: `Case` row (`type`, `payload` matching the proposed payload, `created_by`, `consultation_session` linked back), `Debate` row (`turn_strategy=sequential`, `status=OPEN`, `max_rounds` matching config, `judge_persona` matching config), one `DebateParticipant` per configured participant persona with a frozen `persona_snapshot`; `ConsultationSession.status=APPROVED`, `finalized_payload` set.
- `POST /api/consultations/{id}/messages` again on the now-approved session → confirm a clean `409`, not a raw exception.
- `POST /api/consultations/{new-session}/approve` before any `ready_to_finalize` reply → confirm a clean `400`, not a silently-created broken `Case`.
- As a *different* authenticated user, call `/messages` and `/approve` on the first user's session → confirm `404` on both (IDOR check, matching the pattern already caught once in spec 0005).
- Temporarily set a `CaseTypeConfig.default_participant_personas` to empty, approve a session against it → confirm the approval call fails cleanly (not a `Debate` with zero participants silently created).
- **Integration check**: take the `debate_id` from a successful approval and call the existing `POST /api/debates/{debate_id}/start` (spec 0005) → confirm it runs to a real `Verdict`, proving the two features compose correctly end to end, not just in isolation.
- Confirm every new endpoint/activity call carries correct `trace_id`/`session_id`(JWT)/`user_id` in logs, same observability pattern as spec 0005 — `bind_debate_context`-equivalent binding at the top of each new Activity (likely a generalized name, e.g. `bind_consultation_context`, or reusing the existing helper with a `consultation_session_id` field — exact naming decided during implementation, not a new design question).

## Found during implementation/verification, fixed before landing

- **Activity name collision crashed the whole Worker at startup, not just the new code.** `debates.activities.mark_failed` and the new `consultations.activities.mark_failed` shared the same name — Temporal registers Activities by name across the entire Worker process, not per-package (`ValueError: More than one activity named mark_failed`). Renamed the new one to `mark_consultation_failed`.
- **OpenAI's strict structured-output schema mode rejects a free-form `dict` field.** `ConsultantTurnOutput.proposed_payload: dict | None` produced a 400 from OpenAI (`'additionalProperties' is required to be supplied and to be false`) — a genuinely open-ended case payload can't be expressed in a schema requiring every property enumerated. Fixed by having the LLM emit `proposed_payload_json: str | None` (a JSON-encoded string) instead, parsed back into a real dict in `graphs.py` before it goes anywhere else — confined to the LLM-facing schema, not a change to how the rest of the system handles the payload.
- **Two related "retries forever" gaps, same root cause.** Neither the consultant LangGraph node nor the approval Activity's business-validation `ApplicationError`s had a bounded/non-retryable policy: the schema bug above retried 30+ times before anyone noticed (found via `grep -c` on the worker log, not a hunch), and a missing/misconfigured `CaseTypeConfig` retried 3 times before surfacing a failure that retrying could never fix. Fixed with an explicit `RetryPolicy` (3 max attempts) on the graph node and `non_retryable=True` on both validation `ApplicationError`s.
- **`WorkflowUpdateFailedError.cause` unwraps to a different depth depending on where the error originated** — verified by directly introspecting the exception objects in a Python shell inside the container, not assumed from docs. An `ApplicationError` raised directly in `approve` (the "not ready yet" case) sits at `exc.cause`; one raised inside `create_case_and_debate` (an Activity) is wrapped one level deeper as `exc.cause.cause` (an `ActivityError` in between). Getting this wrong silently produced an unhelpful `"Activity task failed"` instead of the real message. Fixed with a small helper that walks `.cause` until it finds the actual `ApplicationError`.

## Branch

Continuing on `main`.

## Status

Implemented and verified end to end against the real running stack (curl + Temporal + a real OpenAI-backed consultant persona), including an integration check chaining into the existing debate-start endpoint through to a real `Verdict`. Four real bugs found and fixed along the way (above). Django's existing test suite (8 tests) still passes unmodified.
