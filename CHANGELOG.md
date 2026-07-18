# Changelog

## 2026-07-18 (backend + infra)

- Scaffolded the Django backend (`backend/`) — Django 5.2 LTS, custom `User` model before the first migration, `src/`-layout with a split `config/settings/{base,development,production}.py`, `psycopg` (v3), `django-environ` for fail-loud required config — per [docs/adr/0002-backend-architecture.md](docs/adr/0002-backend-architecture.md).
- Implemented the full locked data model across 6 apps (`accounts`, `cases`, `debates`, `consultations`, `reviews`, `notifications`) per `references/002-design-review-findings.md`, with Django admin registered for every model. See [docs/specs/0002-backend-scaffold-and-infra.md](docs/specs/0002-backend-scaffold-and-infra.md).
- Brought up `docker-compose.yml` covering every service with real code to run: app Postgres, Django, self-hosted Temporal (+ its own separate Postgres + Web UI, per decision 2a), Redis. FastAPI isn't in compose yet — no code exists for it.
- Verified end to end: migrations applied cleanly against the containerized Postgres, `manage.py check` clean, admin login page and Temporal Web UI both reachable, Redis responds to `PING`.
- Remapped several container ports off their defaults (Postgres 5432→5433, Redis 6379→6380, Temporal UI 8080→8088) — this dev machine already had other services bound to the defaults.
- Caught and fixed a real bug during setup: a randomly-generated Django secret key containing `$` characters was being misinterpreted by Docker Compose's env-file variable substitution — regenerated without special characters rather than escaping around it.

## 2026-07-18 (frontend)

- Scaffolded the Angular frontend (`frontend/`) via `ng new` — Angular 22, standalone components, zoneless change detection, Vitest — per [docs/adr/0001-frontend-architecture.md](docs/adr/0001-frontend-architecture.md). Required installing Node 24.18.0 LTS via `nvm` (pinned in `.nvmrc`); the environment's prior Node 22.20.0 was below Angular CLI 22's minimum.
- Built the live-debate "thread" view (`features/debate/debate-thread`) as a real, interactive component driven by mock data: arguments plotted on a divergence-to-convergence axis by round, click-to-read reading panel with a word-by-word streaming reveal, Light/Dark and Minimal/Detail toggles. Iterated on with the user directly in the running app (not just static previews) — see [docs/specs/0001-frontend-scaffold-debate-thread.md](docs/specs/0001-frontend-scaffold-debate-thread.md).
- Established the app's card-based visual language: a `--page`/`--ground` token split so panels read as distinct elevated surfaces on a darker page background, rather than a single flat color split by hairlines.
- Fixed a real bug caught during verification: `window.matchMedia` isn't a function in the Vitest/jsdom test environment — guarded with proper feature detection instead of assuming its presence.
