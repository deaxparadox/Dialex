# Spec 0042 — Platform-infra compose split, verified before any deletion

Implements ADR 0013's sequencing steps 2-3: build the split compose architecture, verify it end to end against the real split repos. Does **not** include deleting anything from this repo — that's ADR 0013's step 4, a separate, later action gated on this spec's own verification passing.

## Root cause / current state, verified directly (not assumed)

- `docker-compose.yml` (30-line service list, read in full): `db`, `django` (`build: ./backend`), `orchestrator`/`orchestrator-worker` (`build: ./orchestrator`), `temporal-postgresql`, `temporal`, `temporal-ui`, `redis`. Everything on one implicit default network (`dialex_default`), addressed by service name.
- **A real dependency the split has to account for**: `temporal`'s service definition mounts `./backend/dynamicconfig:/etc/temporal/config/dynamicconfig` — this is Temporal's own dynamic-config YAML (`development-sql.yaml`), historically placed under `backend/` for no reason tied to Django itself (confirmed: the one file in that directory is pure Temporal config). Since `backend/` is leaving this repo, this file needs to actually live wherever the platform-infra compose lives (here), not just inside `dialex-backend` (where the `git filter-repo` extraction already put a copy, since it was physically under `backend/` at extraction time).
- `django`/`orchestrator`/`orchestrator-worker` all reach Postgres/Redis/Temporal via container hostname (`db`, `redis`, `temporal`), never `localhost` — confirmed via the `DATABASE_URL`/`REDIS_URL` override lines in the compose file itself. This is what makes the external-network approach (ADR 0013 decision 4) work with zero env-var changes.
- `dialex-backend`/`dialex-orchestrator`/`dialex-frontend` (created per ADR 0013) currently have no compose file of their own at all — each is just the extracted application code.
- `frontend/` has never been containerized in this project's whole history (verified: no `frontend` service ever existed in this compose file) — it always ran via `ng serve`/`npm run dev` directly against the host-published ports of the other services.

## Fix

### 1. Relocate Temporal's dynamic config

Move `backend/dynamicconfig/development-sql.yaml` → `dynamicconfig/development-sql.yaml` at this repo's root (a platform-infra concern, not a Django one). Leave the copy that already exists in `dialex-backend` alone — it's dead weight there now but touching that repo isn't this spec's job, and removing it doesn't affect anything functionally.

### 2. This repo's `docker-compose.yml` becomes platform-infra only

Keep `db`, `redis`, `temporal`, `temporal-postgresql`, `temporal-ui` — remove `django`/`orchestrator`/`orchestrator-worker` entirely. Add a named external network:
```yaml
networks:
  dialex-net:
    name: dialex-net
```
Every remaining service joins it explicitly (`networks: [dialex-net]`). Update `temporal`'s volume mount to the relocated path (`./dynamicconfig:/etc/temporal/config/dynamicconfig`).

### 3. `dialex-backend`'s own `docker-compose.yml` (new)

One service, `django`, built from its own root (`build: .`, no longer `./backend` since this repo's root *is* the Django project now). Same `DATABASE_URL` override pointing at `db:5432` (works unchanged — `db` resolves via the shared external network). Declares `dialex-net` as an **external** network (`networks: {dialex-net: {external: true}}`) rather than creating it — this repo doesn't own the network's lifecycle, the platform-infra repo does.

### 4. `dialex-orchestrator`'s own `docker-compose.yml` (new)

Same pattern: `orchestrator` + `orchestrator-worker` services, built from its own root, same env vars, external `dialex-net` reference.

### 5. `dialex-frontend`

No compose file — matches the standing precedent (never containerized), runs via `npm run dev` against the other services' already-host-published ports exactly as it does today. (Flagged to the user as a deliberate choice, not an oversight — revisit if there's a specific reason to containerize it now.)

## Explicitly out of scope

Deleting `backend/`/`orchestrator/`/`frontend/` from this repo — ADR 0013 step 4, only after this spec's verification passes. Any change to CLAUDE.md — bundled with the deletion step, not this one (documenting a layout that isn't final yet would immediately go stale). Any of the actual multi-product platform work.

## Verification plan

Bring up the **platform-infra compose here first** (creates `dialex-net`, starts db/redis/temporal/temporal-ui) — confirm all healthy. Bring up `dialex-backend`'s compose (`django`) and `dialex-orchestrator`'s compose (`orchestrator`+`orchestrator-worker`) separately, each joining the existing external network — confirm both can actually reach `db`/`redis`/`temporal` (a real migration run, a real Temporal worker registration, not just "container started"). Run `dialex-frontend` via `npm run dev`. Then the **same full real-browser regression journey** used for the Angular-to-Next.js cutover (ADR 0012/spec 0041): register → log in → Home dashboard → My debates → New case (a genuine multi-turn consultation) → start and watch a live debate run (real WebSocket streaming, not just page-loads) → Human Review submission → notifications → logout → login → session-restore-on-reload → logout — run against **this split setup specifically**, not the old monorepo compose. Confirm zero functionality gaps and zero new console/server errors introduced purely by the repo/network boundary change. Only a fully clean pass here authorizes ADR 0013's deletion step.

## Branch

Continuing on `main` (repo-infra work, not a feature branch — matches how compose/config changes have been handled throughout this project).
