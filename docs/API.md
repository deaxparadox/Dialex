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
| `GET` | `/api/debates/{id}/` | **Built and verified (spec 0008).** Status, `turn_strategy`, nested `Verdict` if present. (`HumanReview` isn't built yet — that flow doesn't exist.) Also returns `status_display` (spec 0025, added alongside the raw `status` field) — the human-readable label from `Debate.Status.choices` (e.g. "No consensus" for `NO_CONSENSUS`), for display only; clients must keep branching on the raw `status` value. |
| `GET` | `/api/debates/{id}/arguments/` | **Built and verified (spec 0008).** Full argument DAG, each row including a server-computed `leaning` (0=divergent, 1=convergent) for the debate-thread visualization — derived from `CaseTypeConfig.position_options`' list order (now documented as spectrum order, decision/spec 0008), falling back to distinct-value clustering when a position isn't in that list. This is also the catch-up mechanism the original plan described for a client reconnecting mid-debate, ahead of the live stream below (now built, ADR 0006/specs 0013-0014). |
| `GET` | `/api/debates/{id}/research-findings/` | Not built yet — no research round exists (decision 5b/11 deferred). |
| `GET` | `/api/debates/{id}/convergence-checks/` | Not built yet — the debate-thread view doesn't currently show these stats (spec 0008 explicitly dropped the mock stat-strip rather than show fabricated numbers next to real data). |
| `GET` | `/api/debates/{id}/human-review/` | Not built yet — no human-review screen exists. |
| `POST` | `/api/debates/{id}/human-review/` | Not built yet. Body: `final_decision` (must be one of `CaseTypeConfig.decision_options` for this debate's case type, or omitted if that list is empty), `comment` (required). Only valid once `Debate.status = JUDGED` (or `NO_CONSENSUS`/`FAILED` — human review is required regardless of outcome). |

### Config & personas
| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/case-type-configs/` | **Built and verified (spec 0010).** Returns `type` only — kept minimal for the case-type picker; `position_options`/`decision_options`/`research_guardrail_prompt` aren't exposed here since no UI needs them yet (unlike the plan below, not ownership-scoped — shared config). Write access is admin-only (Django admin). |
| `GET` | `/api/personas/` | Read-only list of `AgentPersona` (name, role, role_description) — no `system_prompt`/`model_config` exposed to non-admin clients. Write access is admin-only. |

### Notifications
| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/notifications/` | The persisted inbox — filterable by read/unread. |
| `POST` | `/api/notifications/{id}/read/` | Marks one notification read. |

## FastAPI — orchestration, live/streaming, data in motion

### Consultation

**Built and verified end to end (ADR 0005/spec 0009 backend, spec 0010 frontend) — differs from this doc's original plan below.** No WebSocket/streaming for the reply itself: turns are plain synchronous HTTP request/response, backed by a Temporal `ConsultationWorkflow` via `workflow.update` (not signal+poll) — chosen deliberately over building Redis/WebSocket streaming (decision 12) for chat specifically; see ADR 0005 decisions 2–3. A real user can now drive this whole flow through the running app (`/consultation` → chat → `/debates/:id`), not just via curl.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/consultations/` | Body: `{case_type}`. Looks up `CaseTypeConfig.default_consultant_persona`, creates a `ConsultationSession` row, starts `ConsultationWorkflow`. Returns `{session_id}`. 404 if `case_type` is unknown. |
| `POST` | `/api/consultations/{id}/messages` | Body: `{text}`. Delivered via a Temporal Update (`submit_message`) — blocks until the consultant's full reply comes back in the same response: `{message, ready_to_finalize}`. Internally now a 3-node reflection graph (draft → critique → conditional revise, ADR 0008/spec 0023) rather than one call, but this endpoint's request/response contract is completely unchanged by that. 404 if the session isn't owned by the caller; 409 if the session is already approved/failed. |
| `GET` | `/api/consultations/{id}/stream` | **Built (ADR 0008 decision 5, spec 0023).** SSE (`fastapi.sse.EventSourceResponse`, native to the installed FastAPI version — no new dependency). Relays `{"step": "draft" | "critique" | "revise"}` from the `consultation:{id}:stream` Redis channel as each reflection node starts — a live "what's happening" nudge only, never a source of truth; `POST /messages` above remains the sole source of truth for the actual reply. Frontend must open this connection *before* firing `POST /messages` (no replay on Redis pub/sub — same caveat as `debate:{id}:stream`, ADR 0006 decision 4) or it can miss the `draft` step. Auth via the ordinary `Authorization` header (not a WS-subprotocol trick — this is a plain `GET`), same 404-if-not-owned check as every other consultation endpoint. |
| `POST` | `/api/consultations/{id}/approve` | Uses the latest consultant-proposed payload verbatim (no edit step) to create a real `Case` + `Debate` + `DebateParticipant` rows — participants/judge/max_rounds auto-populated from `CaseTypeConfig.default_participant_personas`/`default_judge_persona`/`default_max_rounds` (new fields, spec 0009), written directly via the `sqlacodegen`-generated SQLAlchemy Core layer, no HTTP call back to Django. Returns `{case_id, debate_id}`. 400 if the consultant hasn't proposed a payload yet; 404/409 same as above. |

Not built: the `WS /consultations/{id}/stream` bidirectional-streaming endpoint originally planned here, or token-by-token streaming of the consultant's own reply text — the SSE endpoint above carries step names only, never message content. SSE (not WebSocket+Redis) was the right call for this narrower use case too, for the same reason ADR 0005 decision 3 gave: a consultation turn has exactly one listener, unlike debate-argument viewing.

### Debates
| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/debates/{debate_id}/start` | **Built and verified (spec 0005) — differs from this doc's original plan below.** JWT-protected, directly callable by the requesting user (not "internal-only"), 404 if the debate doesn't exist or isn't owned by the caller (`Case.created_by` — an IDOR here was caught and fixed during implementation), 409 if `Debate.status != OPEN`. Starts the real Temporal `DebateWorkflow` (sequential turn strategy, LangGraph + OpenAI, decisions 2/3/6/8). Directly callable because the consultation stage (below) doesn't exist yet — debates are currently seeded via Django admin, then started by calling this endpoint; expect this note to be revisited once consultation-triggered creation is actually built. |
| `WS` | `/api/debates/{id}/stream` | **Built and verified end to end (ADR 0006/specs 0013-0014) — differs from this doc's original plan below.** JWT rides the WebSocket subprotocol field (decision 13a — browsers can't set custom headers on a WS handshake); same ownership check as the REST start endpoint, closing the connection (manifests as an HTTP 403 at the handshake, since `close()` before `accept()` aborts the upgrade) rather than accepting for an invalid token or a non-owner. Pushes **complete** events only — see below for why token-by-token was tried and empirically ruled out, not silently skipped. `debate-thread` now consumes this directly (spec 0014) in place of its original 4s poll, which is kept only as an explicit, logged fallback for an unexpected socket drop. |

**Event types actually published on `/api/debates/{id}/stream`** (relayed from the debate's Redis channel, `debate:{id}:stream`):
- `argument_complete` — `{argument_id}` — the argument is fully written to Postgres; full record is fetchable via Django's REST API.
- `status_change` — `{status}` — `Debate.status` transitions (`OPEN → ARGUING → CONVERGING → JUDGED`/`NO_CONSENSUS`/`FAILED`). Built.
- `opening_statement_complete` — `{}` — **Built (spec 0018, found necessary during 0019's verification).** Fired the instant `Debate.opening_statement` is persisted; the frontend fetches the full text via the existing REST endpoints, same "go re-fetch" shape as the other complete events. Without this, the frontend only learned the opening statement was ready via whatever unrelated event happened to arrive next — briefly tolerable before `turn_started` existed, but a visible ~2s blank gap once it did (the next event became a same-debate `turn_started`, which deliberately doesn't trigger a re-fetch).
- `turn_started` — `{agent_persona_id, agent_name, stage, round_number}` — **Built (spec 0018).** Fired the instant a turn's LLM call *begins* — `stage` is `"opening_statement"`, `"argument"`, or `"verdict"`. Carries no persisted content (nothing to fetch yet); purely a live "who's currently generating" signal, letting the frontend show a "{agent} is thinking…" indicator (spec 0019) instead of silence until the corresponding complete event lands.
- `turn_token` — `{agent_persona_id, stage, round_number, token}` — **Built for all three stages (spec 0020 for `"argument"`, spec 0021 for `"opening_statement"`/`"verdict"`; ADR 0007).** ADR 0006 had ruled out token-by-token content because `.with_structured_output(...).astream()` returns one atomic chunk — but that's the *combination* being atomic, not streaming itself. ADR 0007 splits each graph's generation to stream plain text directly, then (for arguments and the verdict, which mix prose with judgment fields) a fast follow-up structured call for the judgment fields only, fed the streamed content back as fixed context so the persisted row can never drift from what streamed. The opening-statement graph needed no follow-up call at all — its schema was always 100% prose. Published directly from the LangGraph node functions in `graphs.py`, not from an `activities.py` Activity — a new pattern (see the Redis channel table below).
- `turn_token_reset` — `{agent_persona_id, stage, round_number}` — **Built for all three stages (spec 0020/0021, ADR 0007).** Published once at the very start of each node function, before streaming begins — including on a Temporal-level retry of the same node (network blip, rate limit), which silently re-enters the node function with no signal to the Workflow. Tells the frontend to discard any partial `turn_token` text already accumulated for that turn. This is the `retry` event ADR 0006 explicitly deferred ("relevant again only if/when true token streaming is built") — renamed/reshaped now that it's actually needed.
- `research_sources_found` / `research_source_processing` / `research_source_processed` — not built; no research round exists yet (decisions 5b/11, still deferred) — these event types stay reserved.

### Notifications (general, not tied to any one debate)
| Method | Path | Notes |
|---|---|---|
| `WS` | `/notifications/stream` | One connection per logged-in session (not per debate). Relays from the shared `app_notifications` Redis channel, filtered in-memory to the connected user. |

## Redis channel reference (implementation detail, not a public API, listed here for one place to check)

| Channel | Publishers | Subscribers |
|---|---|---|
| `debate:{debate_id}:stream` | Temporal Activities — `persist_argument`, `set_debate_status`, `persist_verdict_and_close`, `mark_failed` (built, spec 0013), `persist_opening_statement` (built, spec 0018), `publish_turn_started` (built, spec 0018); all three LangGraph node functions in `graphs.py` directly, not via an Activity wrapper — `turn_token`/`turn_token_reset` (built, spec 0020/0021/ADR 0007); research-round Activities once that round exists | FastAPI, one subscription per open `WS /api/debates/{id}/stream` connection |
| `app_notifications` | Django, any debate's Temporal workflow, consultation workflows | Every FastAPI worker process (one subscription each), routed to the right user's WebSocket in memory |
| `consultation:{session_id}:stream` | The `draft`/`critique`/`revise` LangGraph node functions in `consultations/graphs.py`, directly (not via an Activity wrapper — same shape as `debates/graphs.py`'s `turn_token` publishing) — `{"step": ...}` (built, spec 0023/ADR 0008) | FastAPI, one subscription per open `GET /api/consultations/{id}/stream` connection |

No numbered Redis databases are used anywhere — pub/sub ignores them entirely, and separation is by channel name only (see decision 12).

## Not yet specified

- Full request/response JSON shapes (field-level, error formats, pagination) — write these once implementation starts, informed by whatever Django/DRF and FastAPI/Pydantic actually generate.
- Rate limiting / throttling on any endpoint (ties to PRD §9 — cost controls explicitly deferred).
