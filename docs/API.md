# API Surface — Multi-Agent Debate/Consensus System

> Companion to [PRD.md](./PRD.md). Reflects the split confirmed in [references/002-design-review-findings.md](../references/002-design-review-findings.md): Django owns REST/CRUD/history, FastAPI owns orchestration + everything real-time. Request/response bodies are sketched at field level, not full OpenAPI — that gets generated from the actual implementation.

## Auth (shared across both services)

Access token in memory (sent as a normal `Authorization: Bearer <token>` header on REST calls), refresh token in an `HttpOnly`/`Secure`/`SameSite=Strict` cookie scoped to the refresh endpoint. Django issues via `simplejwt`; FastAPI verifies independently with the shared signing key — no callback to Django per request. **Built and verified** (specs 0003/0006), plus one addition beyond the original plan: both tokens also carry a `session_id` claim, minted once at login and surviving refresh rotation, for cross-service log/trace correlation (see `docs/FLOWS.md`'s "How debugging/tracing works" section).

| Method | Path | Service | Notes |
|---|---|---|---|
| `POST` | `/api/auth/register/` | Django | Open self-registration — no invite/admin approval needed. Body: email, password (+ confirmation), name. Validated with Django's standard built-in password validators; no custom rules. No email verification step for v1 — account is active immediately (deliberate scope call: core project first, this is second-priority hardening for later). |
| `POST` | `/api/auth/login/` | Django | Body: credentials. Returns access token in body; sets refresh cookie. |
| `POST` | `/api/auth/refresh/` | Django | Reads refresh cookie; returns new access token; rotates refresh cookie. |
| `POST` | `/api/auth/logout/` | Django | Revokes the refresh cookie. |

**WebSocket auth (FastAPI only):** the access token rides on the WebSocket subprotocol field, not a query parameter (avoids leaking into access logs). FastAPI verifies the token, then separately checks the connecting user actually owns (or has review permission on) the specific debate before accepting the subscription — token validity alone is authentication, not authorization.

## Django (REST) — data at rest, CRUD, history

All endpoints below require a valid access token unless noted. List endpoints are scoped to the requesting user's own cases unless they have reviewer/admin permission.

### Cases
| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/cases/` | **Built and verified (spec 0008).** List the user's cases — ownership-scoped via `get_queryset` (never fetch-then-check), matching the IDOR-avoidance pattern already learned in spec 0005. |
| `GET` | `/api/cases/{id}/` | **Built and verified (spec 0008).** Case detail. (`ConsultationSession` linkage described below isn't populated yet — that stage doesn't exist.) |

*(No direct `POST /api/cases/` — a `Case` is created server-side only, via `ConsultationSession` approval (spec 0009, built and verified) or Django-admin seeding. No frontend exists yet to drive the consultation flow, so a real user still can't create one through the running app.)*

### Debates
| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/debates/` | **Built and verified (spec 0008).** List debates, ownership-scoped via the owning `Case`; optional `?case=<id>` filter. |
| `GET` | `/api/debates/{id}/` | **Built and verified (spec 0008).** Status, `turn_strategy`, nested `Verdict` if present. (`HumanReview` isn't built yet — that flow doesn't exist.) |
| `GET` | `/api/debates/{id}/arguments/` | **Built and verified (spec 0008).** Full argument DAG, each row including a server-computed `leaning` (0=divergent, 1=convergent) for the debate-thread visualization — derived from `CaseTypeConfig.position_options`' list order (now documented as spectrum order, decision/spec 0008), falling back to distinct-value clustering when a position isn't in that list. This is also the catch-up mechanism the original plan described for a client reconnecting mid-debate, ahead of the live stream below (not built yet — see decision 12). |
| `GET` | `/api/debates/{id}/research-findings/` | Not built yet — no research round exists (decision 5b/11 deferred). |
| `GET` | `/api/debates/{id}/convergence-checks/` | Not built yet — the debate-thread view doesn't currently show these stats (spec 0008 explicitly dropped the mock stat-strip rather than show fabricated numbers next to real data). |
| `GET` | `/api/debates/{id}/human-review/` | Not built yet — no human-review screen exists. |
| `POST` | `/api/debates/{id}/human-review/` | Not built yet. Body: `final_decision` (must be one of `CaseTypeConfig.decision_options` for this debate's case type, or omitted if that list is empty), `comment` (required). Only valid once `Debate.status = JUDGED` (or `NO_CONSENSUS`/`FAILED` — human review is required regardless of outcome). |

### Config & personas
| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/case-type-configs/` | Read-only for the frontend: `position_options`, `decision_options`, `research_guardrail_prompt` per case type. Write access is admin-only (Django admin). |
| `GET` | `/api/personas/` | Read-only list of `AgentPersona` (name, role, role_description) — no `system_prompt`/`model_config` exposed to non-admin clients. Write access is admin-only. |

### Notifications
| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/notifications/` | The persisted inbox — filterable by read/unread. |
| `POST` | `/api/notifications/{id}/read/` | Marks one notification read. |

## FastAPI — orchestration, live/streaming, data in motion

### Consultation

**Built and verified (ADR 0005/spec 0009) — differs from this doc's original plan below.** No WebSocket/streaming: turns are plain synchronous HTTP request/response, backed by a Temporal `ConsultationWorkflow` via `workflow.update` (not signal+poll) — chosen deliberately over building Redis/WebSocket streaming (decision 12) for chat specifically; see ADR 0005 decisions 2–3. Backend only — no frontend UI exists yet (a separate follow-up spec).

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/consultations/` | Body: `{case_type}`. Looks up `CaseTypeConfig.default_consultant_persona`, creates a `ConsultationSession` row, starts `ConsultationWorkflow`. Returns `{session_id}`. 404 if `case_type` is unknown. |
| `POST` | `/api/consultations/{id}/messages` | Body: `{text}`. Delivered via a Temporal Update (`submit_message`) — blocks until the consultant's full reply comes back in the same response: `{message, ready_to_finalize}`. 404 if the session isn't owned by the caller; 409 if the session is already approved/failed. |
| `POST` | `/api/consultations/{id}/approve` | Uses the latest consultant-proposed payload verbatim (no edit step) to create a real `Case` + `Debate` + `DebateParticipant` rows — participants/judge/max_rounds auto-populated from `CaseTypeConfig.default_participant_personas`/`default_judge_persona`/`default_max_rounds` (new fields, spec 0009), written directly via the `sqlacodegen`-generated SQLAlchemy Core layer, no HTTP call back to Django. Returns `{case_id, debate_id}`. 400 if the consultant hasn't proposed a payload yet; 404/409 same as above. |

Not built: the `WS /consultations/{id}/stream` bidirectional-streaming endpoint originally planned here — deferred along with decision 12's Redis/WebSocket work generally; SSE (not WebSocket+Redis) is the current leading idea if/when consultation chat gets live token streaming, since a chat reply has exactly one listener unlike debate-argument viewing (ADR 0005 decision 3).

### Debates
| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/debates/{debate_id}/start` | **Built and verified (spec 0005) — differs from this doc's original plan below.** JWT-protected, directly callable by the requesting user (not "internal-only"), 404 if the debate doesn't exist or isn't owned by the caller (`Case.created_by` — an IDOR here was caught and fixed during implementation), 409 if `Debate.status != OPEN`. Starts the real Temporal `DebateWorkflow` (sequential turn strategy, LangGraph + OpenAI, decisions 2/3/6/8). Directly callable because the consultation stage (below) doesn't exist yet — debates are currently seeded via Django admin, then started by calling this endpoint; expect this note to be revisited once consultation-triggered creation is actually built. |
| `WS` | `/debates/{id}/stream` | Not yet built (decision 12) — the workflow currently runs to completion with no live push; results only land in Postgres. |

**Event types on `/debates/{id}/stream`** (all relayed from the debate's Redis channel, `debate:{id}:stream`):
- `argument_token` — `{agent_persona_id, round_number, delta}` — one streamed token chunk of an in-progress argument.
- `argument_complete` — `{argument_id}` — signals the client to stop treating this argument as "in progress"; full record is fetchable via Django's REST API.
- `research_sources_found` — `{agent_persona_id, sources: [...]}` — the initial source list for that agent's research pass.
- `research_source_processing` / `research_source_processed` — `{agent_persona_id, index, url}` — per-source progress within the preparation round.
- `status_change` — `{status}` — `Debate.status` transitions (`OPEN → ARGUING → CONVERGING → JUDGED`/`NO_CONSENSUS`/`FAILED`).
- `retry` — `{activity}` — published explicitly when Temporal retries a failed Activity, so the client clears stale partial output before the next attempt's tokens arrive (this is hand-built, not automatic — see PRD §9).

### Notifications (general, not tied to any one debate)
| Method | Path | Notes |
|---|---|---|
| `WS` | `/notifications/stream` | One connection per logged-in session (not per debate). Relays from the shared `app_notifications` Redis channel, filtered in-memory to the connected user. |

## Redis channel reference (implementation detail, not a public API, listed here for one place to check)

| Channel | Publishers | Subscribers |
|---|---|---|
| `debate:{debate_id}:stream` | Temporal Activities (argument generation, research steps) | FastAPI, one subscription per open `WS /debates/{id}/stream` connection |
| `app_notifications` | Django, any debate's Temporal workflow, consultation workflows | Every FastAPI worker process (one subscription each), routed to the right user's WebSocket in memory |

No numbered Redis databases are used anywhere — pub/sub ignores them entirely, and separation is by channel name only (see decision 12).

## Not yet specified

- Full request/response JSON shapes (field-level, error formats, pagination) — write these once implementation starts, informed by whatever Django/DRF and FastAPI/Pydantic actually generate.
- Rate limiting / throttling on any endpoint (ties to PRD §9 — cost controls explicitly deferred).
