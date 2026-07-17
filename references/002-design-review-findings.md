# Design Review Findings — Multi-Agent Debate/Consensus System

> Full re-analysis against [003-base-conversation-annotated.md](./003-base-conversation-annotated.md) (the complete conversation, gap filled in). This supersedes the earlier version of this file, which was written against an incomplete copy and got several things wrong as a result — those corrections are folded in below rather than kept as a separate patch. Discussion starting point, not a decision — everything here should be talked through and explicitly locked (or rejected) before it goes into the PRD.

## Decisions locked so far

**1. Django + FastAPI split — confirmed, two services.** Not primarily a technical call: the user is deliberately using this project to move off monolith experience and learn microservice patterns/best practices, plus a preference for staying in Django where possible. FastAPI is kept specifically for the debate orchestrator because it's natively async and better suited to the network-heavy, concurrent LLM-call orchestration work. This means the split should be treated as a firm project goal, not just a technical trade-off to re-litigate later.

**2. Orchestrator durability — Temporal, not hand-rolled.** Explicit learning goal: ignoring crash-recovery teaches nothing, and hand-rolling a durable state machine is its own separate project that would stall the actual goal. Adopting Temporal changes the shape of the design: Temporal workflows must be deterministic, so anything non-deterministic (LLM calls, DB writes, timers) has to live in separate "Activities," not in the orchestration logic itself. Practical effect — the debate's round-by-round logic (`TurnStrategy`, convergence checks) becomes a **Temporal Workflow**; FastAPI's role narrows from "the orchestrator" to "the front door" — it starts workflows and relays live progress to Angular by querying the running workflow (Temporal's built-in signal/query mechanism), rather than owning the state machine directly.

**2a. Temporal deployment — self-hosted via Docker, not Temporal Cloud.** Deliberate choice to learn the operational pieces (server process, persistence store, worker scaling) rather than have them hidden behind a managed service. Practical shape: a small stack (Temporal server in dev/"auto-setup" mode + its own Postgres persistence database + Web UI), started from the official `temporalio/docker-compose` repo. **Temporal's Postgres is a separate database from the app's Postgres** — it's Temporal's internal workflow-history bookkeeping, not something that shares a schema with the Django-owned `Case`/`Debate`/`Argument` tables. Scale is a non-issue at this project's size (single-server self-host handles ~100 workflow executions/sec).

**3. Agent/reasoning framework — LangGraph + LangChain, not a hand-built `TurnStrategy`, not AG2/AutoGen.** Explicit "don't reinvent" call, and the user is already familiar with both tools. Chosen over AG2 (AutoGen's actively-maintained continuation — classic AutoGen itself is now in maintenance mode) specifically because LangGraph has an **official first-party Temporal integration plugin** with a documented division of responsibility, versus AG2's Temporal combination being community-discussed only. Division of labor: **Temporal stays the outer layer** — durable execution, the round-by-round loop, turn-selection heuristic (unchanged from decision 2) — while **LangGraph is the inner layer**, modeling the branchy reasoning *within* a single agent's turn (or the judge's opening/closing calls) as a small `StateGraph` run inside a Temporal Activity. LangChain is used freely inside Activities for the actual LLM calls/prompts — no overlap with Temporal, since it doesn't have its own persistence layer. **Important constraint carried forward: LangGraph's own checkpointer must not be relied on for crash recovery** — it isn't production-grade durability (no protection against double-resume), so Temporal remains the single source of truth for what happened; LangGraph's internal graph is expected to safely rerun from scratch whenever Temporal retries the Activity around it. Trade-off accepted: this project will not be how the user learns AutoGen — that's deferred to a separate, smaller exercise outside this build.

**4. Convergence detection gets a dissent-preserving signal — citation required on any position change.** The existing round-limit (`max_rounds`) + `NO_CONSENSUS` path is confirmed as-is (already in the design) and correctly handles "debate never converges" — but that's a different failure than groupthink/anchoring, where a debate *falsely* looks converged early because agents drifted toward the majority without a real reason, and the round limit never even triggers in that case since the debate exits normally. Fix: whenever an agent's `position` changes from its own previous round, it must cite the specific prior `Argument` (by another agent) that caused the change — reusing the same `responds_to`-style link already in the data model, not just free-text reasoning (which already exists via `content` but can't be programmatically checked). A position change with no citation, or a vague one, is a visible signal that the change wasn't earned, and can be surfaced (e.g. in the judge's closing summary, or by lowering the confidence in the convergence score) instead of silently counted as clean agreement. Practical side effect: this also forces agents to engage with a specific counter-point rather than getting away with generic restatement. Same mechanism extends to the two extra anchoring sources found (judge's opening-statement framing, `stance_seed` regression toward the mean) — both would also require a real citation to count as genuine movement.

**5. `Argument.position` is not a fixed database enum — validity is decided per debate/case type, not by the schema.** Confirmed by a third case type the user wants in v1 from the start: a "research debate" (user asks an open question, e.g. "Celery vs. Temporal for my app"; agents debate candidate answers). Across the three planned case types, `position`'s valid values are a different shape every time — `loan_approval` (approve/reject/uncertain), `pr_review` (approve/request_changes/comment), and `research_debate` (whatever candidate answers the specific question actually has — not knowable ahead of time, decided when the debate is set up). `Argument.position` should be a plain string column; what values are valid for a given debate is an application-level/case-setup concern, not a `choices=` constraint at the schema level.

**5a. New scope, confirmed for v1: a "debate consultant" role and a pre-debate clarification stage, for `research_debate` specifically.** Before a `research_debate` Case/Debate exists at all, a consultant agent has a back-and-forth with the user to pin down exactly what's being asked (understand actual intent, not guess), proposing a refined question back to the user for approval — regenerating and re-confirming if the question is under-specified, confirming as-is if the user's framing is already clear. Only once the user approves does an actual `Case`/`Debate` get created with the finalized question. This is a genuinely new role, distinct from both the arguing `AgentPersona`s and the judge: it talks *to the user*, not to other agents, and it runs *before* a `Debate` row exists — needs its own data model (something log-shaped, similar to `Argument`, for the clarification back-and-forth) and its own lifecycle stage ahead of `OPEN`. Not yet designed in detail.

**5b. New scope, confirmed for v1: a "preparation round" before arguing begins.** Participating agents do research (optionally with live web search) before the debate's first round, so arguments are grounded rather than purely parametric. Fits cleanly into the already-locked architecture: modeled as an extra node in each agent's per-turn LangGraph `StateGraph` (decision 3), running inside a Temporal Activity, once at debate start rather than every round. Not yet designed in detail — exact shape (per-agent research vs. shared research, what tools/search access, how findings get stored/cited) is open.

**5c. `CaseTypeConfig` — one shared, generic, per-case-type config drives every "pick one of N options" field, instead of hardcoding per-case-type UI/schema branches.** Realization while designing `HumanReview` (decision 8): "yes/no," "approve/deny," and "merge/request changes/reject" are all the same shape — pick one option from a list — and "comment only" (`research_debate`) is just that list being empty. One generic widget/field covers all of it; no per-case-type special-casing needed anywhere, in the schema or the UI. Concretely, a small Django-admin-managed model:
```
CaseTypeConfig
 ├─ type (unique string: "loan_approval", "pr_review", "research_debate", ...)
 ├─ position_options (JSON list, e.g. ["approve","reject","uncertain"]) — for Argument.position (decision 5)
 ├─ decision_options (JSON list, e.g. ["approve","deny"], or [] for research_debate) — for HumanReview.final_decision (decision 8)
```
Frontend renders buttons for whichever `*_options` list is non-empty for the field it's showing; an empty list means no buttons, just the comment box. Adding a fourth case type later is a new config row through the Django admin, not new UI code.

**6. `ConvergenceCheck.method` fixed to match the actual algorithm, plus a `signals` field for auditability.** The old three-way enum (`similarity|fixed_rounds|judge_poll`) didn't describe the real check (position stability + confidence-spread shrinkage + no-new-rebuttals + citation-on-change from decision 4) — it was drafted before the logic was finalized and never reconciled. Fix: `method` becomes a single accurate label (there's only one approach in use, not a choice between three), and a new `signals` field (JSON) stores the actual computed values for that check (was position stable, how much did spread shrink, were there uncited changes, etc.) — matching what the original convergence-check sketch already intended to return, and actually delivering the "auditable, show the real reason" goal the design claims.

**7. `DebateParticipant` gets a `persona_snapshot` (JSON) field, frozen at debate start.** The concern behind "hold persona model assignment constant for fair turn-strategy comparisons" isn't really solved by discipline alone, because `AgentPersona` is a live, editable row — a `Debate` only holds a foreign key to it, so if a persona's `model_config`/`system_prompt` changes after the fact (accidentally, via direct DB edit, whatever), old debates silently become unexplainable: you'd be reading Monday's argument against Wednesday's persona config, with no record anything changed. Fix: at the moment a debate starts, copy the participating persona's config onto its `DebateParticipant` row as a frozen snapshot — independent of whatever the live `AgentPersona` row says later. This both makes turn-strategy comparisons provably fair (diff the snapshots) and serves the project's own reasoning-transparency/auditability goal generally, not just for this one comparison case.

**8. Every debate always requires human review — no auto-executed verdicts, no confidence threshold.** Rejected a confidence-threshold escalation rule (e.g. "below 0.6, escalate") because it would require trusting the judge's self-reported confidence as well-calibrated enough to gate a real action, which isn't a safe assumption for an LLM's own number. Instead: a debate's `Verdict` is always a recommendation, never an auto-executed action — a human always reviews it before anything real happens (denying a loan, merging a PR). This also unifies all three case types under one rule instead of a special threshold just for the two with real-world actions: `research_debate` already worked this way (the user *is* the human in the loop), now `loan_approval`/`pr_review` do too.

**Final `HumanReview` fields:**
```
HumanReview
 ├─ id
 ├─ debate_id (FK, one-to-one) — the debate being reviewed
 ├─ reviewer_id (FK to User) — who reviewed it
 ├─ comment (text, required for every case type) — the human's own final note/reasoning
 ├─ final_decision (plain string, nullable) — button-selected from CaseTypeConfig.decision_options (5c), never typed; null when that list is empty (research_debate)
 ├─ reviewed_at (timestamp)
```
Kept entirely separate from `Verdict` — the AI's verdict (`Verdict.decision`, its own table) is never edited or overwritten by a human review; the two sit side by side, so both "what the AI recommended" and "what the human actually did" stay independently visible, permanently.

**9. FastAPI's view of Django's schema — generated via `sqlacodegen`, not hand-declared, not live reflection.** Rejected hand-writing/maintaining the table declarations by hand once a purpose-built tool already solves it. `sqlacodegen` (tables mode — plain Core `Table` objects, not a second ORM, consistent with the earlier DB-access decision) inspects Django's real schema and writes a committed `.py` file — no live DB round-trip at startup (unlike reflection/automap, which rebuild everything in memory on every run and write nothing to disk), and no manual upkeep (unlike hand-declaring). Regenerated and diffed against the committed version in CI, so any Django migration that isn't matched by a regeneration fails the build loudly instead of drifting silently. One discipline this requires: the generated file is never hand-edited (regeneration would silently wipe any manual changes) — custom query logic goes in a separate file that imports from the generated one.

**10. Debate consultant — persona-based, independent of `Debate`, back-and-forth conversation, approval is final (no revision after).** Unifies with a broader schema fix: `AgentPersona` gets a `role` field (`participant | consultant | judge`) — this also closes a gap that existed since the base conversation, where "the judge" made LLM calls but was never actually tied to a concrete persona row (name/system prompt/model). Now every LLM-driven role in the system — arguing participants, the consultant, the judge — lives in one table, distinguished by `role`, each swappable/reusable the same way (e.g. a "strict judge" vs. "lenient judge" persona). `Debate` gets a `judge_persona_id` (FK, `role="judge"`) to close that gap.

Data model for the consultant's own conversation, which happens *before* any `Case`/`Debate` exists:
```
ConsultationSession        ← exists BEFORE any Case/Debate does
 ├─ id
 ├─ case_type (which kind of debate this will become)
 ├─ status (OPEN, AWAITING_APPROVAL, APPROVED)
 ├─ consultant_persona_id (FK to AgentPersona, role="consultant")
 ├─ finalized_payload (JSON/text — set only once the user approves; becomes the Case's content)
 ├─ created_at, approved_at

ConsultationTurn           ← the back-and-forth log, same shape as Argument's event log
 ├─ id, session_id (FK), turn_number
 ├─ speaker (user | consultant)
 ├─ content (text)
 ├─ created_at
```
Once `status` becomes `APPROVED`, a real `Case`/`Debate` is created from `finalized_payload`; approval is final, no path back into the session afterward — `Case` keeps a reference to its originating `ConsultationSession` for traceability.

**Consultant applies universally, no per-case-type flag.** Considered gating it by case type (`research_debate` only) since that's the type with genuinely open-ended natural-language input — but rejected, because ambiguity isn't actually exclusive to that type: a loan case can carry an ambiguous free-text submitter note (e.g. "not sure how to treat the co-signer's business income"), and a PR-review request can have unclear review criteria (e.g. "check if this is ready to merge" — ready by what standard?). Case type doesn't predict where ambiguity shows up. Instead, the consultant runs for **every** case, every time, and self-determines its own depth — a fast path (one LLM call: "here's what I understood, confirm?") when the submission is already clear, or the fuller multi-turn negotiation when something's genuinely ambiguous. This was already implicit in how the consultant was originally described (it was always meant to recognize when a question needs no further rounds), just not yet wired in as the universal default rather than a research-debate-specific behavior. No `requires_consultant` flag needed on `CaseTypeConfig` as a result — one less thing to configure per type.

**11. Preparation round — independent per-agent research, real web search, findings stored and citable.** Three sub-decisions: (a) each agent researches independently rather than sharing one pass — more realistic (mirrors distinct personas prioritizing different information), accepted the extra cost; (b) real live web search, not deferred; (c) findings are stored and citable, consistent with the project's reasoning-transparency premise — otherwise an agent could say "recent data shows X" with no traceable record of what it actually found.

New entity:
```
ResearchFinding
 ├─ id
 ├─ debate_id (FK), agent_persona_id (FK) — whose research this is, same shape as Argument
 ├─ query (text) — what was searched
 ├─ source_url, source_title (text, nullable)
 ├─ summary (text) — the agent's takeaway from that source
 ├─ created_at
```
`Argument` gets a new `cites_research_finding` (FK to `ResearchFinding`, nullable), kept separate from `responds_to` (FK to `Argument`) rather than unified into one generic citation mechanism — the config-driven/generic approach (`CaseTypeConfig`) earns its cost for things with an open-ended, per-case-type value set (position/decision vocab); "what can be cited" is a small, fixed set of two kinds, so two explicit nullable FKs is simpler and doesn't need that treatment.

Runtime: independent research runs as its own Temporal Activity per persona (not shared), once at debate start (decision 5b), calling a LangChain search tool (specific provider a build-time choice). Flagged for later: the search API key must fail loudly at startup if missing, per the project's own no-silent-fallback rule — never silently skip research and let agents argue ungrounded without anyone noticing.

**12. Real-time streaming — Redis pub/sub, for both per-debate streaming and general notifications.** Everything the user sees should feel live: agent arguments stream token-by-token as they're generated, research progress streams as it happens (source list first, then each source shown being processed), and notifications (see decision 17) push instantly — not silent "loading" states.

**Revised from an earlier plan to use Temporal Workflow Streams.** That mechanism works and is well-suited to this (Temporal's own docs demonstrate almost exactly this use case) — but it's Public Preview as of 2026, and given this is public-facing, preferring a mature, battle-tested primitive over a preview feature is the right call. That trade-off only got easier once Redis was already needed anyway for general notifications (decision 17) — the "avoid a new service" reason to prefer Workflow Streams stopped applying once Redis was coming into the stack regardless.

**Mechanism:**
- Inside an Activity (LLM call for an argument, or a research step), tokens/progress events `PUBLISH` to a channel named `debate:{debate_id}:stream` — one channel per debate. This is fine at any real scale: the number of concurrently active debates is naturally bounded, and unlike Postgres `LISTEN` (rejected for this reason — see decision 17's history), a Redis connection isn't pinned/expensive per channel, so many channels with few subscribers each is exactly what Redis is built for.
- FastAPI subscribes to a debate's channel the moment its WebSocket connection is accepted (scoped to that one connection/debate) and relays events straight through: read from the channel → write to the WebSocket.
- Only the Activity's *final* result (the complete argument text, the finished `ResearchFinding` rows) is what actually gets persisted — unchanged from decisions 4 and 11; the streamed events are purely a live view of work already happening, never the durable record.
- Retry signaling, unlike Workflow Streams, isn't automatic — this needs to be hand-built: when Temporal retries a failed Activity, explicitly publish a `RETRY` event on the debate's channel so the frontend clears stale partial output before the next attempt's tokens arrive. Small, explicit piece of wiring, now a real to-do rather than something the platform handles for free.
- Multiple simultaneous viewers of the same debate: each WebSocket connection subscribes independently to the same channel — Redis handles multiple subscribers on one channel natively, no fan-out logic to build.

**Channel naming, not database index, is what separates traffic — and numbered databases are avoided entirely.** Verified rather than assumed: Redis pub/sub completely ignores the numbered-database concept — a `PUBLISH` on database 10 is heard by a `SUBSCRIBE` on database 1 regardless, so DB index was never going to provide isolation here. Separation comes from channel names instead (`debate:{id}:stream`, `app_notifications` — decision 17). Numbered databases are skipped entirely, even for any other future Redis use (e.g. caching): they share memory/CPU/connection pool with no real isolation, and Redis Cluster mode doesn't support them at all (`SELECT` doesn't work — only database 0 exists), so anything built on DB-index separation would have to be redone as key-prefix separation the moment this ever needed to scale to a cluster. Key/channel-prefix namespacing within database 0 from the start avoids that rework.

**13. Authentication — access token in memory, refresh token in an HttpOnly/Secure/SameSite cookie.** Confirmed as the current (2026) standard pattern for SPA auth, not just a reasonable guess: XSS can't steal a token from `localStorage` because none lives there, and can't read the refresh cookie either. Locked alongside it: short access-token lifetime (5–15 min), refresh-token rotation (a new one issued each use, so a stolen refresh token gets invalidated the moment the real user's next request goes through), and the refresh cookie scoped specifically to the refresh endpoint with `SameSite=Strict` (neutralizes CSRF, which only matters for that one endpoint). Fits the existing split: Django (`simplejwt`) issues, FastAPI verifies independently via a shared signing key — no callback to Django needed per request.

**13a. WebSocket authorization — same JWT, plus an explicit per-debate ownership check.** Real gap otherwise: nothing was stopping any authenticated (or even unauthenticated) user from opening `WS /debates/{id}/stream` for a debate that isn't theirs, just by knowing/guessing the ID — a genuine privacy leak in a multi-user system. Fix, two parts: (1) since browsers can't set custom headers when opening a WebSocket, the access token has to ride along a different way — via the WebSocket subprotocol field (preferred, avoids the token leaking into server access logs) rather than a query parameter (simpler, but logs it in plaintext URLs); (2) verifying the token only proves *who's connecting*, not that they're *allowed to watch this debate* — FastAPI needs a second, explicit check that the verified user actually owns (or has review permission on) that specific debate before accepting the subscription. Authentication and authorization are two separate checks here, and both are required.

**14a. Convergence position-stability for free-text positions (`research_debate`) — accepted as a known limitation, not fixed for v1.** Recap of the gap: the literal-equality check for "did the position change" can misfire when an agent rephrases the same stance differently round to round (decision 4/finding 5's follow-up). Decided not to add the previously-proposed fix (consultant also negotiates a small fixed candidate-answer set per debate) for v1, because the actual damage is already bounded by decisions already locked: worst case, a debate looks less "stable" than it really is, runs extra rounds, eventually hits `max_rounds` → `NO_CONSENSUS`, and the judge still produces an honestly lower-confidence verdict — which a human always reviews anyway (decision 8) and can judge correctly from the actual argument text even where the structured `position` field didn't capture it cleanly. Failure mode is "runs longer / under-reports confidence sometimes," not a silent safety hole, so the human-review backstop already absorbs the real risk. Noted as a future improvement to revisit if it turns out to matter once the system is actually running, not a v1 blocker.

**14. Research query safety — a per-case-type prompt guardrail on `CaseTypeConfig`.** Real risk otherwise: a `loan_approval` case's payload likely contains a real applicant's financial details, and unrestricted web search could end up searching for a real person's personal information. Fix: `CaseTypeConfig` gets a `research_guardrail_prompt` field — text appended to the research Activity's system prompt per case type (e.g. for `loan_approval`: research general industry benchmarks/underwriting context, never the applicant's own identifying details). Known limitation, accepted for v1: this is a prompt-level guardrail, not a hard technical block — an LLM can still occasionally ignore instructions. A harder guarantee (e.g. stripping identifying fields out of what the research step can even see) is future hardening, not a v1 blocker.

**15. `NO_CONSENSUS`-parallel gap: what `Debate.status = FAILED` means, and that it must always notify someone.** Recap of the gap: `FAILED` already existed in the original lifecycle (`OPEN, ARGUING, CONVERGING, JUDGED, NO_CONSENSUS, FAILED`) but nothing defined when it triggers or who finds out. Resolved as part of decisions 16–17 below: technical failures get the same "always surfaces to a human" treatment `NO_CONSENSUS` already gets via `HumanReview` (decision 8) — just via the notification system instead, since there's no verdict to review.

**16. Observability — OpenTelemetry across Django, FastAPI, and Temporal; structured logging on the frontend shipped to the backend.** Chosen specifically because it's swappable later without rework: OTel separates instrumenting code from where the data goes, so this project can start with a local rotating file (`RotatingFileHandler`, 10MB, matching the user's original ask) and later point the same instrumentation at an enterprise backend (Datadog, Honeycomb, whatever) with no code changes. Concretely: Django and FastAPI get OTel auto-instrumentation (also covers SQLAlchemy, `requests`, `psycopg2` for free); Temporal gets its official Python interceptor (`temporalio.contrib.opentelemetry.TracingInterceptor`) so Workflow/Activity executions are traced the same way as everything else — one consistent system instead of three separate logging setups. Frontend correction to the original proposal: browsers can't rotate a local file, so Angular's job is a structured `LoggerService` (JSON, tagged with user/session/timestamp) that *ships* logs to the backend; rotation happens once they land server-side, not in the browser.

**17. Notification system — one shared UI, two delivery paths, a persisted record, and Redis pub/sub for the live push.** Debate-lifecycle events (research starting, debate starting/ending, consultation completed) ride the per-debate Redis channel from decision 12 as additional event types — no separate transport. Auth-flow and general backend failures aren't tied to a specific debate, so they go through normal HTTP error handling (an Angular interceptor) into the same notification UI — different plumbing, same rendering component. Failures always notify (never silent) — dev environments show technical detail, production shows a safer generic message, but something always surfaces either way.

**Why this needs a persisted record, not just a live push:** a purely live/WebSocket-pushed notification only reaches someone currently connected — and since debates are long-running, durable Temporal workflows *by design* (the entire point of decision 2 was that they don't need the initiating client to stay connected), a user disconnecting mid-debate and something failing in that window is normal expected usage, not a rare edge case. Fix: a persisted `Notification` record (user, type, message, related case/debate, read/unread, created_at) — created regardless of whether anyone's watching, delivered instantly if they are, but still sitting in a notification inbox for them to find later if they weren't.

**Live-delivery mechanism, decided across a few iterations:** first considered Postgres `LISTEN`/`NOTIFY` (no new service, reuses the DB Django already owns) — but rejected once the scaling mechanics were worked through: `LISTEN` permanently pins a Postgres connection, so one-channel-per-user would mean one dedicated long-lived connection per concurrently-connected user, which runs into Postgres's connection ceiling fast. Settled on **Redis pub/sub instead** (decision 12), general and cross-cutting to match: one shared channel (`app_notifications`, not per-user), carrying a small payload (e.g. `{"user_id": ..., "notification_id": ...}`); every FastAPI worker subscribes to that one channel and does the per-user routing itself in memory (checking which WebSocket, if any, is open for that user on that worker) — so connection/subscription count scales with the number of worker processes, not the number of users. This also solves multi-worker fan-out for free: if a user's WebSocket happens to be on a different worker than the one that received the event, that worker's own subscription to the same channel means it gets the same broadcast and can forward it independently.

## What's solid, no changes suggested

- The `TurnStrategy` abstraction (sequential/parallel/judge-directed as swappable strategies) is the right shape — matches how established multi-agent frameworks handle the same problem (see finding 4).
- Argument history as an append-only, DAG-shaped event log (`responds_to`) rather than a flat chat array — correct, and it's what makes the judge's "who rebutted whom" transparency story possible.
- Structured `position + confidence` fields for convergence checking (instead of embedding/text similarity) — cheaper and auditable.
- Judge-as-moderator lifecycle (opening statement → silent during rounds → one closing call producing `Verdict` + `closing_summary` together) is a clean design: exactly 2 judge LLM calls per debate regardless of turn strategy, which is what makes the three turn-strategies comparable on cost.
- Judge-directed routing via cheap heuristics (unspoken-this-round, rebutted-but-unanswered, widest dissent from mean, round-robin fallback) instead of an LLM call every turn — correctly reasoned: judgment quality should matter for the verdict, not for scheduling, and it protects the cost-comparability goal.
- DB access pattern (Django owns all migrations/schema; FastAPI accesses the same Postgres tables via SQLAlchemy Core + async engine + asyncpg, never running its own migrations) — a real middle path between raw SQL and a second competing ORM, and it avoids duplicating `auth_user`.
- Forced `cited_arguments` on `Verdict` (structured output/tool calling, not free narration) — the mechanism that actually makes "reasoning transparency" real instead of a claim.

## 1. Claim that's stale: Django async ORM

**Original claim:** Django's async ORM support (`aget`, `acreate`, etc.) is "newer and still has rough edges," used as a main reason to split into Django (CRUD) + FastAPI (orchestrator).

**Current status:** As of **Django 5.2 (2026)**, `.aget()`, `.acreate()`, `.afilter()`, `.aall()` etc. are stable across all database backends. The rough-edge era is largely over.

**Remaining real gap:** Transactions still don't work in async mode — any transactional write has to drop into `sync_to_async()`.

**Source:** [Django async docs](https://docs.djangoproject.com/en/6.0/topics/async/), [Django 5.x 2026 async guide](https://softaims.com/blog/django-5-new-features-async-guide-2026)

**Discussion point:** Doesn't invalidate the split (which was reconfirmed independently — see finding 2), but the original reasoning for it was weaker than presented.

## 2. Django Channels was never considered — and now looks genuinely unnecessary

Channels exists for ASGI + WebSockets + long-running async work *inside* the Django process, and was never raised as an option. Now that the full conversation is visible, the WebSocket decision is explicit: **FastAPI hosts the live per-debate stream** (`ws://.../debates/{id}/stream`); Django's REST API is only for history/CRUD (past debates, case submission, persona management). Nothing described anywhere in the design needs Django-side real-time push.

**Source:** [Django Channels vs WebSockets — Ably](https://ably.com/topic/django-channels-vs-websockets-whats-the-difference), [Real-time Communication with WebSockets in FastAPI and Django Channels — Leapcell](https://leapcell.io/blog/real-time-communication-with-websockets-in-fastapi-and-django-channels)

**Discussion point:** This is stronger than "worth considering" now — if nothing on the Django side needs WebSockets, Channels + a Redis channel-layer is a dependency with no job. Worth an explicit "we're not using Channels" confirmation rather than leaving it ambiguous.

## 3. Celery critique is right, but its replacement quietly reinvents a known tool

**Original claim:** Celery isn't ideal for stateful multi-turn orchestration — correct. Proposed replacement: "asyncio tasks + Redis/Postgres-backed state machine for durability."

**Issue:** That replacement is, functionally, hand-rolling what **Temporal** already provides: durable execution, automatic retry, replay, and a debug UI — purpose-built for a "planner → parallel step → verifier" shape like this orchestrator. The base conversation never revisits this once the DB-access pattern was settled.

**Source:** [Orchestrating AI Tasks with Celery vs Temporal](https://dasroot.net/posts/2026/02/orchestrating-ai-tasks-celery-temporal/), [Temporal for AI agents](https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal)

**Discussion point:** Still a genuine build-vs-adopt decision, untouched by anything in the completed conversation.

## 4. This problem space already has frameworks

LangGraph (conditional-edge graphs) and AutoGen/AG2 (`GroupChat` with a speaker-selector) already solve turn-taking and multi-agent conversation state — described as "two lines of config" for the debate pattern in AutoGen.

**Source:** [LangGraph vs CrewAI vs AutoGen 2026 guide](https://dev.to/pockit_tools/langgraph-vs-crewai-vs-autogen-the-complete-multi-agent-ai-orchestration-guide-for-2026-2d63), [Multi-Agent Orchestration Survey — MDPI](https://doi.org/10.3390/fi18060326)

**Resolved — see decision 3.** LangGraph adopted, layered under Temporal (Temporal = outer durable loop, LangGraph = inner per-turn reasoning graph). AG2/AutoGen considered and deliberately set aside for this project.

**Discussion point:** Legitimate to build custom if the goal is learning distributed coordination, not shipping fastest — confirm that's still the goal before locking the PRD.

## 5. Convergence detection can't distinguish consensus from groupthink — and the completed design adds two more anchoring sources

**The original gap:** position stability + shrinking confidence spread + no new rebuttals fire identically whether agents *genuinely converged* or *anchored on each other and stopped disagreeing* — the "degeneration of thought" failure mode documented in multi-agent debate research.

**Now that the full design is visible, two more anchoring sources need the same scrutiny:**
- **The judge's opening statement.** It "states what convergence will look like for this debate" *before any argument happens*. If arguing agents receive that framing as context, the judge is pre-seeding what a "resolved" debate looks like — a subtler anchor than agents copying each other mid-round, but the same failure mode. Whether agents even see the opening statement (vs. it being purely user-facing narration) isn't specified.
- **`DebateParticipant.stance_seed`.** An "optional initial bias" per agent is a good feature (e.g. a risk-averse vs. growth-focused persona), but if a seeded agent's position drifts toward the group mean over rounds, that can look identical to genuine convergence in the position-stability/confidence-spread signals, when it's actually just regression toward an artificial seed rather than independent agreement.

**Why it matters more here than average:** for loan approval, a confidently-converged-but-wrong verdict is worse than an honest "no consensus, low confidence" one.

**Discussion point:** Need at least one dissent-preserving signal (e.g., did a position change cite a specific counter-argument, or just drift) before trusting the convergence score on real decisions — this was true before the gap was filled and remains true now.

**Source:** [Multi-Agent Orchestration Survey — MDPI](https://doi.org/10.3390/fi18060326) (Liang et al. 2023 "degeneration of thought," Du et al. 2023 convergence dynamics in parallel debate)

**Resolved — see decision 4.** Citation-required-on-position-change adopted as the dissent-preserving signal, covering mid-debate anchoring, opening-statement framing, and `stance_seed` regression. The existing `max_rounds`/`NO_CONSENSUS` ceiling is confirmed as the separate (and already-adequate) fix for "never converges."

## 6. New: `Argument.position` enum may not generalize across `Case.type`

`Case.type` is explicitly multi-domain (`loan_approval, pr_review, ...`), but `Argument.position` is a single fixed vocabulary (approve/reject/uncertain + confidence). That fits loan approval cleanly. It's a worse fit for the PR-review example named in the original pitch — "approve / request changes / comment" isn't the same shape as "approve/reject/uncertain," and future case types may need yet another vocabulary.

**Discussion point:** Either commit to `position` as a fixed three-way enum and accept that new case types must be shoehorned into it, or make the position vocabulary part of `Case.type`'s configuration (a small schema addition) before more case types get built against it. Cheap to fix now, expensive to migrate later since `Argument` is an append-only event log.

**Resolved — see decisions 5, 5a, 5b.** A third v1 case type (`research_debate`, with open-ended user-defined candidate positions) confirms this decisively: `position` is a plain string, validity decided per debate/case setup, not a schema-level enum. This case type also introduces two new not-yet-designed subsystems: a debate consultant (pre-`Debate` clarification with the user) and a preparation/research round before arguing.

## 7. New: `ConvergenceCheck.method` enum doesn't match the algorithm that was actually designed

The data model's `ConvergenceCheck.method` field lists `similarity | fixed_rounds | judge_poll`. The convergence logic actually designed (position stability + confidence-spread shrinkage + no-new-rebuttals, combined into one arithmetic score) doesn't correspond to any single one of those three values — "similarity" was explicitly rejected in favor of structured signals, and "judge_poll" was ruled out per-round for cost reasons. This looks like the `method` enum was drafted before the convergence logic was finalized and never reconciled.

**Discussion point:** Small schema fix, but worth catching before migrations are written — `method` should describe the multi-signal check that's actually implemented (or be replaced with a `signals` JSON column reflecting exactly what `check_convergence()` returns).

**Resolved — see decision 6.** `method` becomes a single accurate label; a new `signals` JSON field stores the actual computed values per check.

## 8. New: heterogeneous `AgentPersona.model_config` threatens the cost-parity goal used to justify judge routing

The stated reason for keeping judge-directed routing cheap (heuristic, not per-turn LLM calls) was to keep all three turn strategies comparable in cost — otherwise you're comparing "adaptive but expensive" against "simple but cheap" instead of isolating coordination logic. But `AgentPersona.model_config` lets each persona independently pick "which LLM, temp, etc." If personas in a judge-directed debate happen to use pricier models than personas in a sequential debate, the same cost-comparability problem re-enters through a different door.

**Discussion point:** If turn-strategy comparison is a real goal (not just a launch decision), persona model assignment needs to be held constant across the strategies being compared, or cost needs to be tracked per-debate so comparisons can normalize for it.

**Resolved — see decision 7.** `DebateParticipant.persona_snapshot` (JSON), frozen at debate start, makes comparisons provably fair and keeps every past debate independently explainable regardless of later persona edits.

## 9. New: no defined downstream action for a `NO_CONSENSUS` / low-confidence verdict

The design correctly has the judge produce a verdict even when `max_rounds` is hit without convergence, with confidence reflecting the disagreement rather than pretending it converged. But nothing in the data model or lifecycle says what happens *next* for a loan-approval case that lands here — auto-deny, auto-approve-with-flag, or escalate to a human underwriter. For a real financial decision, this is a product gap, not just a technical one.

**Discussion point:** Needs a decision before the PRD is written, since it affects whether `Case`/`Debate` needs an escalation/review-queue concept at all.

**Resolved — see decision 8.** No confidence threshold, no auto-execution — every debate always requires human review via a new `HumanReview` record (fields being designed next).

## 10. Partially open: SQLAlchemy reflection vs. hand-declared tables, and nothing enforces schema sync

The DB-access pattern (Django owns migrations, FastAPI reads/writes via SQLAlchemy Core) is decided. What's *not* decided: whether FastAPI reflects tables live at startup (`autoload_with=engine` — convenient, but a live DB round-trip and schema-drift risk at boot) or hand-declares matching `Table` objects (more explicit, was flagged in-conversation as "probably the better move for production" but never chosen). Either way, the stated discipline — "FastAPI never runs migrations, never writes to a table Django doesn't know about" — is a process rule with no described enforcement mechanism (e.g. a CI check diffing Django's migration state against FastAPI's table declarations).

**Discussion point:** Pick reflection vs. hand-declared now; if hand-declared, decide how drift gets caught before it becomes a production bug instead of relying on discipline alone.

**Resolved — see decision 9.** `sqlacodegen` (tables mode) generates the committed `Table` declarations from Django's real schema; CI regenerates and diffs against the committed file to catch drift.

## Summary of decisions to lock before PRD

1. ~~Confirm Django+FastAPI split~~ — **locked, see "Decisions locked so far" above.**
2. ~~Temporal vs. hand-rolled state machine~~ — **locked (Temporal), see "Decisions locked so far" above.**
3. ~~Build custom vs. adopt a framework~~ — **locked (LangGraph + LangChain, layered under Temporal), see "Decisions locked so far" above.**
4. ~~Dissent-preserving signal for convergence detection~~ — **locked (citation-required-on-position-change), see "Decisions locked so far" above.**
5. ~~Whether `Argument.position` needs to vary by `Case.type`~~ — **locked (plain string, validity decided per debate/case type, not schema-enforced), see decision 5 above.**
6. ~~Fix `ConvergenceCheck.method`~~ — **locked (single accurate label + new `signals` JSON field), see decision 6 above.**
7. ~~Persona model assignment for fair turn-strategy comparisons~~ — **locked (`DebateParticipant.persona_snapshot` frozen at debate start), see decision 7 above.**
8. ~~Downstream action for `NO_CONSENSUS`/low-confidence verdicts~~ — **locked (always human review, no auto-execution), see decision 8 above.**
9. ~~SQLAlchemy reflection vs. hand-declared tables~~ — **locked (`sqlacodegen`-generated tables, CI-diffed against Django's schema), see decision 9 above.**
10. ~~Design the debate consultant's data model and pre-`OPEN` clarification lifecycle stage~~ — **locked (`ConsultationSession`/`ConsultationTurn`, `AgentPersona.role`, universal fast-path/full-negotiation), see decision 10 above.**
11. ~~Design the preparation/research round~~ — **locked (independent per-agent research, real web search, `ResearchFinding` stored and citable via `Argument.cites_research_finding`), see decision 11 above.**
12. ~~Design the `HumanReview` record's fields~~ — **locked (`comment` + button-selected `final_decision` via `CaseTypeConfig`), see decisions 8 and 5c above.**
13. ~~Real-time streaming for agent arguments and research progress~~ — **locked (Temporal Workflow Streams, no Redis), see decision 12 above.**
14. ~~Authentication approach~~ — **locked (access token in memory, refresh token in HttpOnly/Secure/SameSite cookie, rotation), see decision 13 above.**
15. ~~Research query safety/privacy guardrail~~ — **locked (`CaseTypeConfig.research_guardrail_prompt`, prompt-level for v1), see decision 14 above.**
16. ~~What `FAILED` means and who finds out~~ — **locked (always notifies, via decisions 16-17), see decision 15 above.**
17. ~~Observability/logging strategy~~ — **locked (OpenTelemetry across Django/FastAPI/Temporal, local rotating file today, swappable later; structured logger shipping to backend on the frontend), see decision 16 above.**
18. ~~Notification system~~ — **locked (shared UI, two delivery paths, persisted `Notification` record so failures surface even when nobody was watching live), see decision 17 above.**
19. Cost controls for LLM/search spend per debate — **explicitly deferred**, not blocking the PRD; revisit once the system is up and running.
