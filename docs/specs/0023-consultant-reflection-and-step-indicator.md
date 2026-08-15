# Spec 0023 — Consultant draft → critique → revise, with a live step indicator

Implements ADR 0008 in full: the 3-node reflection graph (decisions 1-4) and the additive SSE step-indicator channel (decision 5). Backend and frontend land together in this spec — same reasoning as specs 0020/0021: the indicator only has value if the frontend can render it, and there's no risk of the "unhandled event type" regression that made pairing mandatory there, but there's no reason to split this into two specs either since both halves are needed for the feature to do anything visible.

## 1. New schema — `orchestrator/app/consultations/schemas.py`

```python
class ConsultantCritique(BaseModel):
    needs_revision: bool
    concern: str | None = Field(
        default=None,
        description="Only when needs_revision is true: what the draft got wrong or missed.",
    )
```

## 2. `orchestrator/app/consultations/graphs.py` — three nodes, conditional edge

```python
from .activities import _publish  # new — see §3

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


async def _draft(state: ConsultantTurnState) -> dict:
    bind_consultation_context(consultation_session_id=state["session_id"])
    await _publish(state["session_id"], {"step": "draft"})
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
    return {"draft": {
        "message": response.message,
        "ready_to_finalize": response.ready_to_finalize,
        "proposed_payload": proposed_payload,
    }}


async def _critique(state: ConsultantTurnState) -> dict:
    bind_consultation_context(consultation_session_id=state["session_id"])
    await _publish(state["session_id"], {"step": "critique"})
    transcript = "\n".join(f"{t['speaker']}: {t['content']}" for t in state["turns"])
    prompt = (
        f"Conversation so far:\n{transcript}\n\n"
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


def _route_after_critique(state: ConsultantTurnState) -> str:
    return "revise" if state["critique"]["needs_revision"] else "end"


async def _revise(state: ConsultantTurnState) -> dict:
    bind_consultation_context(consultation_session_id=state["session_id"])
    await _publish(state["session_id"], {"step": "revise"})
    transcript = "\n".join(f"{t['speaker']}: {t['content']}" for t in state["turns"])
    prompt = (
        f"Conversation so far:\n{transcript}\n\n"
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
    return {"result": {
        "message": response.message,
        "ready_to_finalize": response.ready_to_finalize,
        "proposed_payload": proposed_payload,
    }}


def build_consultant_graph() -> StateGraph:
    g = StateGraph(ConsultantTurnState)
    node_opts = {"execute_in": "activity", "start_to_close_timeout": _NODE_TIMEOUT, "retry_policy": _NODE_RETRY}
    g.add_node("draft", _draft, metadata=node_opts)
    g.add_node("critique", _critique, metadata=node_opts)
    g.add_node("revise", _revise, metadata=node_opts)
    g.add_edge(START, "draft")
    g.add_edge("draft", "critique")
    g.add_conditional_edges("critique", _route_after_critique, {"revise": "revise", "end": END})
    g.add_edge("revise", END)
    return g
```

**When `critique` passes (no revision needed), the graph ends at `critique` with no `result` key set** — `workflows.py`'s `submit_message` needs a small adjustment: after `graph(CONSULTANT_GRAPH).compile().ainvoke(state)`, read `turn_result.get("result") or turn_result["draft"]` (the draft is the final answer whenever no revision happened). This is the one required change to `consultations/workflows.py` — everything else there (the Update signature, `persist_turn` calls, `_last_proposed_payload` tracking) is unchanged.

## 3. `orchestrator/app/consultations/activities.py` — a `_publish` helper, mirroring debates

```python
from ..core.redis_client import redis_client

async def _publish(session_id: int, event: dict) -> None:
    """Step-indicator signal only (ADR 0008 decision 5) — never a source of
    truth. Best-effort and non-fatal, same reasoning as debates/activities.py's
    _publish: a Redis hiccup should cost the UI one missed "thinking" label
    update, never fail the actual consultant turn over a live-view concern."""
    try:
        await redis_client.publish(f"consultation:{session_id}:stream", json.dumps(event))
    except Exception:
        logger.warning("failed to publish step event for consultation %d", session_id, exc_info=True)
```

