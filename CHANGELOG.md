# Changelog

## 2026-07-18

- Scaffolded the Angular frontend (`frontend/`) via `ng new` — Angular 22, standalone components, zoneless change detection, Vitest — per [docs/adr/0001-frontend-architecture.md](docs/adr/0001-frontend-architecture.md). Required installing Node 24.18.0 LTS via `nvm` (pinned in `.nvmrc`); the environment's prior Node 22.20.0 was below Angular CLI 22's minimum.
- Built the live-debate "thread" view (`features/debate/debate-thread`) as a real, interactive component driven by mock data: arguments plotted on a divergence-to-convergence axis by round, click-to-read reading panel with a word-by-word streaming reveal, Light/Dark and Minimal/Detail toggles. Iterated on with the user directly in the running app (not just static previews) — see [docs/specs/0001-frontend-scaffold-debate-thread.md](docs/specs/0001-frontend-scaffold-debate-thread.md).
- Established the app's card-based visual language: a `--page`/`--ground` token split so panels read as distinct elevated surfaces on a darker page background, rather than a single flat color split by hairlines.
- Fixed a real bug caught during verification: `window.matchMedia` isn't a function in the Vitest/jsdom test environment — guarded with proper feature detection instead of assuming its presence.
