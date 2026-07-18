# Spec 0005 — `DebateWorkflow`: first real Temporal + LangGraph debate loop

> Governed by [ADR 0004 — Temporal + LangGraph debate orchestration](../adr/0004-temporal-langgraph-orchestration.md). Implements decisions 2, 3, 4, 6, 7, 8 from [references/002-design-review-findings.md](../../references/002-design-review-findings.md), sequential turn strategy only.

## What's being built

### 1. New dependencies (`orchestrator/requirements.txt`)
`temporalio[langgraph]==1.30.0`, `langgraph==1.2.9`, `langchain==1.3.14`, `langchain-openai==1.3.5`.

### 2. Config (`orchestrator/app/core/config.py`)
Two new required settings, no defaults: `openai_api_key`, `temporal_address`. Added to `orchestrator/.env` / `.env.example`.

### 3. New orchestrator structure
```
orchestrator/app/
  core/
    temporal_client.py     — async Client factory, used by both the API router and the worker
  debates/
    graphs.py               — single-node LangGraph StateGraphs: argument_graph, judge_opening_graph, judge_closing_graph
    activities.py            — plain Temporal Activities: db reads/writes, status transitions, convergence check
    workflows.py             — DebateWorkflow
    router.py                — POST /api/debates/{debate_id}/start
    schemas.py                — Pydantic request/response models for the start endpoint
    queries.py                — SQLAlchemy Core helpers (reads/writes against generated_tables.py), imported by activities.py — never the generated file itself edited
  worker.py                  — builds the Worker (LangGraphPlugin + workflow + activities), runs the polling loop
```

### 4. `DebateWorkflow` — sequential strategy only

```
run(debate_id):
  set Debate.status = ARGUING (activity)
  if Debate.opening_statement is null:
    opening = judge_opening_graph(debate)          # 1st of exactly 2 judge LLM calls
    persist Debate.opening_statement (activity)

  participants = ordered DebateParticipants (by id — deterministic, fixed order = decision 2's "sequential")

  while Debate.current_round < Debate.max_rounds:
    for participant in participants:
      argument_graph(debate, participant, round_number)   # activity node inside; writes Argument (activity)
    check = check_convergence_activity(debate_id, round_number)   # writes ConvergenceCheck
    increment current_round (activity)
    if check.result: break

  set Debate.status = CONVERGING (activity)
  verdict = judge_closing_graph(debate)             # 2nd judge LLM call — decision + confidence + reasoning + closing_summary + cited_argument_ids
  persist Verdict + Debate.closing_summary (activity)
  set Debate.status = JUDGED if check.result else NO_CONSENSUS (activity)
  set Debate.judged_at = now (activity)

on any unrecoverable Activity failure (retries exhausted):
  set Debate.status = FAILED (activity)
  # no Notification row yet — decision 17 is a later milestone; this is the one
  # explicitly tracked gap this spec leaves open, not a silently dropped case.
```

Judge always produces a `Verdict`, even on `NO_CONSENSUS` (decision 8: never auto-executed, confidence reflects the real disagreement) — there's no separate "give up without a verdict" path.

### 5. Argument generation (`argument_graph`, one activity node)

Input: the debate's case payload, the participant's `persona_snapshot` (frozen config — decision 7), the case's `CaseTypeConfig.position_options`, all prior-round arguments (for context and for detecting this participant's own last position). Calls `ChatOpenAI` via `langchain-openai` with `.with_structured_output()` against a schema:

```python
class ArgumentOutput(BaseModel):
    content: str
    position: str        # constrained to position_options via the prompt when that list is non-empty (loan_approval, pr_review); free string when empty (research_debate — decision 14a's accepted limitation)
    confidence: float
    responds_to_argument_id: int | None   # required (non-null) when position differs from this participant's own last round — decision 4's citation-on-change rule, enforced here at the application layer per the model's own docstring
```

Writes one `Argument` row via `queries.py` (SQLAlchemy Core insert against `t_debates_argument`).

### 6. Convergence check (`check_convergence_activity`, plain activity — decision 6)