`graphs.py` imports this (`from .activities import _publish`) — same safe, non-circular import shape ADR 0007 already established for `debates/graphs.py` importing from `debates/activities.py`.

## 4. New endpoint — `orchestrator/app/consultations/router.py`

```python
from fastapi.sse import EventSourceResponse, ServerSentEvent
from ..core.redis_client import redis_client

@router.get("/{session_id}/stream", response_class=EventSourceResponse)
async def stream_consultation_turn(
    session_id: int, auth: AuthContext = Depends(get_auth_context)
):
    """Live step indicator only (ADR 0008 decision 5) — POST /messages
    remains the sole source of truth for the actual reply; this carries no
    content, just which reflection step is currently running."""
    bind_consultation_context(consultation_session_id=session_id, session_id=auth.session_id, user_id=auth.user_id)
    await _get_owned_session(session_id, auth)  # 404 before entering the stream, same as every other endpoint here

    async def _events():
        channel = f"consultation:{session_id}:stream"
        pubsub = redis_client.pubsub()
        await pubsub.subscribe(channel)
        try:
            async for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                yield ServerSentEvent(data=json.loads(message["data"]), event="step")
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()

    return EventSourceResponse(_events())
```

No WebSocket-style JWT-via-subprotocol trick needed — this is a plain `GET`, and the frontend will drive it via `fetch()` (not the browser's native `EventSource`, which can't set an `Authorization` header) so the existing `Auth.getAccessToken()` pattern just works as a normal header, same as every other authenticated request.

**Disconnect handling comes for free here — verified against current Starlette source, not assumed**: unlike the raw WebSocket endpoint that needed spec 0022's hand-built race, `EventSourceResponse` extends Starlette's `StreamingResponse`, whose `__call__` already races the response generator against the ASGI `http.disconnect` message internally (a "collapsing task group," or a direct `OSError` catch on newer ASGI servers) and cancels the generator the instant the client leaves. Our `try/finally` just needs to be in place to release the Redis subscription when that cancellation happens — no separate disconnect-watcher loop needed, unlike spec 0022. Verify this empirically anyway (see verification plan) rather than trust the docs alone, matching how every other Temporal/LangGraph integration point in this project has been checked against the real stack, not assumed from documentation.

## 5. Frontend — `frontend/src/app/features/consultation/consultation-chat/consultation-chat.ts`

New signal: `readonly currentStep = signal<'draft' | 'critique' | 'revise' | null>(null)`.

