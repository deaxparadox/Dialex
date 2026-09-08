# Spec 0041 — Next.js Phase 7: cutover

Final phase of ADR 0012/spec 0033. Deletes the Angular frontend, promotes `frontend-next/` to `frontend/`, and retires the now-unnecessary dual-origin config both backend services carried for the whole migration. Branch `migration/nextjs-frontend`.

## Root cause / current state, verified directly (not assumed)

- Phases 2-6 (specs 0035-0040) cover every route Angular's `app.routes.ts` defines (`/login`, `/register`, `/debates`, `/debates/:id`, `/consultation`, `''`→redirect) plus the two screens ADR 0011 designed but never built in Angular (Home dashboard, Human Review — Notifications didn't exist in either frontend before this migration). `frontend-next/`'s route list, verified via `next build`'s own output: `/`, `/login`, `/register`, `/debates`, `/debates/[id]`, `/consultation`, `/notifications`.
- `backend/src/config/settings/base.py`'s `CORS_ALLOWED_ORIGINS`/`CSRF_TRUSTED_ORIGINS` and `orchestrator/app/core/config.py`'s `cors_allowed_origins` all still default to `["http://localhost:4200", "http://localhost:3000"]` (spec 0034/0036's additions) — `:4200` becomes dead weight once Angular is deleted, not a config to keep "just in case."
- `frontend/README.md` is the only remaining live doc reference to port 4200 outside historical logs (`CHANGELOG.md`/`TODO.md`, which document what was true at the time and shouldn't be rewritten) — it's deleted along with the rest of `frontend/`.
- No `docker-compose.yml`/CI config references `frontend/` at all (verified via grep) — the Angular app was always run directly (`ng serve`), never containerized. Cutover's "deployment docs" surface is small: `docs/API.md`/`docs/FLOWS.md`'s dual-frontend framing (every phase's changelog/FLOWS entries so far have said "Next.js only" / "Angular confirmed unaffected" — those become misleading once there's only one frontend) and nothing else.
- `frontend-next/`'s own `README.md` is still `create-next-app`'s generated boilerplate — fine to keep as the dev quickstart once renamed, no reason to hand-write a new one.

## Fix

### 1. Final regression pass (before deleting anything)

A full real-browser pass through every route in `frontend-next/` against the live backend stack — not a re-verification of each phase's own already-passed checks, but a single continuous session simulating a real user's path through the whole app: register → log in → Home dashboard → My debates → New case (consultation) → a full debate run → Human Review submission → notifications → log out → log back in (session restore) → log out. Confirms nothing regressed from later phases touching shared files (`layout.tsx`'s nav, `debates-api.ts`, `api-fetch.ts`) since each phase's own isolated verification.

### 2. Delete Angular, promote Next.js

`git rm -r frontend/` (the whole Angular app — `git rm`, not a plain `rm`, so the deletion itself is a reviewable diff, not a silent disappearance). `git mv frontend-next frontend` (preserves file history through the rename rather than a delete+recreate). No content changes to the Next.js app itself in this step.

### 3. Retire the dual-origin config

Remove `http://localhost:4200` from `CORS_ALLOWED_ORIGINS`/`CSRF_TRUSTED_ORIGINS` (Django) and `cors_allowed_origins` (orchestrator) — both default to `["http://localhost:3000"]` only now. A real, if narrow, security tightening: no reason to keep trusting an origin nothing will ever run on again.

### 4. Docs

`docs/API.md`/`docs/FLOWS.md`: every "Next.js only, Angular confirmed unaffected" qualifier from specs 0034-0040 becomes misleading once Angular is gone — reads as "this is the frontend" everywhere, not "the new one." `docs/adr/0012-nextjs-frontend-migration.md`/`docs/specs/0033-nextjs-migration-umbrella.md` get a closing status note (not rewritten — they're a historical record of the decision and plan, same treatment every other closed ADR/spec in this repo gets). `TODO.md`'s product-shell-redesign entry (already noting "Phases 2-5 re-scoped... folds into the Next.js migration") gets a final pointer confirming that fold is now complete.

## Explicitly out of scope

Any new feature or behavior change — this phase moves files and retires now-dead config, nothing else. Notifications live push (spec 0032 Phase 4b) — still a separate, not-requested initiative.

## Verification plan

The regression pass in Fix §1 *is* the verification for this phase — there's no new code to verify beyond "did the move/deletion break anything," confirmed by: `frontend/` (the renamed Next.js app) builds clean (`next build`) and lints clean from its new path; every route above still resolves correctly with no broken relative imports; the backend/orchestrator still start clean with the narrowed CORS config and a real browser session against `localhost:3000` still works (proving `:4200`'s removal didn't accidentally also break the origin that matters); `git log --follow` on a representative moved file (e.g. `frontend/src/app/layout.tsx`) shows its Next.js-era history preserved through the rename.

## Branch

`migration/nextjs-frontend` (continuing) — merge to `main` is a separate, human-directed step per this repo's standing branch-operations rule, not part of this spec.
