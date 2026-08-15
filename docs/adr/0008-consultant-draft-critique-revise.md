# ADR 0008 — Consultant self-critique: draft → critique → conditional revise

> Triggers the ADR bar twice over: (1) the first genuinely multi-node LangGraph graph with a conditional branch in this codebase — both `debates/graphs.py` and `consultations/graphs.py` are strictly single-node today, and `debates/graphs.py`'s own docstring already flagged this as the anticipated next step ("multi-node reasoning (draft-then-critique, etc.) is a real future enhancement — deliberately single-node per graph this milestone"); (2) the first live-update channel for consultation — ADR 0005 decision 3 left this as "SSE is the leading idea if it's ever built," and reflection's added latency (decision 4, below) is exactly what makes it worth building now. Scoped to the consultant only; the debate graphs and their existing Redis/WebSocket streaming are untouched.

## Decision 1 — Three-node graph: `draft` (unchanged) → `critique` (new) → conditional `revise` (new)

Root cause, already logged in `TODO.md` with concrete evidence: `build_consultant_graph()` is one direct `ChatOpenAI(...).with_structured_output(ConsultantTurnOutput).ainvoke(...)` call, no self-check. A real consultation session (id 15) had the consultant parrot back an evident typo ("log computation task" — almost certainly "long computation task") **three separate times** across later turns without ever questioning it or asking for clarification — exactly the shallow pattern-completion a reflection step should catch.

Fix — extend `ConsultantTurnState`/`build_consultant_graph()` to three nodes:

- **`draft`** — unchanged. Today's exact call, exact prompt, exact `ConsultantTurnOutput` schema.
- **`critique`** — new. Given the draft and the conversation transcript, decides whether the draft actually engages with anything ambiguous, inconsistent, or likely-mistaken in the user's most recent message, rather than accepting it at face value. New schema:
  ```python
  class ConsultantCritique(BaseModel):
      needs_revision: bool
      concern: str | None = Field(
          default=None,
          description="Only when needs_revision is true: what the draft got wrong or missed.",
      )
  ```
  Prompt sketch: *"Conversation so far: {transcript}\n\nDrafted reply: {draft.message}\n\nDoes this reply actually address anything unclear, inconsistent, or possibly mistaken in the user's last message — or does it just accept it at face value and move on? Set needs_revision=true only if there's a real, specific concern; don't flag stylistic preferences."*
- **`revise`** — new, **conditional**: only reached when `critique.needs_revision` is true. Reuses the existing `ConsultantTurnOutput` schema (same shape `draft` already produces — no new output shape needed), fed the draft and the critique's `concern`, asked to rewrite the reply to actually address the flagged concern.

