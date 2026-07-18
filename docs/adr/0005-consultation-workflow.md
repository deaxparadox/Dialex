# ADR 0005 — Consultation workflow: interactive Temporal workflow via Updates

> Written before any workflow/activity code, per this repo's CLAUDE.md. Triggers the ADR bar on two counts: a genuinely new cross-cutting pattern (a long-running, externally-signaled Temporal workflow — every prior workflow, `DebateWorkflow`, runs start-to-finish unattended) and a data-model shift (`CaseTypeConfig` gains default persona/round-count config). Scope: **backend only** — `ConsultationWorkflow`, its Update handlers, the consultant LangGraph node, and approval logic that creates a real `Case`+`Debate`. The frontend chat UI is a separate follow-up spec, mirroring how spec 0005 (`DebateWorkflow`) landed and was curl-verified before spec 0006 wired any UI to it.

## Why this needed its own ADR, not just a spec

`DebateWorkflow` (ADR 0004) is a closed loop: started once, runs unattended through however many rounds, ends. `ConsultationWorkflow` is fundamentally different — it's a back-and-forth with a human who might reply in five seconds or five hours, and the workflow has to sit parked between turns waiting for the next one. That's a different interaction shape, not just a new feature on the existing shape, so it gets its own architectural decision rather than silently reusing `DebateWorkflow`'s pattern.

## Decision 1 — No LangGraph checkpointer, reaffirmed

Same conclusion as ADR 0004/spec 0005, restated here because it came up again and is worth having on record for this workflow specifically, verified against Temporal's own docs rather than assumed: *"Temporal handles durability, so third-party checkpointers (like PostgreSQL or Redis) are not needed. When your LangGraph code requires a checkpointer (for example, if you're using interrupts), you can use `InMemorySaver`."* ([Temporal LangGraph integration docs](https://docs.temporal.io/develop/python/integrations/langgraph)). Conversation history for a consultation session is reconstructed from Postgres (`ConsultationTurn` rows) before every graph invocation — the same shape `fetch_arguments` already uses for debates, applied to a different table. No `langgraph.checkpoint.*` import appears anywhere in this milestone.

## Decision 2 — Turns are delivered via Temporal Update, not signal+poll

Considered and rejected: copying `DebateWorkflow`'s exact delivery shape (`start_workflow` + signal for input + a separate poll endpoint for the frontend to notice replies). That shape fits an unattended background process; it fits a live dialogue badly — it stacks polling latency on top of generation time, needs a separate poll loop and an explicit "turn failed" state for the poller to detect, and can't hand an error straight back to whoever sent the message.

Chosen instead: **`@workflow.update` handlers**. Verified against Temporal's docs (not assumed): *"Updates are synchronous, tracked write requests. The sender of the Update can wait for a response on completion or an error on failure"* ([Temporal message-passing docs](https://docs.temporal.io/sending-messages)). Concretely: `handle.execute_update("submit_message", text)` blocks the caller (a normal FastAPI request) until the update handler — which runs inside the already-durable workflow, executing Activities with the same retry/timeout/tracing guarantees `DebateWorkflow` gets — finishes and returns the consultant's reply, or raises an error that surfaces directly back to the HTTP caller. Same external contract as an ordinary synchronous API call; Temporal's durability underneath is what changes, not the caller-facing shape.

**Workflow lifecycle consequence:** `ConsultationWorkflow.run()` must park on `workflow.wait_condition(...)` until the session reaches a terminal state (`APPROVED` or `FAILED`) — a workflow only accepts Updates while still open, so `run()` returning early would mean `approve` (or a later `submit_message`) simply can't reach it. Approval setting the terminal condition is also what naturally enforces "approval is final, no revision after" (decision 10): once the workflow completes, no further Update can be delivered to it at all — not a guard clause, a structural consequence of workflow completion. `submit_message` after approval fails at the Temporal-client layer; the router translates that into a clean `409`, not a raw exception.

