# Spec 0002 — Scaffold Django backend, core data model, and docker-compose infrastructure

> Governed by [ADR 0002 — Backend architecture & scaffolding conventions](../adr/0002-backend-architecture.md). Implements the data model locked across `references/002-design-review-findings.md` (decisions 1–19) and `references/003-base-conversation-annotated.md` (original entity definitions) — no new design decisions made here, this is the first implementation of what's already decided.

## What's being built

1. The Django project (`backend/`), `src/`-layout per ADR 0002, with a custom user model, before any migration exists.
2. Six Django apps holding the full locked data model (below), with admin registration for every model — no API views/serializers yet, that's a separate future spec.
3. `docker-compose.yml` covering every service that has real code to run right now: app Postgres, Django, Temporal (+ its own separate Postgres + Web UI, per decision 2a), Redis. FastAPI is not in compose yet — no code exists for it.

## Data model (Django app → models → fields)

**`accounts`**
- `User` (subclasses `AbstractUser`, no extra fields yet — created now specifically because a custom user model can't be introduced after the first migration, per ADR 0002).

**`cases`**
- `Case` — `type` (string), `payload` (JSON), `status` (string), `created_by` (FK `User`), `consultation_session` (FK `ConsultationSession`, one-to-one, nullable — traceability per decision 10), `created_at`.
- `CaseTypeConfig` — `type` (unique string), `position_options` (JSON list), `decision_options` (JSON list), `research_guardrail_prompt` (text) — decisions 5c, 8, 14.

**`debates`** (the largest app — see ADR 0002 for why these stay together)
- `AgentPersona` — `name`, `role` (choices: `participant`/`consultant`/`judge` — decision 10), `role_description`, `system_prompt`, `model_config` (JSON).
- `Debate` — `case` (FK), `turn_strategy` (`sequential`/`parallel`/`judge_directed`), `status` (`OPEN`/`ARGUING`/`CONVERGING`/`JUDGED`/`NO_CONSENSUS`/`FAILED`), `current_round`, `max_rounds`, `convergence_config` (JSON), `judge_persona` (FK `AgentPersona`, decision 10), `opening_statement` (text, nullable), `closing_summary` (text, nullable), `created_at`, `judged_at` (nullable).
- `DebateParticipant` — `debate` (FK), `agent_persona` (FK), `stance_seed` (nullable), `persona_snapshot` (JSON — decision 7).
- `Argument` — `debate` (FK), `round_number`, `agent_persona` (FK), `content` (text), `responds_to` (FK to self, nullable — doubles as the citation-on-position-change link per decision 4: when `position` differs from this agent's own prior round, `responds_to` must point at the argument that changed its mind; enforced at the application/serializer layer later, not a DB constraint), `position` (plain string, nullable while streaming — decision 5), `confidence` (float, nullable), `cites_research_finding` (FK `ResearchFinding`, nullable — decision 11), `created_at`.
- `ConvergenceCheck` — `debate` (FK), `round_number`, `method` (single accurate label, not the stale 3-way enum — decision 6), `signals` (JSON — the actual computed values), `result` (boolean), `score` (float), `created_at`.
- `Verdict` — `debate` (FK, one-to-one), `decision` (string), `confidence` (float), `reasoning` (text), `cited_arguments` (M2M to `Argument` — chosen over a JSON array for native reverse-queryability; either satisfies decision 8's requirement, this is an implementation detail not a re-litigated decision), `created_at`.
- `ResearchFinding` — `debate` (FK), `agent_persona` (FK), `query` (text), `source_url` (text, nullable), `source_title` (text, nullable), `summary` (text), `created_at`.

**`consultations`**
- `ConsultationSession` — `user` (FK `User` — a necessary addition not explicit in the original design notes, since a session obviously belongs to whoever is having the conversation; not a new architecture decision, just a required FK for the entity to function), `case_type` (string), `status` (`OPEN`/`AWAITING_APPROVAL`/`APPROVED`), `consultant_persona` (FK `AgentPersona`, role=`consultant`), `finalized_payload` (JSON, nullable until approved), `created_at`, `approved_at` (nullable).
- `ConsultationTurn` — `session` (FK), `turn_number`, `speaker` (`user`/`consultant`), `content` (text), `created_at`.

**`reviews`**
- `HumanReview` — `debate` (FK, one-to-one), `reviewer` (FK `User`), `comment` (text, required), `final_decision` (string, nullable — button-selected from `CaseTypeConfig.decision_options`, decision 8), `reviewed_at`.

**`notifications`**
- `Notification` — `user` (FK), `type` (string), `message` (text), `related_case` (FK `Case`, nullable), `related_debate` (FK `Debate`, nullable), `read` (boolean, default `False`), `created_at`.

## docker-compose services

| Service | Image/base | Notes |
|---|---|---|
| `db` | `postgres` | App database — Django owns all migrations against this (decisions 1, 9). |
| `django` | built from `backend/` | Runs migrations + `runserver` for now; production WSGI/ASGI server is a later concern. |
| `temporal` | `temporalio/auto-setup` | Dev/auto-setup mode per decision 2a — not for production, fine for this stage. |
| `temporal-postgresql` | `postgres` | Temporal's own persistence store — **a separate database from `db`**, per decision 2a; never shares a schema with the app's tables. |
| `temporal-ui` | `temporalio/ui` | Web UI for inspecting workflow executions. |
| `redis` | `redis` | Pub/sub only (decision 12) — no numbered databases, per decision 12's own reasoning. |

Required env vars (via `django-environ`, ADR 0002) fail loudly if missing at startup — no buried defaults: `DJANGO_SECRET_KEY`, `DATABASE_URL`, `SIMPLE_JWT_SIGNING_KEY`. `.env.example` documents all of them without real values.

## Explicitly out of scope for this spec

- FastAPI service and its own docker-compose entry (no code yet).
- Auth views/serializers, JWT issuance (separate future spec — decisions 13/13a are designed, not yet implemented).
- Applying migrations against a live DB isn't verified until `docker-compose up` actually brings `db` up.
- `sqlacodegen` generation (decision 9) — needs Django's schema to exist first; next milestone after this one.

## Branch

Continuing on `main`, per the pattern already established for spec 0001 — no branch requested.

## Status

Awaiting explicit approval before implementation, per this repo's CLAUDE.md.
