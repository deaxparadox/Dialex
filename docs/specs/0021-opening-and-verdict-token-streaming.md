# Spec 0021 — Real token streaming for judge opening statement + verdict (backend + frontend)

Extends spec 0020's pattern (ADR 0007) to the two remaining graphs, closing out the sequencing note ADR 0007 ended on. Same vertical-slice-per-spec discipline: backend and frontend land together, since spec 0020 already established why that matters (an unhandled event type would misfire the frontend's refetch logic).

## 1. New schema — `orchestrator/app/debates/schemas.py`

```python
class ClosingJudgment(BaseModel):
    decision: str
    confidence: float = Field(ge=0.0, le=1.0)
    closing_summary: str
    cited_argument_ids: list[int]
```

`JudgeOpeningOutput` and `JudgeClosingOutput` are both deleted (grepped — referenced nowhere outside the two call sites being changed here).

## 2. `_produce_opening` — no split at all

`JudgeOpeningOutput` was 100% prose (`opening_statement: str` — nothing else), so per ADR 0007 decision 1 this graph needs no second call, ever. Drop `with_structured_output` entirely:

```python
async def _produce_opening(state: JudgeOpeningState) -> dict:
    bind_debate_context(debate_id=state["debate_id"])
    turn_meta = {"agent_persona_id": state["agent_persona_id"], "stage": "opening_statement", "round_number": None}
    await _publish(state["debate_id"], {"type": "turn_token_reset", **turn_meta})

    prompt = ...  # unchanged

    llm = _llm(state["model_name"], state["temperature"])
    parts: list[str] = []
    async for chunk in llm.astream([SystemMessage(state["system_prompt"]), HumanMessage(prompt)]):
        if not chunk.content:
            continue
        parts.append(chunk.content)
        await _publish(state["debate_id"], {"type": "turn_token", "token": chunk.content, **turn_meta})
    return {"result": {"opening_statement": "".join(parts)}}
```

`JudgeOpeningState` gains `agent_persona_id: int` (the judge's id — already available in `workflows.py` as `judge["id"]`, already used one line above for `publish_turn_started`, just not threaded into `opening_state` yet).

## 3. `_produce_closing` — split, `reasoning` streams, everything else follows

Of `JudgeClosingOutput`'s five fields, only `reasoning` is actually rendered live to a user (`debate-thread.html`'s `.verdict-reasoning`) — `closing_summary` is persisted (`Debate.closing_summary`) but never displayed anywhere today (grepped `frontend/src`), so it doesn't need to stream; it can ride in the judgment call along with `decision`/`confidence`/`cited_argument_ids`.

```python
async def _produce_closing(state: JudgeClosingState) -> dict:
    bind_debate_context(debate_id=state["debate_id"])
    turn_meta = {"agent_persona_id": state["agent_persona_id"], "stage": "verdict", "round_number": None}
    await _publish(state["debate_id"], {"type": "turn_token_reset", **turn_meta})

    options_note = ...  # unchanged
    prompt = (
        f"Case: {json.dumps(state['case_payload'])}\n\n"
        f"Full argument history: {json.dumps(state['all_arguments'])}\n\n"
        f"{options_note}\n\n"
        "Write your reasoning for the final verdict as plain prose (3-5 sentences), in your own "
        "words — do not output JSON, do not repeat the argument history verbatim."
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
```

`JudgeClosingState` gains `agent_persona_id: int` (same as opening — `judge["id"]`, already in scope in `workflows.py`).

**Applying spec 0020's lesson up front, not waiting to find it again**: the closing prompt already explicitly says "do not output JSON, do not repeat the argument history verbatim" from the start — spec 0020 needed a follow-up fix to add this after finding a real degeneration bug in round 2; the same risk exists here (a case with an obvious, already-converged outcome giving the judge little new to say), so it's included from the first draft this time.

## 4. `orchestrator/app/debates/workflows.py` — thread `agent_persona_id` through

`opening_state` gains `"agent_persona_id": judge["id"]`. `closing_state` gains the same.

## 5. Frontend — extend the existing `streamingText` mechanism, no new signal needed

`debate-thread.ts`'s `streamingText`/`turn_token`/`turn_token_reset` handling (spec 0020) already works for any stage — nothing backend-shape-specific about it. Only the template needs extending:

- **Opening statement** (`debate-thread.html`'s `openingGeneratingTurn` branch): show `streamingText()` in place of the typing dots, same pattern as the argument bubble.
- **Verdict** (`debate-thread.html`'s `generatingTurn(); as gt` / `gt.stage === 'verdict'` branch): same — `streamingText()` in place of dots, rendered as the verdict's reasoning-in-progress.

## Explicitly out of scope

Any change to `check_convergence`, `persist_opening_statement`, `persist_verdict_and_close`, or the DB schema — persisted shapes are identical to today. Chunk-rate batching and `_NODE_TIMEOUT` (ADR 0007 decisions 3/4 — re-measure for these two graphs' actual call shapes, don't assume spec 0020's numbers carry over unchanged).

## Verification plan

Same shape as spec 0020's: a direct WS test client on a real debate confirming progressive `turn_token` streaming for opening statement and verdict specifically (not just arguments, which are already proven); a real browser confirming visible word-by-word growth in both the opening block and the verdict block, no refetch-storm, clean swap to final content, opening statement genuinely has no second call (only one LLM call in the trace, not two); direct Postgres check that `Debate.opening_statement`/`Verdict.reasoning`/`closing_summary`/`decision`/`confidence`/`cited_argument_ids` are all still correct and — specifically watching for spec 0020's round-2-style degeneration — that they're clean prose, not JSON, especially on a near-unanimous/low-novelty case where the judge has little new to say. Re-run `npx ng test`.

## Branch

Continuing on `main`.

## Found during implementation/verification

**Applying spec 0020's lesson paid off**: the closing prompt's upfront "do not output JSON, do not repeat verbatim" instruction worked — a fresh debate's round with an already-obvious "deny" outcome produced clean prose for `reasoning`/`closing_summary` with no repeat of spec 0020's degeneration bug. Confirmed directly in Postgres (`decision`, `confidence`, `reasoning` all clean) and cross-checked `cited_argument_ids` against the real argument ids from that debate — both correctly cited.

**Backend verification (direct WS test client)**: opening statement streamed as a single call (turn_started → turn_token_reset → ~140 tokens → opening_statement_complete, no second call/delay pattern visible in the timing), confirming the "no split" design actually took effect. Verdict streamed with the expected two-call shape (stream, then a shorter gap for the judgment call before `status_change`).

**Real bug found in real-browser verification, fixed, and re-verified clean with frame-by-frame evidence**: right as the opening statement finished streaming, the visible text briefly (~100-150ms) reverted to the "Generating opening statement… •••" placeholder before the final block popped in — a real, reproducible regression from visible text back to a loading indicator, confirmed via 20fps frame extraction. Root cause: the WS message handler cleared `streamingText` synchronously the instant the completion event arrived, but the authoritative refetch (`loadDebate()`) is async — in that gap, `generatingTurn` was already null (so the primary streaming-text branch stopped rendering) but `d.opening_statement` hadn't loaded yet, so control fell through to an older fallback (built in spec 0017/0019 for a different scenario — reconnecting mid-generation) that unconditionally showed dots, with no awareness of `streamingText`. Fixed by no longer clearing `streamingText` in that branch (it now persists until the next `turn_started` naturally resets it) and extending that fallback to render `streamingText()` when present instead of unconditional dots. Re-verified with continuous, gap-free frame-by-frame DOM polling (~20-22fps) across 2 fresh debates for both the opening and verdict transitions: real text visible from the moment streaming starts, **never reverts**, swaps seamlessly to the final block with identical text. One new, separate, very minor observation surfaced during this re-check: a single ~45-50ms frame where just the avatar/label line (not the text) blinks out right before the final block mounts — reproducible but sub-perceptual; logged in `TODO.md`, not fixed here (out of scope for what this pass was checking, and arguably not worth a fix given its size).

## Status

Implemented and verified against the real running stack — opening statement (no split, single call, confirmed) and verdict (split, confirmed) both stream token-by-token. One real bug found (opening-statement dots-revert flicker) and fixed within this pass, re-verified clean with gap-free frame-by-frame evidence across 2 fresh debates for both transitions. 20 Angular tests pass. All three turn types (argument, opening statement, verdict) now stream real content — ADR 0007's sequencing is complete.
