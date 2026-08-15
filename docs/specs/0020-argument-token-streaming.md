# Spec 0020 — Real token streaming for arguments (backend + frontend)

Implements ADR 0007's decisions 1 and 2, scoped to **the argument graph only** — the highest-value, most complex of the three turn types, proven here first before the same pattern extends to the judge's opening statement and verdict (a separate follow-up spec, since those two graphs have their own quirks: opening needs no split at all, closing has two prose fields to weigh). Backend and frontend are one vertical slice in this spec, not split across two — confirmed during this session's discussion that shipping the new WS event types alone would break the current frontend: `debate-thread.ts`'s message handler treats anything that isn't `turn_started` as "turn complete, go re-fetch," which would misfire on every single token chunk if left unchanged.

## 1. New schema — `orchestrator/app/debates/schemas.py`

```python
class ArgumentJudgment(BaseModel):
    position: str
    confidence: float = Field(ge=0.0, le=1.0)
    responds_to_argument_id: int | None = Field(
        default=None,
        description=(
            "Required (non-null) when this position differs from this participant's "
            "own position last round — decision 4's citation-on-change rule."
        ),
    )
```

`ArgumentOutput` is deleted (grepped — it's referenced nowhere outside `graphs.py`'s single call site being changed here; no reason to keep an unused schema alongside its replacement).

## 2. `orchestrator/app/debates/graphs.py` — split `_produce_argument`

