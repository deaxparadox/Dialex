# ADR 0007 — Two-phase generation for real token streaming

> Triggers the ADR bar on two counts: reopens ADR 0006 decision 1 (there, token streaming was ruled out because *combining* streaming with structured output was tested and found atomic — this decision changes the LLM call shape itself so the two are never combined again), and introduces a new cross-cutting pattern (LangGraph nodes in `graphs.py` publishing live events directly — previously an exclusively `activities.py` responsibility). Prompted by re-examining decision 12/spec 0001's original "stream token-by-token" requirement after confirming two things directly against current code, not memory: (a) Temporal itself was never the blocker — an Activity is ordinary Python; nothing stops it publishing to Redis mid-execution, independent of when it returns to the Workflow — and (b) `position`/`confidence`/etc. are still live, load-bearing fields today (displayed in `debate-thread.html:102`/`:135`; consumed for real by `check_convergence`, `orchestrator/app/debates/activities.py:135-147`), so this decision doesn't remove structured judgment, only changes *when* it's produced relative to the visible text.

## Decision 1 — Split every turn's LLM call into a streamed-content call + a judgment call, only where the schema actually mixes the two

Root cause (ADR 0006, re-confirmed by reading `orchestrator/app/debates/graphs.py` directly): `.with_structured_output(Schema).astream()` returns one atomic chunk because judgment fields (`position`, `confidence`, `decision`, `cited_argument_ids`...) can only be determined from the complete text — not because Temporal can't relay incremental data. Fix: stop asking one LLM call for both prose and judgment at once. Checked all three graphs' actual schemas (`orchestrator/app/debates/schemas.py`) — the split isn't uniform:

- **`_produce_argument`** (`ArgumentOutput`: `content` + `position`/`confidence`/`responds_to_argument_id`) — real split needed. Call 1: plain `.astream()` (no `with_structured_output`) for `content` only, publishing each chunk live. Call 2: `.with_structured_output(ArgumentJudgment)` — a new, narrower schema, judgment fields *only* — fed the case, prior arguments, and call 1's `content` verbatim as fixed prompt context (not asked to regenerate it).
- **`_produce_opening`** (`JudgeOpeningOutput`: `opening_statement` only) — **no split needed at all**. The entire schema is prose. Drop `with_structured_output` entirely, plain-stream the text, wrap the final accumulated string into `{"opening_statement": text}` in Python. Zero second LLM call for this graph — it was only ever wrapped in structured output to get a named field back, not because it needed judgment.
- **`_produce_closing`** (`JudgeClosingOutput`: `decision`/`confidence`/`reasoning`/`closing_summary`/`cited_argument_ids`) — real split needed. Call 1: plain `.astream()` for `reasoning` only (the prose a user would actually watch stream). Call 2: `.with_structured_output(ClosingJudgment)` — new schema with `decision`/`confidence`/`closing_summary`/`cited_argument_ids` — fed call 1's `reasoning` verbatim as fixed context.

**Why a new, narrower schema for call 2 instead of reusing the original schema:** if call 2's schema still included `content`/`reasoning` as fields, the model could produce a slightly different paraphrase of text the user already watched stream in — the persisted DB row and the live-streamed text could silently drift apart. Excluding the prose field from call 2's schema entirely, and passing call 1's actual output back in as fixed context, guarantees what's persisted is exactly what streamed — never a second, independent draft of it.

## Decision 2 — New WS event types, published from inside the graph node itself

`graphs.py`'s node functions gain a responsibility they've never had: publishing to `debate:{debate_id}:stream` directly (importing `redis_client`, the same mechanism `activities.py`'s `_publish` already uses) — because the streaming loop only exists inside the node function itself; nothing else has a handle on `.astream()`'s iterator.

Two new event types, matching `turn_started`'s existing shape (`agent_persona_id`, `stage`, `round_number`) so the frontend's existing turn-tracking extends rather than needing a second, parallel bookkeeping structure:

- `turn_token`: `{type, agent_persona_id, stage, round_number, token}` — one per chunk; the frontend appends each to that turn's accumulating live text.
- `turn_token_reset`: `{type, agent_persona_id, stage, round_number}` — published at the very start of the node function, before the streaming call begins (every entry, including the first — harmless there).

**`turn_token_reset` resolves the `retry` event ADR 0006 decision 1 explicitly deferred**, verbatim: *"it's deferred, not dropped; it becomes relevant again only if/when true token streaming is built."* That's now. `publish_turn_started` is called once from the Workflow, *before* the graph node runs (`workflows.py:75-80`/`:121-132`/`:187-192`). A Temporal-level retry of the node's own Activity (network blip, rate limit — the node's `metadata={"execute_in": "activity", ...}` in `graphs.py` gets its own retry behavior, invisible to the Workflow) would silently re-enter the node function and restart the stream from scratch, with nothing telling the frontend to discard whatever partial text it had already accumulated for that turn. `turn_token_reset` closes that gap directly.

No new REST/DB shape — same as `turn_started`, this is transient and never written to Postgres. The existing `argument_complete`/`opening_statement_complete`/`status_change` events remain the "go fetch the authoritative final row" signal (ADR 0006 decision 3, unchanged) — `turn_token` is a live preview only, fully replaced once the real row is fetched.

## Decision 3 — Accepted risk, not solved here: publish rate

No batching/coalescing of chunks is built in this pass. `.astream()`'s real per-chunk *rate* for this call shape hasn't been measured (ADR 0006 measured chunk *count*, for a different purpose, not rate). Verify actual chunks/sec against the real stack during implementation; add batching only if that measurement shows Redis/WS genuinely strained by it — not speculatively.

## Decision 4 — `start_to_close_timeout` unchanged for now, flagged to verify

`_NODE_TIMEOUT` (60s, `graphs.py:29`) now covers two sequential calls per split graph (stream + follow-up) instead of one. Not changed preemptively — verify real end-to-end wall time for the two-call sequence against the actual model during implementation before deciding whether 60s still has comfortable margin.

## What this doesn't cover

Consultation-workflow streaming (ADR 0005 already chose SSE, a different mechanism, for that surface — untouched here). Any change to `check_convergence` or the DB schema — `position`/`confidence`/etc. are computed and persisted exactly as before, just produced one LLM call later than today. The `WS /api/debates/{id}/stream` disconnect-leak bug (logged, still deferred) — orthogonal, not reopened by this.

## Sequencing

Three backend call sites (argument / opening / closing) plus one frontend consumer. Per this project's working pattern, each gets its own spec, implemented and verified against the real stack one at a time before the next starts — not one big-bang change.
