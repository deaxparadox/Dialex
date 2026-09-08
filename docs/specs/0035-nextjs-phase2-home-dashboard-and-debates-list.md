# Spec 0035 — Next.js Phase 2: Home dashboard + My debates list

Implements Phase 2 of ADR 0012 / spec 0033, and — for the Home dashboard specifically — Decision 1 of ADR 0011 (designed in spec 0032, never built in Angular; folds into this migration per ADR 0012 decision 4). Branch `migration/nextjs-frontend`.

## Root cause / current state, verified directly (not assumed)

- `frontend/src/app/features/debate/debates-list/{debates-list.ts,.html,.css}` (read in full): fetches `GET /api/debates/` + `GET /api/cases/` in parallel, joins client-side by `case_id` into `{id, caseType, statusDisplay, createdAt}` rows, renders a flat list sorted however the API returns it (no explicit sort). Loading/error/empty states are plain conditional blocks. `HumanizeSlugPipe` (`frontend/src/app/shared/pipes/humanize-slug-pipe.ts`) is a 4-line pure function (`"loan_approval"` → `"Loan approval"`) with no Angular-specific behavior — a direct plain-function port.
- `ApiDebate` (`frontend/src/app/features/debate/data/debates-api.ts`): `status` is one of `Debate.Status` (Django, verified: `OPEN`, `ARGUING`, `CONVERGING`, `JUDGED`, `NO_CONSENSUS`, `FAILED`). No `human_review` field exists yet — that's spec 0033 Phase 5, not built.
- ADR 0011 decision 1 (verified against the doc): Home buckets into **"Needs your review"** (`JUDGED`/`NO_CONSENSUS`, oldest first) and a slimmer **"In progress"** strip (live debates), with `/debates` staying the full, unbucketed archive — a superset of Home's curated excerpt. Spec 0033's own Phase 2 line already pins "In progress" to `ARGUING`/`CONVERGING` specifically. `OPEN` (not yet started) and `FAILED` debates appear only in the full `/debates` archive, not on Home — consistent with ADR 0011's framing of Home as a curated excerpt, not everything.
- Known, deliberate gap carried forward from spec 0033: since `HumanReview` doesn't exist as a backend model/field yet (Phase 5), "Needs your review" can only bucket by `status` today — it cannot yet exclude a `JUDGED`/`NO_CONSENSUS` debate that's already been reviewed, because nothing persists that fact yet. Not a bug to fix here; Phase 5 closes this gap for real.
- Phase 1 (spec 0034) left `(protected)/page.tsx` as a placeholder ("You're logged in." + logout) — this phase replaces it with the real Home dashboard, and the `(protected)` route group currently has no shared nav, because it only ever had one page.

## Fix

### 1. Shared data layer

`frontend-next/src/lib/debates-api.ts` — the same `ApiPersona`/`ApiVerdict`/`ApiDebate`/`ApiCase` shapes ported as TypeScript interfaces (byte-for-byte field names, so the backend contract stays the single source of truth), plus a `useDebatesApi()` hook (built on Phase 1's `useApiFetch`) exposing `listDebates()`/`listCases()` — the first real consumer of that hook.

`frontend-next/src/lib/humanize-slug.ts` — `humanizeSlug(value: string | null | undefined): string`, the same plain-function logic as `HumanizeSlugPipe`, called directly wherever the Angular version used the pipe (no Next.js/React equivalent of Angular pipes needed — it was already framework-agnostic).

### 2. `(protected)/debates/page.tsx` — the full archive, direct port

Fetches `listDebates()` + `listCases()` in parallel, joins client-side by `case_id` exactly like `debates-list.ts`, renders the same three states (loading/error/empty) plus the row list — Tailwind utility classes standing in for `debates-list.css`. The empty state's "Start your first case" link is **dropped for this phase**, not ported: it points at `/consultation`, which doesn't exist yet in `frontend-next/` until Phase 3 — a dead link would be worse than no link. Revisit once Phase 3 lands.

### 3. `(protected)/page.tsx` — replaces the Phase-1 placeholder with the real Home dashboard

Fetches the same `listDebates()`/`listCases()`, buckets client-side into `needsReview` (`status` in `JUDGED`/`NO_CONSENSUS`, sorted oldest-first by `created_at`) and `inProgress` (`status` in `ARGUING`/`CONVERGING`, oldest-first) — both empty-state-aware ("Nothing needs your review right now." / "No debates in progress."). Each row links straight to `/debates/{id}`, same shape as the archive's rows (case type via `humanizeSlug`, status label, date). No kanban, no unified feed — matching ADR 0011 decision 1's rejected alternatives.

### 4. A minimal nav for `(protected)`

`(protected)/layout.tsx` gains a small top nav bar (`Home` / `Debates` links + a logout button, moved out of the old placeholder page) — the first time this route group has needed one, since Phase 1 had only a single page. This is **not** ADR 0011 decision 1's full nav shell (no "New case" link yet — `/consultation` doesn't exist until Phase 3; no theme picker or notification bell yet — those are Phase 6/a later polish pass) — just enough structure for two real pages to coexist.

## Explicitly out of scope

Consultation chat, debate thread, Human Review, notifications — Phases 3-6. Any new backend endpoint (both screens use exactly what `frontend/` already consumes). The full ADR 0011 nav shell (brand/theme picker, notification bell, "New case" entry) — later phases. Excluding already-reviewed debates from "Needs your review" — blocked on Phase 5's `HumanReview` model existing at all.

## Verification plan

Real browser, both apps running side by side: log in with an account that has a genuine mix of `OPEN`/`ARGUING`/`JUDGED`/`NO_CONSENSUS` debates (seed via Django admin or real consultation/debate runs if needed) and confirm Home's two buckets contain exactly the right debates in the right oldest-first order, `OPEN`/`FAILED` debates excluded from both; confirm `/debates` still shows every debate regardless of status, same as the Angular archive would for the same account. Confirm empty states render correctly for a fresh account with zero debates. Confirm case-type labels humanize correctly (e.g. `loan_approval` → "Loan approval") and match `frontend/`'s own rendering for the same data. Nav: Home/Debates links navigate correctly, logout still works from the new location. Regression: `frontend/` untouched, its own test suite still green.

## Found during verification

Seeded a real test user (`nextjs_phase2_qa`) directly in Postgres with exactly one debate per `Debate.Status` value (`OPEN`/`ARGUING`/`CONVERGING`/`JUDGED`/`NO_CONSENSUS`/`FAILED`), then verified with a real Canary browser session:
- Home (`/`) showed exactly 2 rows under "Needs your review" (Judged, No consensus) and exactly 2 under "In progress" (Arguing, Converging) — 4 total, `OPEN`/`FAILED` correctly excluded from the whole page.
- `/debates` showed all 6, every status included.
- Case type rendered as "Loan approval" (humanized), not the raw `loan_approval` slug, on every row.
- Nav (Home ↔ Debates ↔ logout) all worked; clicking a debate row correctly hit Next's built-in 404 page (expected — `/debates/{id}` doesn't exist until Phase 4), no crash.
- Zero unexpected console errors. `frontend/` (Angular) confirmed unaffected — 40/40 tests still pass.

No bugs found this phase.

## Status

Implemented and verified against the real running stack. Closes Phase 2 of ADR 0012/spec 0033. Phase 3 (consultation chat) is next, its own spec (0036+) to be written before it starts.

## Branch

`migration/nextjs-frontend` (continuing).