Routing: `g.add_conditional_edges("critique", _route_after_critique, {"revise": "revise", "end": END})`, where `_route_after_critique(state)` reads `state["critique"]["needs_revision"]` and returns `"revise"` or `"end"`. `ConsultantTurnState` gains `draft: dict` and `critique: dict | None` fields so nodes can pass results forward (LangGraph state is one shared, cumulative dict across a graph's nodes, not per-node-isolated).

## Decision 2 — Reuse `ConsultantTurnOutput` for `revise`; `ConsultantCritique` is judgment-only

`revise` must produce the exact same shape `ConsultationWorkflow.submit_message` already expects (`message`/`ready_to_finalize`/`proposed_payload_json`) — no reason to invent a second "final answer" schema. `critique`'s job is fundamentally different — a judgment *about* the draft, not a replacement for it — so it gets its own, narrower schema with no `message`/`ready_to_finalize` fields at all, keeping the two concerns from bleeding into each other.

## Decision 3 — Every new node needs its own Activity metadata (established pattern, re-confirmed against current docs)

Verified directly against the installed `temporalio` package's own `contrib/langgraph` README (not memory): *"Every node (Graph API) ... must be labeled with `execute_in`, set to either `"activity"` or `"workflow"`. This is required per node/task."* Both `critique` and `revise` need `metadata={"execute_in": "activity", "start_to_close_timeout": ..., "retry_policy": ...}` — matching the convention this file's own `_NODE_TIMEOUT`/`_NODE_RETRY` already established for `draft`, found the hard way (a graph with any unlabeled node raises `ValueError` outright, not a guess).

## Decision 4 — Cost/latency tradeoff, and what verification actually needs to prove

2 LLM calls per consultant turn in the common case (`draft` + `critique`), 3 when `critique` flags a real concern (+ `revise`). The consultation flow is synchronous request/response — `ConsultationWorkflow.submit_message` is a `workflow.update` that blocks until the full reply comes back (ADR 0005 decision 2) — so this adds real latency to *every* turn, not just the flagged ones. Accepted as a quality/latency tradeoff, not optimized away here (nothing to parallelize against — the draft was never shown to the user before critique runs anyway).

This codebase has never exercised a LangGraph conditional edge through Temporal's `LangGraphPlugin` before (both existing graphs are linear, single-node). Verification must empirically confirm **both branches** execute correctly against the real Temporal dev server, not just trust the plugin's documentation: a clean draft (critique passes, `revise` never runs) and a flagged draft (critique fails, `revise` runs, and *its* output — not the original draft — is what actually gets persisted as the turn).

## Decision 5 — A live step indicator, additive to the existing endpoint (not a replacement)

Reflection makes decision 4's latency problem worse without any way to show what's happening — today a consultant turn is a single blocking `POST /api/consultations/{id}/messages` call behind one generic "Thinking…" indicator (`consultation-chat.html`), and adding 2-3 sequential LLM calls per turn just makes that same silence longer. Fix: a small, additive live channel — the same shape ADR 0006 chose for debates (REST/request-response stays the source of truth; a side channel is purely a live nudge), not a replacement of the existing endpoint's contract.

- **New Redis channel**: `consultation:{session_id}:stream`. `draft`/`critique`/`revise` each publish `{"step": "draft" | "critique" | "revise"}` the instant they start — same mechanism as `debates/activities.py`'s `_publish` / `graphs.py`'s direct-publish pattern from ADR 0007 decision 2, mirrored into `consultations/`.
- **New endpoint**: `GET /api/consultations/{session_id}/stream`, using FastAPI's own native SSE support — verified directly against the installed `fastapi==0.139.2`'s docs (not memory or assumption): `fastapi.sse.EventSourceResponse`/`ServerSentEvent` ship in this version already, no new dependency. Subscribes to the Redis channel and relays each step event to the browser as a `ServerSentEvent`.
- **`POST /api/consultations/{id}/messages` is completely unchanged** — still one blocking call, still the same JSON response, still the same 400/409 error paths. The SSE stream carries no content and isn't a second source of truth; the frontend just updates its "Thinking…" label as step events arrive, and closes the SSE connection itself once the POST resolves (no "done" event needed on this channel — nothing consumes one, since the POST's own resolution is already the completion signal).
- **Ordering matters, not replay**: Redis pub/sub has no history (ADR 0006 decision 4 already established this for debates, same fact applies here) — the frontend must open the SSE connection *before* firing the `POST /messages` call, or it can miss the `draft` step event and sit blank until `critique` fires. This is the same class of gap that caused spec 0018/0019's ~2s blank-frame bug; called out here to get it right the first time rather than find it in verification again.
- **No per-turn correlation needed**: scoped to `session_id` alone, not a turn/message id. Verified directly in the code, not assumed: `consultation-chat.html:34`/`:36` already disable the message input and send button (`[disabled]="sending() || approving()"`), and `consultation-chat.ts:85` guards `sendMessage()` itself with the same `sending()` check — so there is never more than one consultant turn in flight per session, and every event on this channel can only ever belong to "the one thing currently happening."
- **Chosen over converting `POST /messages` itself into an SSE stream** (also viable — FastAPI supports SSE over POST directly): rejected for the same reason ADR 0006 kept REST endpoints unchanged for debates — strictly additive carries zero risk to the existing endpoint's working contract and error-handling paths, versus reshaping a currently-simple JSON endpoint into a stream that still needs to preserve those same error cases.

## What this doesn't cover

The debate-side graphs (`debates/graphs.py`) and their existing Redis/WebSocket streaming (ADR 0006/0007) — untouched, entirely separate infrastructure; specs 0020/0021's token-streaming split is a separate, orthogonal concern from this reflection pattern and isn't being combined with it here. Actual token-by-token streaming of the consultant's own drafted text (raised and explicitly deferred in this same conversation) — decision 5's SSE channel carries step names only, never message content. Any change to `ConsultationWorkflow`'s Update/signal shape, Activity-level retry policy in `workflows.py`, or the persisted `Turn` schema/table — the workflow still calls `graph(CONSULTANT_GRAPH).compile().ainvoke(state)` once per turn and reads `result["message"]`/`result["ready_to_finalize"]`/`result["proposed_payload"]` exactly as before; only what happens *inside* the graph changes.
