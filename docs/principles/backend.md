# Backend principles

> Generic, industry-standard practices this project's backend code (Django and FastAPI) is held to — distinct from `docs/adr/` (this project's *specific* decisions) and `references/` (the reasoning trail behind them). This document states the standard straight, without watering it down to match where the code currently is.
>
> **Relationship to known gaps:** where the code doesn't yet meet a principle below *because of core-first sequencing*, that gap is tracked in `docs/PRD.md` §9 — check there before treating a gap as a new audit finding. An undocumented gap is a real finding; a gap already listed in §9 is known backlog, not news.
>
> **Relationship to `CLAUDE.md`:** that file governs how work gets done on this repo (workflow, logging, no unapproved dependencies). This file governs what the code itself should conform to. Different scope, not a restatement.

## Security — OWASP Top 10 awareness

- Injection: no raw string-interpolated SQL, ever — Django ORM / parameterized queries / SQLAlchemy Core's expression API only.
- Broken authentication: token lifetimes, rotation, and storage per `docs/adr/` decisions — not reinvented per-endpoint.
- Sensitive data exposure: no secrets in source control, no PII in logs (relevant directly to the research-guardrail work, decision 14).
- Run Django's own deployment checklist (`manage.py check --deploy`) before anything resembling a production deploy — `DEBUG=False`, `ALLOWED_HOSTS` set, secure cookie flags, HSTS.
- Least privilege on database credentials — the app's DB user should only be able to do what the app actually needs.

## Configuration — 12-Factor App

- Config lives in environment variables, never hardcoded — and per this repo's own CLAUDE.md rule, anything *required* fails loudly and immediately at startup if missing, never a silent default.
- Dev/prod parity: the same Docker images and dependency versions across environments, differing only in config.
- Processes are stateless and disposable — no in-memory state a restart would silently lose (this is exactly why Temporal owns debate state, not application memory).

## API design

- Consistent REST conventions: correct HTTP verbs and status codes (a `POST` that doesn't create anything new isn't a `201`), resource-based URLs, not verb-based ones.
- List endpoints are paginated by default, not "add pagination when it becomes a problem."
- A versioning strategy exists before the first breaking change is needed, not after.

## Data & migrations

- Migrations are reviewed like any other code change before merge — a migration is a one-way door once applied against shared data.
- Never edit an already-applied, already-shared migration; write a new one.
- Prefer reversible migrations; when a migration truly can't be reversed (a data-destructive change), that's called out explicitly in the migration itself, not left implicit.

## Observability

- Structured logging (per `docs/adr/`'s OpenTelemetry setup), not scattered `print`/ad hoc log statements.
- Correlation IDs that follow a request across service boundaries (Django → FastAPI → Temporal Activity) — a distributed system that can't be traced end to end is one where debugging means guessing.

## Reliability

- Anything that can be retried (which, under Temporal, is most things) must be idempotent — running an Activity twice must not double-charge, double-notify, or double-write.
- Every external call (LLM API, search API, another service) has an explicit timeout — no call waits forever by default.

## Testing

- Testing pyramid shape: more unit tests than integration tests, more integration tests than end-to-end tests — not the inverse.
- Business logic (convergence checks, position validation, citation requirements) is tested independent of the web framework where feasible, so the test doesn't need a full Django/FastAPI request cycle just to check arithmetic.
