# Spec 0018 — `turn_started` events, backend

> No new ADR — this extends ADR 0006's already-established Redis/WebSocket event vocabulary (a new event *type* on the same `debate:{id}:stream` channel, same publish mechanism), not a new architecture pattern. Backend only — frontend consumption is spec 0019, same split pattern as every other backend/frontend milestone in this project.

## What this is actually fixing

Decision 12's original ask (and spec 0001's mock) wanted arguments to stream token-by-token with a "currently generating" indicator. ADR 0006 correctly ruled out the *token-by-token content* part — verified empirically that `ChatOpenAI(...).with_structured_output(ArgumentOutput).astream(...)` returns one atomic chunk, not incremental tokens, a real constraint of the current model/library combination. But "which agent/judge is active right now" is a **separate capability that doesn't need token content at all** — it only needs the backend to say "X just started" before it finishes, which nothing currently does. Every event on `debate:{id}:stream` today (`argument_complete`, `status_change`) fires only on *completion*. This spec adds the missing "started" signal.

## Root cause / verified structure

Read directly from `orchestrator/app/debates/workflows.py`: the workflow calls `graph(...).compile().ainvoke(...)` at exactly three points, each a real LLM call with no visibility until it returns:
1. The judge's opening statement (`JUDGE_OPENING_GRAPH`), once, before the round loop.
2. Each participant's argument (`ARGUMENT_GRAPH`), once per participant per round, inside the round loop.
3. The judge's closing verdict (`JUDGE_CLOSING_GRAPH`), once, after the round loop.

(`check_convergence` is a plain DB-query/computation — no LLM call, near-instant — confirmed by reading `activities.py`; it doesn't need a "started" event, there's no meaningful delay to signal.)

## 1. New Activity — `orchestrator/app/debates/activities.py`

```python
@activity.defn
async def publish_turn_started(
    debate_id: int, agent_persona_id: int, agent_name: str, stage: str, round_number: int | None
) -> None:
    bind_debate_context(debate_id=debate_id)
    await _publish(debate_id, {
        "type": "turn_started",
        "agent_persona_id": agent_persona_id,
        "agent_name": agent_name,
        "stage": stage,  # "opening_statement" | "argument" | "verdict"
        "round_number": round_number,
    })
```
Uses the existing `_publish` helper (best-effort, non-fatal, already established) — no new Redis logic. `agent_name` rides in the event itself (denormalized, not just an id) so the frontend can render immediately without a lookup — necessary for the very first turn of a debate, before any `Argument`/participant data has been fetched client-side yet.

## 2. Three call sites — `orchestrator/app/debates/workflows.py`

Each is a `workflow.execute_activity(activities.publish_turn_started, args=[...], ...)` call immediately before the corresponding `graph(...).ainvoke(...)`:

- Before `graph(JUDGE_OPENING_GRAPH)`: `args=[debate_id, judge["id"], judge["name"], "opening_statement", None]`.
- Before `graph(ARGUMENT_GRAPH)` (inside the `for participant in participants:` loop): `args=[debate_id, participant["agent_persona_id"], participant["persona_snapshot"]["name"], "argument", round_number]`.
- Before `graph(JUDGE_CLOSING_GRAPH)`: `args=[debate_id, judge["id"], judge["name"], "verdict", None]`.

No change to `graphs.py`'s LLM call shape, no change to `Argument`/`Verdict` schemas, no change to convergence-check logic — purely additive.

## 3. `docs/API.md`

Add `turn_started` to the documented event types on `debate:{id}:stream`, alongside `argument_complete`/`status_change` — `{agent_persona_id, agent_name, stage, round_number}`, published the instant a turn's LLM call begins.

## Explicitly out of scope

Any token-level content in this event (already ruled out, ADR 0006). A "started" event for `check_convergence` (no LLM call, nothing to signal). Changing the actual LLM call latency — this only makes existing waits visible, doesn't shorten them.

## Verification plan

- Real WS client (not curl) against a live debate run: confirm `turn_started` events arrive in the correct order (opening_statement → argument×2 per round → verdict), each with the correct `agent_persona_id`/`agent_name`/`stage`/`round_number`, and that each one arrives *before* its corresponding `argument_complete`/opening-statement-persisted moment, not after.
- Confirm the existing behavior (event timing/content for `argument_complete`/`status_change`, DB writes, convergence logic) is completely unchanged — this is additive only.

## Branch

Continuing on `main`.

## Found during implementation/verification

A related, pre-existing gap surfaced while verifying this alongside spec 0019: `persist_opening_statement` never published *any* completion event — the frontend had only ever learned the opening statement was ready via whatever event happened to arrive next (previously an unrelated `status_change`/`argument_complete`, coincidentally soon enough not to be noticed; once `turn_started` existed, the next event was a same-debate `turn_started` that deliberately doesn't trigger a re-fetch, turning the previously-brief delay into a ~2s visible blank gap). Fixed by adding an `opening_statement_complete` publish call, matching the same "publish immediately after the DB write" pattern every other Activity here already uses — this was a real, separate gap, not something this spec introduced, just one this spec's verification exposed.

## Status

Implemented and verified against real WS traffic: `turn_started` events confirmed arriving in the correct order (opening_statement → argument×2 per round → verdict) with correct agent/stage/round data, each before its corresponding complete event. The `opening_statement_complete` addition (found during verification) also implemented and confirmed closing a real, separate gap. No regressions to existing event timing/DB writes.