`sendMessage()` opens the SSE stream *before* calling `this.api.sendMessage(...)` — ordering matters (ADR 0008 decision 5's no-replay caveat):

```ts
async sendMessage(): Promise<void> {
  const id = this.sessionId();
  const text = this.draftText().trim();
  if (id === null || !text || this.sending()) return;

  this.messages.update((msgs) => [...msgs, { speaker: 'user', content: text }]);
  this.draftText.set('');
  this.sending.set(true);
  this.error.set(null);
  this.currentStep.set('draft'); // seeded optimistically — draft always starts immediately

  const stepAbort = new AbortController();
  void this.watchSteps(id, stepAbort.signal); // fire-and-forget, opened before the POST below

  try {
    const result = await this.api.sendMessage(id, text);
    this.messages.update((msgs) => [...msgs, { speaker: 'consultant', content: result.message }]);
    this.readyToFinalize.set(result.ready_to_finalize);
  } catch (err: unknown) {
    this.error.set(this.describeError(err, 'Could not send that message — try again.'));
  } finally {
    stepAbort.abort(); // close the SSE stream — POST's own resolution is the completion signal
    this.currentStep.set(null);
    this.sending.set(false);
  }
}

private async watchSteps(sessionId: number, signal: AbortSignal): Promise<void> {
  const token = this.auth.getAccessToken();
  if (!token) return; // shouldn't happen, route is auth-guarded — degrade to the generic "Thinking…" label
  try {
    const response = await fetch(
      `${environment.orchestratorApiBase}/api/consultations/${sessionId}/stream`,
      { headers: { Authorization: `Bearer ${token}` }, signal },
    );
    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line; each frame's "data:" line is JSON.
      let sepIndex: number;
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const payload = JSON.parse(dataLine.slice(5).trim()) as { step: 'draft' | 'critique' | 'revise' };
        this.currentStep.set(payload.step);
      }
    }
  } catch {
    // AbortError from stepAbort.abort() is expected and not an error — anything else
    // just means the label stays generic, never worth failing the whole send over.
  }
}
```

`Auth` is injected the same way `debate-thread.ts` already does for its own WS token.

## 6. `consultation-chat.html` — dynamic label in the pending bubble

```html
@if (sending()) {
  <div class="message">
    <span class="message-speaker">Consultant</span>
    <p class="message-content message-content--pending typing-indicator">
      @switch (currentStep()) {
        @case ('critique') { <span class="step-label">Double-checking…</span> }
        @case ('revise') { <span class="step-label">Revising…</span> }
        @default { <span class="step-label">Thinking…</span> }
      }
      <span></span><span></span><span></span>
    </p>
  </div>
}
```
`'draft'` and `null` both fall to the `@default` "Thinking…" label — no reason to say "Drafting…" specifically since that's indistinguishable from today's baseline experience; the label only needs to change once something *beyond* the original single call is happening.

## 7. `docs/API.md`

Document the new `GET /api/consultations/{session_id}/stream` endpoint and the `consultation:{session_id}:stream` Redis channel, mirroring how `debate:{id}:stream` is documented.

## Explicitly out of scope

Token-by-token streaming of the consultant's own message text (raised and deferred in this same conversation — this channel carries step names only, never content). Any change to `POST /messages`'s contract, status codes, or error handling. The debate-side graphs and their Redis/WebSocket streaming — entirely separate, untouched.

## Verification plan

- Real end-to-end run against the actual OpenAI model (not mocked): confirm a normal turn where critique passes (2 calls, `draft` → `critique` → end, `revise` never invoked) and confirm — this being the first conditional edge run through Temporal's LangGraph plugin in this codebase — that a case genuinely engineered to trigger a concern (e.g., feed a deliberately ambiguous/contradictory user message) actually routes into `revise` and that `revise`'s output, not the original draft, is what gets persisted as the turn and returned to the frontend.
- Confirm the SSE endpoint delivers `step` events in the correct order for both cases, and that opening the SSE connection genuinely has to happen before the `POST /messages` call — verify by deliberately testing the *wrong* order once (open after) and confirming the first event is missed, to make the ordering requirement concrete rather than theoretical.
- Confirm disconnect handling on the SSE endpoint the same way spec 0022 verified the WebSocket case: open a connection, then abort/close it client-side, and confirm the Redis subscription is released promptly (`redis-cli PUBSUB CHANNELS`) — don't just trust the Starlette-internals claim above.
- Real browser: full consultation flow, confirm the "Thinking…" label changes to "Double-checking…" (and "Revising…" when triggered) at the right moments, confirm no console errors, confirm approve/finalize still works unchanged.
- Confirm the existing 409 (already-approved) and 400 (approve-before-ready) error paths on the untouched endpoints still behave exactly as before.
- Re-run `npx ng test`.

## Branch

Continuing on `main`.

## Found during implementation/verification

Three real bugs found and fixed against the real running stack — exactly the kind of integration risk this spec's verification plan was written to catch, since this codebase had never exercised a LangGraph conditional edge through Temporal, nor FastAPI's native SSE support, before this spec.

1. **`NotImplementedError` on every single turn, real reply never returned.** `_route_after_critique` was a plain synchronous function. The graph's own node-to-node routing runs inside the Workflow's sandboxed context (only individual nodes are dispatched out as Activities) — LangChain's runnable-coercion falls back to a background thread executor for sync callables when invoked via `ainvoke()`, and Temporal's workflow sandbox forbids spawning real OS threads (a determinism requirement). Fixed by making the routing function `async def` — LangGraph's conditional-edge API explicitly supports this, confirmed against its actual signature, not assumed.
2. **The SSE endpoint returned a broken response (`TypeError: 'coroutine' object is not iterable`, `RuntimeWarning: coroutine ... was never awaited`).** `response_class=EventSourceResponse` requires the *route handler itself* to be the async generator (`yield` directly) — verified against FastAPI's own documented pattern, not assumed. A function that instead builds and returns `EventSourceResponse(some_generator())` breaks. Fixed by making `stream_consultation_turn` itself the generator.
3. **A previously-working 404 (nonexistent/not-owned session) silently became a 200 with an empty body** once the endpoint became a generator. Raising `HTTPException` *inside* the generator body doesn't convert to a normal error response — by the time it fires, Starlette's streaming machinery has already committed to the response, so it surfaces as an unhandled `ExceptionGroup` server-side while the client just gets an empty 200. Fixed by moving the ownership check into a `Depends(...)` (`_owned_session_dependency`), which FastAPI resolves *before* invoking the generator body — confirmed via direct testing (`curl` against a nonexistent session id, before and after the fix).

**Both graph branches confirmed working end to end**: 3 real consultation turns via direct `curl` all triggered `critique → revise` (the persisted/returned text confirmed to be the *revised* text, not the original draft, checked directly in Postgres); the "critique passes cleanly, no revise" branch was confirmed two ways — a deterministic isolated test (stubbed nodes, no LLM, no Temporal) proving the LangGraph-level mechanics terminate correctly at `critique` with no `result` key set, and (once real-browser testing started) an actual real turn in the live app that legitimately skipped `revise` (`Thinking… → Double-checking… → [reply]`, no "Revising…"), confirming the mechanism holds under the real model's judgment too, not just synthetically.

**Ordering requirement confirmed real, not just theoretical**: deliberately opened the SSE connection *after* firing the `POST /messages` call — confirmed it missed the `draft` step event entirely (only `critique`/`revise` arrived), exactly as ADR 0008 decision 5 predicted from Redis pub/sub's lack of replay.

**Disconnect handling confirmed working with no hand-built race needed** (unlike spec 0022's WebSocket fix): opened an SSE connection, killed the client, confirmed via `redis-cli PUBSUB CHANNELS` that the subscription released within ~1s and the orchestrator logged no error/warning noise — Starlette's own internal disconnect-race for `StreamingResponse` handled it, as the docs claimed.

**Real-browser verification (Canary), 4 consultation turns**: label sequences captured via gap-free DOM polling — `Thinking…` → `Double-checking…` → `Revising…` → real reply (turns 2-3, full cycle); `Thinking…` → `Double-checking…` → real reply (turn 4, revise correctly skipped). No stuck labels, no flicker, no console errors tied to this feature (one unrelated, pre-login 401 on token refresh, same benign pattern seen in prior milestones). Approve/finalize flow confirmed unaffected — navigated cleanly to a real `/debates/:id` page after 4 turns.

**One calibration observation, not a bug**: across all 4 real-model turns observed (3 via curl, 1+ via browser), critique flagged a concern more often than not — worth revisiting the critique prompt's threshold in a future pass if this proves too aggressive in practice, but the mechanism itself is confirmed correct in both directions.

## Status

Implemented and verified against the real running stack. 3 real integration bugs found and fixed (async routing function required by Temporal's workflow sandbox; SSE endpoint's generator-as-handler requirement; dependency-based auth check required for a clean 404 inside a streaming endpoint). Both graph branches (revise and clean-pass) confirmed working via real model runs and a real browser. 21 Angular tests pass (1 new). `POST /messages`'s contract, status codes, and error handling confirmed unchanged.
