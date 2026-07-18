# ADR 0004 — Temporal + LangGraph debate orchestration

> Written before any workflow/activity code, per this repo's CLAUDE.md. Covers a new dependency category (Temporal Python SDK, LangGraph, LangChain, an LLM provider SDK) and a cross-cutting pattern (the Workflow/Activity boundary and how LangGraph graphs are registered with a Temporal Worker) — both trigger the "genuine architecture decision" bar for an ADR.

## Scope of this first milestone

A single Temporal `DebateWorkflow` driving the **sequential** turn strategy only, with LangGraph as the per-turn reasoning layer (decisions 2/3), ending in a real `Verdict`. Explicitly **not** in scope, each deferred to its own later spec:

- Parallel and judge-directed turn strategies (decision "what's solid" list) — sequential only for now.
- The preparation/research round (decisions 5b/11) — no `ResearchFinding` rows get created this milestone.
- The debate consultant / `ConsultationSession` pre-`Debate` stage (decisions 5a/10) — a `Case`/`Debate` is assumed to already exist (created via Django admin for this milestone; the consultant flow that would normally produce one is separate future work).
- Redis pub/sub live streaming and the WebSocket endpoint (decision 12) — the workflow runs to completion and results land in Postgres; nothing streams live to a client yet.
- Temporal signals/queries for live progress (decision 2's "FastAPI... relays live progress by querying the running workflow") — not needed until there's a live client to relay to.
- Cost controls (decision 19 — already an explicitly deferred item).
- The notification system (decision 17) — a `FAILED` debate sets its status but doesn't yet create a `Notification` row.

## Versions (verified against PyPI/official docs, not assumed — mid-2026)

- `temporalio[langgraph]==1.30.0` — the `[langgraph]` extra installs Temporal's own official LangGraph plugin (`temporalio.contrib.langgraph`). Requires `temporalio>=1.27.0` and Python 3.11+; `orchestrator/`'s image is already `python:3.13-slim`, so no base-image change needed.
- `langgraph==1.2.9`
- `langchain==1.3.14`
- `langchain-openai==1.3.5` — chosen provider is OpenAI (user's call for this milestone); needs `OPENAI_API_KEY`.

Source: [Temporal's LangGraph integration docs](https://docs.temporal.io/develop/python/integrations/langgraph), PyPI pages for each package.

## How Temporal's official LangGraph plugin actually works

Verified directly from Temporal's docs rather than assumed from decision 3's high-level description:

- Every LangGraph node declares `"execute_in": "activity"` or `"execute_in": "workflow"` in its metadata. `"activity"` nodes (anything doing an LLM call or other I/O) run as real Temporal Activities with retries/timeouts; `"workflow"` nodes run inline and must be deterministic.
- The Worker registers the plugin once: `LangGraphPlugin(graphs={"name": build_graph()})`, passed to `Worker(..., plugins=[plugin])`. Workflow code invokes the registered graph by name; the plugin handles dispatching each node to the right execution context — the Workflow itself never calls an LLM directly.
- Constraints that shape this design: conditional-edge functions must be async and deterministic; don't use LangGraph's own `retry_policy` (use Temporal's `RetryPolicy` via node metadata instead); LangGraph's `Store` can't cross an Activity boundary; streaming has at-least-once delivery (irrelevant this milestone — no streaming yet); `InMemorySaver` is enough for checkpointing since Temporal is the actual durability layer, not LangGraph's checkpointer (matches decision 3's explicit warning not to rely on LangGraph's checkpointer for crash recovery).

Practical shape for this milestone: each per-turn reasoning graph is a deliberately minimal **single-node** `StateGraph` (one `"activity"` node that builds a prompt from the persona snapshot + prior arguments, calls the LLM via `langchain-openai` with structured output, and returns the result). Multi-node reasoning (draft-then-critique, etc.) is a real future enhancement, not needed to prove the two-layer integration works.

## Process split: Worker vs. API

Temporal Workers are long-running polling processes — a fundamentally different lifecycle from a request/response ASGI server. Rather than run the worker loop inside the existing `uvicorn` process, `orchestrator/` gets a second entrypoint (`app/worker.py`) and a second `docker-compose` service (`orchestrator-worker`) built from the same image, sharing the same codebase and `.env` — matching decision 2's framing that FastAPI is "the front door" (starts workflows, will relay live progress later) while the actual round-by-round state machine runs in Temporal's own worker process, not in the request-handling process.

## Triggering a workflow (no case-submission UI exists yet)

Per decision 2, FastAPI starts workflows — so the trigger is a new orchestrator endpoint, `POST /api/debates/{debate_id}/start` (JWT-protected, reusing the existing `get_current_user_id` dependency), which calls the Temporal client's `start_workflow`. Since the consultant/case-submission flow isn't built yet, this milestone's test path is: create `Case`/`Debate`/`DebateParticipant`/`AgentPersona` rows through the already-registered Django admin, then call the start endpoint directly (curl, same pattern used to verify the auth endpoints in spec 0003) — not a shortcut being silently taken, the same "verify through the real running stack" approach every prior milestone used before its UI existed.

## Configuration — fail-fast, no silent defaults

New required settings in `orchestrator/app/core/config.py`'s `Settings`, both with no default (per CLAUDE.md's no-silent-fallback rule):
- `openai_api_key` — the worker must refuse to start, not silently skip LLM calls, if this is missing.
- `temporal_address` — e.g. `temporal:7233` inside compose; also required, since a worker with nowhere to connect should fail loudly at startup rather than hang or retry silently forever.

## Observability — implementing decision 16 for real, not just as a locked concept

Pulled into this milestone (rather than a later one) specifically to avoid retrofitting log/trace correlation into `activities.py`/`workflows.py` after the fact. Full design in spec 0005; architecturally significant pieces:

- **Trace propagation across the Workflow/Activity boundary.** `temporalio.contrib.opentelemetry.TracingInterceptor` registered on the shared Temporal `Client` (verified: registering it at `Client.connect()` covers both client calls and everything the Worker does with that client) — so the trace started by `POST /debates/{id}/start` continues automatically into the Workflow and every Activity.
- **A business correlation ID is not the same job as a trace ID.** A Temporal Workflow runs for minutes-to-hours across many Activities and retries — it doesn't live inside one HTTP request's trace. `debate_id` gets attached explicitly as a span attribute and log-context field in every Activity (each Activity already receives `debate_id` as a parameter, since Workflow and Activities don't share memory/contextvars — nothing propagates there implicitly).
- **`session_id` requires a small, deliberate addition to already-shipped auth code.** This system uses stateless JWTs (decision 13), not server-side Django sessions, so there's no existing "session ID" to hang logs on. Fix: mint a UUID at login (`LoginView`, spec 0003) and embed it as a custom JWT claim, carried forward through refresh-token rotation — every service that already decodes the token (Django, orchestrator's `get_current_user_id`) reads it off the token directly, no new infrastructure.
- **Correction to decision 16's text:** it names `psycopg2` for Django auto-instrumentation; this project uses psycopg3 (ADR 0002), so the actual package is `opentelemetry-instrumentation-psycopg`.

## What this doesn't cover

Anything in the "Scope of this first milestone" exclusions above. Also not covered: an actual CI pipeline (already a tracked gap from ADR 0003).
