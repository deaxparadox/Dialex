# TODO

## Open

_(nothing open right now)_

## Done

- [x] Implement Django auth endpoints (register/login/refresh/logout) per decision 13/13a, and smoke-test `sqlacodegen` against the real schema (decision 9). See [docs/specs/0003-auth-endpoints.md](docs/specs/0003-auth-endpoints.md). — 2026-07-18
- [x] Scaffold the Django backend (custom user model, `src/`-layout, core domain models across 6 apps) and set up docker-compose for app Postgres, Temporal (+ its own Postgres + Web UI), and Redis. See [docs/specs/0002-backend-scaffold-and-infra.md](docs/specs/0002-backend-scaffold-and-infra.md) and [docs/adr/0002-backend-architecture.md](docs/adr/0002-backend-architecture.md). — 2026-07-18
- [x] Scaffold the Angular frontend project and build the live-debate "thread" screen as a real, interactive component, driven by mock data (no backend yet) — so the validated design can actually be clicked through in a running app rather than judged from a static preview. See [docs/specs/0001-frontend-scaffold-debate-thread.md](docs/specs/0001-frontend-scaffold-debate-thread.md) and [docs/adr/0001-frontend-architecture.md](docs/adr/0001-frontend-architecture.md). — 2026-07-18
