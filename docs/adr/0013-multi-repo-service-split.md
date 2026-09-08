# ADR 0013 — Split Dialex into per-service repos; this repo becomes shared platform infra

> Reached via a brainstorming conversation about evolving Dialex into a multi-product platform (the user has three other already-built client products — an AI cofounder agent, an EcosystemAI-style multi-agent business-automation suite, and an XTTS voice-cloning pipeline — to consolidate with improvements). Architectural on every count: new repos, a cross-cutting infra pattern change, and a plan to delete a large fraction of this repo's own content.

## Context

The user wants to build all four products' worth of functionality on shared infrastructure, rather than four separate stacks. Two shapes were considered for "unified": one repo per product (rejected — each product would still duplicate its own Django/orchestrator/frontend setup) versus one repo per **service layer**, where each layer repo hosts every product as an internal, isolated module (a Django app per product, an orchestrator module per product, a frontend route-tree per product) — mirroring how Dialex's own Django backend is already organized today (`accounts`/`cases`/`debates`/`consultations`/`reviews`/`notifications` as apps-per-concern). The user chose the service-layer split.

Two facts from reviewing the other three products' actual READMEs shaped the sequencing decision below:
- All four already converge on a similar core stack (Python, FastAPI/Django, LangChain/LangGraph, Postgres, Redis, OpenAI) — a shared backend/orchestrator is realistic, not a stretch goal.
- One of the four products being folded in, EcosystemAI, is itself a direct cautionary tale: it failed specifically because the client insisted on shipping all 9 planned agents simultaneously against explicit advice to ship one, stabilize, then build the next. That lesson applies directly to *this* migration too.

## Decision 1 — Repo per service layer, not per product

`dialex-backend` (Django), `dialex-orchestrator` (FastAPI/Temporal/LangGraph), `dialex-frontend` (Next.js) — each becomes the shared home for every product going forward, with product-level isolation happening *inside* each repo as modules, not via separate repos. This repo (`project-organizer`, historically Dialex's monorepo) is repurposed into the shared **platform-infra** repo — it stops holding product code and instead holds only the infrastructure every service-layer repo depends on (Temporal, Temporal's Postgres, the app Postgres, Redis) via docker-compose.

## Decision 2 — History-preserving extraction, not a fresh start

Each new repo was created via `git filter-repo --path <dir>/ --path-rename <dir>/:` against a fresh clone of this repo, keeping every commit that touched that directory's content (backend: 13 commits, orchestrator: 11, frontend: 23) with the directory's content promoted to the new repo's root. This matches the user's own established practice for consolidating other client-work repos, and preserves the actual build history rather than starting from a single flattened snapshot.

## Decision 3 — Naming

`dialex-` prefix, matching the existing `~/Documents/gt-dp/` local convention this user already uses for a similarly-shaped existing platform (`uni-backend`/`uni-frontend`/`uni-agents`/`uni-platform`, etc.) elsewhere in their own portfolio. All three repos created public on GitHub under `deaxparadox`, matching the original `Dialex` repo's own visibility.

## Decision 4 — Cross-repo networking: a shared external Docker network, not host-port wiring

Django and the orchestrator already address Postgres/Redis/Temporal by **container hostname** (`db`, `redis`, `temporal`), not `localhost` — confirmed directly in `backend/.env`/`orchestrator/.env` and `docker-compose.yml`. Two ways to let each service repo's own docker-compose reach those shared containers once they're no longer all declared in one compose file:

- **Shared external Docker network** (chosen): the platform-infra compose (this repo) creates a named external network (e.g. `dialex-net`); each service repo's own compose file joins that same network by name. Every existing `DATABASE_URL`/`REDIS_URL`/`TEMPORAL_ADDRESS` value stays exactly as it is today — zero env-var changes needed, since container-hostname resolution works identically whether the containers were declared in one compose file or several, as long as they share a network.
- **Host-port wiring** (rejected): every service's connection strings would need rewriting to point at `localhost:<published-port>` instead of the internal service name — real, avoidable churn with no offsetting benefit for a local-dev-only setup.

## Decision 5 — Verification-gated cutover: nothing is deleted until the replacement is proven

The existing `backend/`/`orchestrator/`/`frontend/` directories stay in this repo, unmodified, until the new split-repo + shared-network compose setup is brought up as a whole and put through the same real-browser regression standard this project has used for every milestone (most recently the Angular-to-Next.js cutover, ADR 0012) — not a lighter check just because "the code is the same, only the repo boundary moved." Only after that full pass confirms no functionality was lost does deletion from this repo happen.

## Sequencing

1. **Done** (this ADR documents it retroactively — a process gap, logged here rather than silently left unrecorded): the three repos extracted and pushed.
2. **Done** (2026-09-08, spec 0042): platform-infra compose built here plus each service repo's own compose, joined via the shared external network `dialex-net`.
3. **Done** (2026-09-08): brought up the full split stack and ran the end-to-end real-browser journey (register → login → Home → My debates → a real consultation → a live debate run with genuine WS streaming → Human Review/verdict → notifications → logout/login/reload/logout) against the *new* split setup specifically — passed clean, zero functionality lost. See spec 0042 and CHANGELOG.md for the full verification detail, including two non-blocking findings logged in TODO.md.
4. **Done** (2026-09-08, explicit user go-ahead given after step 3's PASS): `backend/`/`orchestrator/`/`frontend/` deleted from this repo; `CLAUDE.md` gained a "Repo layout" section documenting the split and the local-dev bring-up order. This ADR is now fully closed.

## What this doesn't cover

Any of the actual multi-product platform work (the cofounder agent, voice cloning, the EcosystemAI-style orchestration suite) — that starts only after this split is proven stable, one product at a time, per the EcosystemAI lesson above. This ADR is scoped to the infrastructure split alone.