`ArgumentState` gains two fields the node needs to publish correctly-shaped events (`turn_started`'s payload already carries these from the Workflow, but the node itself currently receives neither): `agent_persona_id: int` and `round_number: int`.

```python
async def _produce_argument(state: ArgumentState) -> dict:
    bind_debate_context(debate_id=state["debate_id"])
    turn_meta = {
        "agent_persona_id": state["agent_persona_id"],
        "stage": "argument",
        "round_number": state["round_number"],
    }
    await _publish(state["debate_id"], {"type": "turn_token_reset", **turn_meta})

    options_note = ...  # unchanged
    change_note = ...   # unchanged
    prompt = ...         # unchanged — same full context as today, so streamed prose quality is unaffected

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
```

`from .activities import _publish` (a plain async function, not an Activity itself — safe to import; `activities.py` has no import back from `graphs.py`, no circularity). The returned `result` dict keeps the exact same shape `persist_argument` already expects (`content`/`position`/`confidence`/`responds_to_argument_id`) — no change needed in `activities.py` or `queries.py`.

## 3. `orchestrator/app/debates/workflows.py` — pass the two new state fields

`arg_state` (in the per-participant loop) gains `"agent_persona_id": participant["agent_persona_id"]` and `"round_number": round_number` — both already in scope there (used one line above for `publish_turn_started`'s args), just not currently threaded into `arg_state`.

## 4. `frontend/src/app/features/debate/data/debate-stream.ts` — two new event variants

```ts
| { type: 'turn_token'; agent_persona_id: number; stage: 'opening_statement' | 'argument' | 'verdict'; round_number: number | null; token: string }
| { type: 'turn_token_reset'; agent_persona_id: number; stage: 'opening_statement' | 'argument' | 'verdict'; round_number: number | null }
```

## 5. `frontend/src/app/features/debate/debate-thread/debate-thread.ts` — handle them explicitly, don't fall into the refetch branch

New signal: `readonly streamingText = signal<string>('')`. One signal, not a per-turn map — the workflow is fully sequential (confirmed by reading `workflows.py`'s `_run`: one participant/judge call in flight at a time, globally, per debate), so there is never more than one turn streaming at once.

`openStream()`'s handler becomes:
```ts
(event) => {
  if (event.type === 'turn_started') {
    this.streamingText.set('');
    this.generatingTurn.set({ agentPersonaId: event.agent_persona_id, agentName: event.agent_name, stage: event.stage, roundNumber: event.round_number });
  } else if (event.type === 'turn_token') {
    this.streamingText.update((t) => t + event.token);
  } else if (event.type === 'turn_token_reset') {
    this.streamingText.set('');
  } else {
    this.generatingTurn.set(null);
    this.streamingText.set('');
    void this.loadDebate(debateId);
  }
}
```
This is the change that actually matters for not breaking anything: `turn_token`/`turn_token_reset` now have their own branches, so they can never fall into the `else` (refetch) bucket the way an unhandled new event type would today.

## 6. `frontend/src/app/features/debate/debate-thread/debate-thread.html` — render live text in the argument thinking-bubble only

The existing argument-stage thinking bubble (lines 110-122 today) shows `streamingText()` in place of the typing dots once it's non-empty, falling back to dots while it's still empty (the gap between `turn_started` and the first token arriving):

```html
<div class="bubble bubble--thinking" [class.left]="isLeft(gt.agentPersonaId)" [class.agent-b]="agentSlot(gt.agentPersonaId) === 'b'">
  <div class="bubble-head">
    <span class="bubble-name">{{ gt.agentName }}</span>
  </div>
  @if (streamingText()) {
    <div class="bubble-text">{{ streamingText() }}</div>
  } @else {
    <span class="typing-indicator"><span></span><span></span><span></span></span>
  }
</div>
```

The opening-statement and verdict thinking blocks are **untouched** — the backend isn't publishing `turn_token` for those stages in this spec, so they keep showing dots-only exactly as today, no regression expected there.

## Explicitly out of scope

Judge opening statement and verdict/closing graphs (follow-up spec). Any change to `check_convergence`, DB schema, or `persist_argument`'s call shape — the final persisted row is identical to today's. Chunk-rate batching (ADR 0007 decision 3 — measure first). `_NODE_TIMEOUT` changes (decision 4 — measure first).

## Verification plan

Real browser (Canary), full debate run, watching an actual argument turn closely:
- Confirm `turn_started` → dots → text progressively appearing word-by-word in the same bubble → `argument_complete` → seamless swap to the persisted bubble with matching text (no flash, no mismatch).
- Confirm `position`/`confidence` still populate correctly once the row loads (phase-2 call's output, cross-checked against Postgres).
- **Confirm no refetch storm**: watch network activity during an active streaming turn — `GET` calls to load the debate must not fire per-token; only once, when the real complete event lands.
- Confirm opening statement and verdict turns are visually unchanged (dots only, no streamed text) — no regression from this spec's scope.
- Measure actual `.astream()` chunks/sec for a real argument against the real model — report the number; only act on it if it suggests batching is actually needed (ADR decision 3).
- Measure real wall-clock time for the full two-call sequence per argument — confirm comfortable margin under the 60s `_NODE_TIMEOUT` (ADR decision 4).
- `turn_token_reset`'s actual retry path is not exercised by a live forced-failure test (impractical to trigger a real Temporal Activity retry deterministically) — verified by code review only; call this out plainly rather than claiming it was tested.
- Re-run `npx ng test`.

## Branch

Continuing on `main`.

## Found during implementation/verification

**Backend verification (a direct WS test client against a real debate, no mocks)**: confirmed real progressive streaming — 75 `turn_token` events for one argument at ~11ms apart during the actual text-generating window (a separate one-word argument, "reject", legitimately produced exactly one token — a real short model response, not a bug, confirmed by checking the persisted content matched). `turn_token_reset` fired exactly once per argument turn as expected. Full debate (opening + 2 arguments + verdict) completed in ~13.5s, comfortably under the 60s `_NODE_TIMEOUT` (ADR 0007 decision 4 — no change needed). No batching needed at this rate (ADR 0007 decision 3 — confirmed empirically, not assumed).

**Real bug found in a second-round run, fixed, and re-verified clean**: round 2 (both participants) persisted `content` as a raw stringified JSON blob instead of prose — confirmed directly via Postgres, not just a frontend rendering guess. Root cause: dropping `with_structured_output()` for the phase-1 content call removed the implicit shape-constraint that used to come from function-calling, and with nothing new to add in round 2 (both participants already at `reject`/0.9 confidence with a fairly clear-cut case), the model degenerated into echoing back the `json.dumps(state['prior_arguments'])` text it was handed in the prompt instead of writing prose. Fixed by making the phase-1 prompt explicitly instruct plain-prose output and explicitly forbid repeating the prior-arguments JSON verbatim. Re-verified with a fresh 2-round debate: all 4 persisted arguments (both rounds, both participants) are clean natural-language prose — confirmed both directly in Postgres and via real-browser DOM inspection of `.bubble-text` (4/4 readable, zero JSON-shaped matches).

**Real-browser verification (Canary, full debate run)**: confirmed genuine word-by-word progressive growth in the argument bubble (frame-by-frame video evidence, e.g. text growing from a mid-sentence fragment to a complete sentence within ~0.4s), no visual flash/duplication/layout break, avatar/name positioning unaffected. Clean swap from streamed text to the final persisted bubble (position/confidence meta line) with no mismatch. **No refetch-storm regression**: total `GET /api/debates/{id}/` + `/arguments/` calls across a full multi-round run stayed at one pair per actual turn-completion event (confirmed via the network log) — zero additional fetches during the many-token streaming window, confirming `turn_token`/`turn_token_reset` are correctly branched in the frontend handler rather than falling into the "refetch" bucket, which was the specific regression this spec was written to avoid. Opening statement and verdict panels confirmed visually unchanged (dots-only, no streaming text) — no regression outside this spec's scope. Zero console errors across the full run.

## Status

Implemented and verified against the real running stack (real OpenAI calls, real Postgres, real WebSocket, a real browser) — argument-turn streaming only. One real bug found (round-2 JSON-echo degeneration) and fixed within this pass, re-verified clean at both the database and browser level. 20 Angular tests pass (1 new). Judge opening statement and verdict/closing graphs remain on the old one-shot call — a follow-up spec, per ADR 0007's sequencing.