## Decision 3 — Streaming deferred; SSE flagged as the likely future direction for chat specifically

Full reply per Update call, no live token-by-token output this milestone (matches the already-deferred Redis/WebSocket live-streaming milestone, decision 12 — unaffected by anything here, still owed to debates separately). If/when consultation chat gets streaming later, Server-Sent Events is the leading candidate rather than decision 12's Redis+WebSocket approach — a chat reply has exactly one listener (the person mid-conversation), unlike debate-argument viewing, which needs to support multiple viewers and reconnect/catch-up. Not decided now, just recorded so the reasoning isn't re-derived from scratch later.

## Decision 4 — Native async throughout

Matches the existing orchestrator convention (`core/db.py`'s `AsyncEngine`/asyncpg, `.ainvoke()` everywhere in `graphs.py`) — no exception for the new `consultations/` package. Every new endpoint, query function, and Activity is `async def`; no sync/blocking library gets introduced anywhere in the request or Activity path.

## Decision 5 — `CaseTypeConfig` gains default persona/round-count config (the actual schema change)

Nothing today decides *which* personas argue a case or who judges it — that's 100% manual, admin-picked per `Debate` row. For approval to create a real, usable `Debate` without a human in the loop, that decision has to be automatic. Extending `CaseTypeConfig` — already "the one place per-case-type config lives" (`position_options`, `decision_options`, `research_guardrail_prompt`) — is the consistent, minimal-new-concept way to do it, rather than inventing a second, different selection mechanism:

- `default_consultant_persona` (FK → `AgentPersona`, `limit_choices_to={"role": "consultant"}`, **required**, no null) — every case type must have a consultant configured, matching decision 10's "runs for every case, every time." A `CaseTypeConfig` missing this simply can't be saved — fail-fast by construction, not a silent fallback.
- `default_participant_personas` (M2M → `AgentPersona`, `limit_choices_to={"role": "participant"}`) — the debate's participants, frozen into a `DebateParticipant.persona_snapshot` at approval time (same freezing already done for admin-seeded debates, decision 7). Not enforced at the DB level to be non-empty (Django M2M can't express that) — the approval Activity checks it explicitly and fails loudly (not a silently-broken zero-participant `Debate`) if empty.
- `default_judge_persona` (FK → `AgentPersona`, `limit_choices_to={"role": "judge"}`, **required**, no null) — same fail-fast reasoning as the consultant FK.
- `default_max_rounds` (`PositiveIntegerField`, default `3`) — a pure behavioral-tuning knob with a genuinely safe default (CLAUDE.md's explicit carve-out from the no-silent-fallback rule), not a required-config item.

One migration on the `cases` app. `Debate.turn_strategy` is hardcoded to `"sequential"` at creation — the only strategy `DebateWorkflow` actually implements (ADR 0004's scope), not a new per-case-type field.

## Decision 6 — `ConsultationSession.Status` gains `FAILED`

`DebateWorkflow` has a `mark_failed` Activity + top-level try/except for exactly this reason; `ConsultationSession.Status` (`OPEN`/`AWAITING_APPROVAL`/`APPROVED`) has no equivalent today. Adding `FAILED` gives `ConsultationWorkflow`'s top-level exception handler somewhere real to put a session that hit an unrecoverable error, instead of leaving it silently stuck `OPEN` forever. No `ABANDONED`/cancel state added — nothing in this backend-only milestone triggers one (no frontend "cancel" button exists yet), so that's left as real future scope, not built speculatively now.

## What this doesn't cover

The frontend chat UI (separate follow-up spec, per the split confirmed for this milestone) — case-type picker, message thread, approve button, routing. Redis/WebSocket live streaming for either debates or consultations (decision 12, still not built, unaffected by this ADR). A way to cancel/abandon an in-progress consultation. Editing a `proposed_payload` before approving (approval uses the latest consultant-proposed payload verbatim). Cost controls (decision 19, already a tracked gap).