Reads all `Argument` rows for the debate up to and including `round_number`. Computes and stores as `ConvergenceCheck.signals`:
- `position_stable`: every participant's position this round equals their own position last round (always `False` on round 0 — nothing to compare yet).
- `confidence_spread`: `max(confidence) - min(confidence)` this round, and whether it shrank vs. the previous round's spread.
- `no_new_rebuttals`: no `Argument` this round set `responds_to`.
- `uncited_changes`: count of participants whose position changed from last round without setting `responds_to` (decision 4's dissent-preserving signal — this is the number that should be zero for a convergence to be "earned", not just apparent).

`score` = mean of four 0/1 sub-signals (`position_stable`, spread shrank, `no_new_rebuttals`, `uncited_changes == 0`); `result = score >= 0.75 and round_number >= 1` (need at least two rounds run before convergence can even be considered — round 0 has no prior round to compare against). Writes one `ConvergenceCheck` row.

### 7. Judge graphs (`judge_opening_graph`, `judge_closing_graph`)

Same single-node-`StateGraph`-plus-structured-output shape as the argument graph. Opening: `{opening_statement: str}`, called once, before round 0 — matches decision 5's discussion-point about whether arguing personas see this framing: for this milestone they do **not** (it isn't passed into `argument_graph`'s prompt), consistent with decision 4's anchoring concern; revisit only if it turns out the opening statement needs to reach participants for some other reason. Closing: `{decision: str, confidence: float, reasoning: str, closing_summary: str, cited_argument_ids: list[int]}` — `cited_argument_ids` populates `Verdict.cited_arguments` (forced-citation M2M, decision 8).

### 8. Start endpoint

`POST /api/debates/{debate_id}/start` — JWT-protected (`get_current_user_id`), 404 if the debate doesn't exist, **404 (not 403) if the authenticated user isn't the debate's `Case.created_by`** — authentication alone proves who's asking, not that they're allowed to start *this* debate, the same gap decision 13a already named for the WebSocket endpoint (caught by automated security review during implementation, not anticipated when this spec was first written) — 409 if `Debate.status != OPEN`, otherwise calls `client.start_workflow(DebateWorkflow.run, debate_id, id=f"debate-{debate_id}", task_queue="dialex-debates")` and returns 202 with the Temporal workflow ID.

### 9. `docker-compose.yml`

New `orchestrator-worker` service: same `build: ./orchestrator`, same `env_file`/`DATABASE_URL` override as `orchestrator`, `command: python -m app.worker`, `depends_on: db (healthy), temporal`. No new host port (a worker doesn't listen for inbound connections).

### 10. Observability — implements decision 16, pulled in now to avoid retrofitting it into this milestone's own code later

**New dependencies:**
- `orchestrator/requirements.txt`: `opentelemetry-api`, `opentelemetry-sdk`, `opentelemetry-instrumentation-fastapi==0.65b0`, `opentelemetry-instrumentation-sqlalchemy==0.65b0` (exact patch pins reconfirmed at install time against whatever core `opentelemetry-api`/`-sdk` resolves to — these instrumentation packages iterate fast).
- `backend/requirements.txt`: `opentelemetry-api`, `opentelemetry-sdk`, `opentelemetry-instrumentation-django==0.65b0`, `opentelemetry-instrumentation-psycopg` (not `-psycopg2` — decision 16's text named the wrong driver; this project uses psycopg3, ADR 0002).
- Temporal's OTel support (`temporalio.contrib.opentelemetry.TracingInterceptor`) ships inside the base `temporalio` package already being added — no extra install.
- **Dropped during implementation:** `opentelemetry-instrumentation-logging`. Its record-mutation only actually populates `otelTraceID`/`otelSpanID` when `set_logging_format=True` (which also hands it control of the global format string, conflicting with our own formatter) — verified empirically (`KeyError: 'otelTraceID'` on every log call without it). Root-caused rather than patched around: `trace_id`/`span_id` are read directly from `opentelemetry.trace.get_current_span().get_span_context()` inside our own logging filter instead, which doesn't depend on a beta package's exact flag behavior.

**`orchestrator/app/core/observability.py`** (new) — one setup function called once at process start (both `main.py` and `worker.py` call it):
- `TracerProvider` + `BatchSpanProcessor(ConsoleSpanExporter())` — local/console for now; decision 16's whole point is this becomes an OTLP exporter later with no other code change.
- `FastAPIInstrumentor.instrument_app(app)` (API process only), `SQLAlchemyInstrumentor().instrument(engine=engine)` (both processes).
- A logging `Filter` reads `trace_id`/`span_id` straight from `opentelemetry.trace.get_current_span().get_span_context()` and stamps them onto every `LogRecord` (see "Dropped during implementation" above for why this isn't delegated to `opentelemetry-instrumentation-logging`).
- `RotatingFileHandler` (10MB, matches decision 16's original ask), added as a handler alongside console output.
- `bind_debate_context(debate_id, session_id=None, user_id=None)` — sets each as a current-span attribute (namespaced `dialex.debate_id`/`dialex.session_id`/`dialex.user_id`) and as `contextvars`-backed fields a logging `Filter` injects into every subsequent log record in that call. Called explicitly at the top of `router.py`'s start endpoint and at the top of every function in `activities.py` — Workflow and Activities are separate executions with no shared memory, so this can't propagate implicitly and has to be an explicit one-liner per call site, using the `debate_id` every activity already receives as a parameter.

**`backend/src/config/observability.py`** (new) — same shape (`DjangoInstrumentor`, `PsycopgInstrumentor`, `LoggingInstrumentor`, `RotatingFileHandler`, same `bind_debate_context` helper), wired into Django's `LOGGING` setting. Mainly future-proofing this milestone (Django has no debate-specific endpoints yet), but auth views get `user_id`/`session_id` bound immediately.

**Temporal ↔ OTel wiring:** `TracingInterceptor()` passed to `Client.connect(..., interceptors=[...])` in `temporal_client.py` — registering it there covers both the API process's `start_workflow` calls and everything the Worker does using that same client, so the trace started by `POST /debates/{id}/start` continues into the Workflow and every Activity automatically.

**`session_id` — a small, deliberate addition to spec 0003's already-shipped auth code**, since this is a stateless-JWT system (decision 13) with no server-side Django session to hang logs on otherwise:
- `LoginView` gets a custom `TokenObtainPairSerializer` subclass overriding `get_token()` to mint a UUID and set it as a `session_id` claim on the refresh token before encoding.
- No refresh-side change needed — verified against the installed `simplejwt` source: `TokenRefreshSerializer.validate()` rotates the *same* decoded token object in place (`set_jti()`/`set_exp()`/`set_iat()` only), and `RefreshToken.access_token` copies every payload claim except `token_type`/`exp`/`jti` onto the derived access token. A custom claim set once at login survives rotation automatically. (Corrects this spec's earlier assumption that rotation drops custom claims — it doesn't.)
- Orchestrator's `get_current_user_id` (`security.py`) additionally extracts `session_id` from the verified payload (falls back to `None` if absent — e.g. tokens issued before this change — logged as-is, not treated as an auth failure).

## Explicitly out of scope (per ADR 0004)

Parallel/judge-directed turn strategies, preparation/research round, consultant/`ConsultationSession` stage, Redis streaming, WebSocket endpoint, Temporal signals/queries for live progress, cost controls, `Notification` row on `FAILED`. Also out of scope: exporting traces/logs anywhere but console + local rotating file (a real backend is a later swap, decision 16), and metrics (only traces + logs this milestone).

## Verification plan

- `docker compose up -d orchestrator-worker` starts cleanly; worker visible polling `dialex-debates` in the Temporal Web UI.
- Via Django admin: create one `CaseTypeConfig` (`loan_approval`, `position_options=["approve","reject","uncertain"]`), one `Case`, 2–3 `AgentPersona` rows (role=participant) + 1 judge persona, one `Debate` (`max_rounds=3`, `turn_strategy=sequential`), matching `DebateParticipant` rows.
- `POST /api/debates/{id}/start` with a valid access token (from the existing login endpoint) returns 202.
- Confirm end to end against the real containers (not just "workflow completed" in the Temporal UI): `Debate.opening_statement` set, `Argument` rows exist per participant per round with plausible `position`/`confidence`, at least one `ConvergenceCheck` row with populated `signals`, a `Verdict` row with non-empty `cited_arguments`, `Debate.status` lands on `JUDGED` or `NO_CONSENSUS`, `Debate.closing_summary` set.
- Force a failure case (e.g. temporarily invalid `OPENAI_API_KEY`) and confirm `Debate.status` lands on `FAILED` rather than hanging or silently succeeding.
- Confirm the worker fails loudly at startup if `OPENAI_API_KEY` or `TEMPORAL_ADDRESS` is unset (no silent skip).
- Log in via `POST /api/auth/login/`, decode the returned access token, confirm it carries a `session_id` claim; refresh via `POST /api/auth/refresh/` and confirm the new access token carries the *same* `session_id` (not a new one, not missing).
- Tail the orchestrator's rotating log file during a debate run: every line from `activities.py` carries matching `trace_id` + `debate_id`, and lines from the request that called the start endpoint additionally carry `session_id`/`user_id`.
- Confirm spans appear on console output for the full chain — the start endpoint's span, the Workflow's span, and each Activity's span all share one `trace_id`.

## Branch

Continuing on `main`.

## Status

Awaiting explicit approval before implementation, per this repo's CLAUDE.md.
