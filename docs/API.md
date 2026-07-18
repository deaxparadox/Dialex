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
| `GET` | `/api/cases/` | List the user's cases. |
| `GET` | `/api/cases/{id}/` | Case detail, including which `ConsultationSession` produced it. |

*(No user-facing `POST` — a `Case` is created server-side as a side effect of `ConsultationSession` approval, via FastAPI. See below.)*

### Debates
| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/debates/` | List debates; filterable by case, status. |
| `GET` | `/api/debates/{id}/` | Status, `turn_strategy`, `Verdict`, `HumanReview` if present. |
| `GET` | `/api/debates/{id}/arguments/` | Full argument DAG — this is the catch-up mechanism for a client reconnecting mid-debate, read before opening the live stream. |
| `GET` | `/api/debates/{id}/research-findings/` | All `ResearchFinding` rows for the debate. |
| `GET` | `/api/debates/{id}/convergence-checks/` | Audit trail — each check's actual computed `signals`, not just a label. |
| `GET` | `/api/debates/{id}/human-review/` | Existing review, if any. |
| `POST` | `/api/debates/{id}/human-review/` | Body: `final_decision` (must be one of `CaseTypeConfig.decision_options` for this debate's case type, or omitted if that list is empty), `comment` (required). Only valid once `Debate.status = JUDGED` (or `NO_CONSENSUS`/`FAILED` — human review is required regardless of outcome). |

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
| Method | Path | Notes |
|---|---|---|
| `POST` | `/consultations/` | Body: initial free-text request + `case_type`. Starts a `ConsultationSession` (Temporal-backed, same infrastructure as debates). Returns session ID. |
| `WS` | `/consultations/{id}/stream` | Bidirectional: user messages sent in, consultant's streamed reply tokens come back. Same subprotocol-token auth as debate streams. |
| `POST` | `/consultations/{id}/approve/` | Finalizes the negotiated question/payload. Triggers `Case` + `Debate` creation (written directly to Django's tables via the `sqlacodegen`-generated SQLAlchemy Core layer — no HTTP call back to Django). Returns the new `debate_id`. |

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
