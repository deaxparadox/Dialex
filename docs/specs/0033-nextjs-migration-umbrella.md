# Spec 0033 — Next.js frontend migration (umbrella)

See [ADR 0012](../adr/0012-nextjs-frontend-migration.md) for the why. This is the umbrella design for the whole migration, reached via brainstorming with the user (branch `migration/nextjs-frontend`); sequenced into phases below, each becoming its own implementation spec (0034+) written just before it starts — not one giant patch, per the user's explicit instruction and this repo's existing one-spec-per-milestone history.

## Current state, verified directly (not assumed)

- Angular frontend, 17 non-test `.ts` files: `core/auth/{auth,auth-guard,auth-interceptor}.ts`, `core/theme/theme.ts`, 5 feature components (`login`, `register`, `consultation-chat`, `debates-list`, `debate-thread`) each with a paired `.html`/`.css`, and 4 data-layer services (`consultations-api`, `consultation-step-stream`, `debates-api`, `debate-stream`).
- Routes today (`app.routes.ts`): `/login`, `/register` (guest-only), `/debates` (list), `/debates/:id` (thread), `/consultation`, `''` → redirects to `/debates`.
- Backend contracts this frontend already consumes, unchanged by this migration: Django REST (`/api/auth/*`, `/api/cases/*`, `/api/debates/*`, `/api/case-type-configs/`), the orchestrator's `POST /api/consultations/*` + `GET /api/consultations/{id}/stream` (SSE), and `WS /api/debates/{id}/stream`. Full surface in `docs/API.md`.
- `docs/adr/0011-...md`/`docs/specs/0032-...md` already designed (not built) the Home dashboard IA, Human Review panel placement, and Notifications bell/drawer/archive shape — Phases 2/5/6 below implement those designs as-is, not redesign them.
- Next.js: verified against current docs (v16.2.9) — `create-next-app`'s recommended defaults are App Router + TypeScript + Tailwind CSS + ESLint + Turbopack.

## Phase 1 — Scaffold + theme + auth

- `npx create-next-app@latest` (App Router, TypeScript, Tailwind, ESLint — the verified current defaults), in a new top-level `frontend-next/` directory alongside the existing `frontend/` (kept running, unmodified, until Phase 7).
- Rebuild ADR 0011's dual-brand (Citrus/Electric) × light/dark token system in Tailwind's theming approach (exact mechanism — CSS variables via `@theme`, or Tailwind's dark-mode class strategy plus a custom brand variant — decided at implementation time against current Tailwind docs, not memory).
- Port `Auth`'s JWT-cookie/CSRF flow (login, register, refresh, logout) and the route-guard equivalent (Next.js middleware, or a layout-level redirect — decided at implementation time).
- No realtime, no WebSocket/SSE — the smallest slice that proves real backend auth integration end to end.

## Phase 2 — Home dashboard + My debates list

- Port `debates-list`'s data-fetching pattern (`GET /api/debates/`, `GET /api/cases/`, joined client-side) plus ADR 0011's Home dashboard bucketing ("Needs your review" = `JUDGED`/`NO_CONSENSUS`, "In progress" = `ARGUING`/`CONVERGING`, both oldest-first).
- No new backend endpoints — same data sources spec 0027 already established.

## Phase 3 — Consultation chat

- Port the case-type picker, message turn flow (`POST /api/consultations/`, `POST /api/consultations/{id}/messages`, `POST /api/consultations/{id}/approve`), and the SSE step-indicator (`GET /api/consultations/{id}/stream`) — first realtime pattern in the new stack.

## Phase 4 — Debate thread

- Port the debate-thread page: WebSocket token streaming (`WS /api/debates/{id}/stream`), the opening-statement/argument/verdict swap-gap handling (the accumulated behavior of specs 0013-0029), Minimal/Detail view toggle.
- Likely splits into its own two specs once scoped in detail (static rendering of a finished debate first, live streaming second) — decided when this phase actually starts, not here.

## Phase 5 — Human Review

- **Backend**: `POST /api/debates/{id}/review/` (create, ownership-checked, 409 on duplicate — the `HumanReview` model's `OneToOneField` already enforces this at the DB level), `DebateSerializer` gains a nested `human_review` field.
- **Frontend**: the review panel design from spec 0032 Phase 3 (buttons from `CaseTypeConfig.decision_options`, comment-only when empty, read-only once submitted), appended under the debate thread's verdict.

## Phase 6 — Notifications

- **Backend**: `GET /api/notifications/`, `PATCH /api/notifications/{id}/` (spec 0032 Phase 4a's read-path scope — live push, Phase 4b there, stays out of scope here too unless separately requested).
- **Frontend**: bell/drawer/archive per spec 0032 Phase 4a's design.

## Phase 7 — Cutover

- Delete `frontend/` (the Angular app) and `redesign/product-shell-multi-theme` references that no longer apply; update `docs/API.md`/`docs/FLOWS.md`/deployment docs to point at `frontend-next/`; rename `frontend-next/` → `frontend/` in a final step once nothing references the old path.

## Explicitly out of scope

Any backend change beyond what Phases 5/6 need for their own reasons. Notifications live push (spec 0032 Phase 4b) unless the user asks for it separately once Phase 6 starts. Any UI/IA redesign beyond what ADR 0011 already decided — this migrates existing (and already-designed-but-unbuilt) behavior to a new stack, it doesn't re-design it.

## Verification plan (per phase, at implementation time)

Each phase gets its own real-browser verification against the running stack, matching this repo's existing standard — not a glance. Phase 1: real login/register/refresh/logout against the actual Django auth endpoints, both brand/mode combinations checked for contrast. Phase 2: a real account with a mix of judged/live debates confirms correct dashboard bucketing. Phase 3: a genuine multi-turn consultation negotiation through to approval. Phase 4: a full real debate run, token-by-token streaming confirmed frame-by-frame same as specs 0020/0021/0029 were. Phase 5: real 409-on-duplicate-review and ownership-IDOR checks on the new endpoint. Phase 6: ownership scoping on the new list endpoint, mark-read persists across reload. Phase 7: a full regression pass across every route before deleting the old app.

## Status

All 7 phases implemented and verified:
1. Scaffold + theme + auth — spec 0034.
2. Home dashboard + My debates list — spec 0035.
3. Consultation chat — spec 0036.
4. Debate thread (static render + live streaming, split into two sub-specs as anticipated) — specs 0037/0038.
5. Human Review — spec 0039.
6. Notifications (read path) — spec 0040.
7. Cutover (Angular deleted, `frontend-next/` renamed to `frontend/`) — spec 0041.

Migration complete. Not yet merged to `main` — a separate, human-directed step per this repo's standing branch-operations rule.

## Branch

`migration/nextjs-frontend` (created for this initiative; not merged to `main` until each phase's implementation is reviewed, same discipline as the product-shell branch).
