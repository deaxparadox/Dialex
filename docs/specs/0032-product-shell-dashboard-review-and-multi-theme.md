# Spec 0032 — Product shell, dashboard, Human Review, notifications, multi-theme system

See [ADR 0011](../adr/0011-product-shell-and-multi-theme-system.md) for the why. This spec is the umbrella design for the whole-product IA pass reached via brainstorming with the user (branch `redesign/product-shell-multi-theme`); it's sequenced into phases below, each of which becomes its own implementation spec (0033+) rather than landing as one giant patch — consistent with this repo's existing one-spec-per-milestone history.

## Current state, verified directly (not assumed)

- `app.routes.ts`: `''` redirects to `/debates` (spec 0027); no home/dashboard component exists.
- `app.html`: a single flat `.topbar-nav` — "My debates", "New case", a bare logout button. No notification affordance, no account menu.
- `debate-thread.html`: light/dark and Minimal/Detail toggles both live in this one page's `header-card` (lines 9-16); no review panel of any kind exists under the verdict entry.
- **Backend: `HumanReview` and `Notification` Django models exist and are migrated** (`backend/src/apps/reviews/models.py`, `backend/src/apps/notifications/models.py`, scaffolded at spec 0002) — but both apps' `views.py` are still the untouched `django-admin startapp` stub (`# Create your views here.`), and neither has a `urls.py` or is wired into `config/urls.py`. Zero REST surface exists for either today.
- Orchestrator (`orchestrator/app/`): no code publishes to an `app_notifications` Redis channel or any per-user notification channel — decision 17's "general notifications" mechanism is entirely unbuilt on the backend, only decision 12's per-debate streaming (ADR 0006) exists today.
- `styles.css`: one token set, light/dark variants only (ADR 0001). No `data-brand` concept exists.

## Phase 1 — Multi-theme token system (frontend only)

- Rewrite `styles.css`'s `:root` block into four compound-selector token sets: `:root[data-brand="citrus"]` (default, no attribute needed for the base case), `:root[data-brand="citrus"][data-theme="dark"]`, `:root[data-brand="electric"]`, `:root[data-brand="electric"][data-theme="dark"]` — plus the existing `@media (prefers-color-scheme: dark)` fallback for whichever brand is active when the user hasn't explicitly picked a mode. Exact hex values per the four confirmed mockups (Citrus-light/dark, Electric-light/dark) from the brainstorming session.
- New status-color tokens (`--status-action`, `--status-live`, `--status-done` — final names decided at implementation, following the existing `--divergence`/`--convergence`/`--judge` naming style) defined per brand/mode, deliberately independent of `--divergence`/`--convergence` (ADR 0011 Decision 2).
- A small `core/theme` service (Signals, per ADR 0001's state-management rule for local/global UI preference): reads/writes `data-brand`/`data-theme` on `document.documentElement`, persists both to `localStorage` (same "personal display preference, not shared state" precedent as spec 0007's existing theme choice), defaults to `brand: "citrus"` with no stored value (mode keeps following system preference until explicitly overridden, unchanged from today).
- Nav gets the two new controls (a `<select>` for brand, a switch for mode) in the utility cluster — see Phase 2. `debate-thread.html`'s own light/dark toggle buttons (lines 9-11) are deleted; its Minimal/Detail toggle is untouched.

## Phase 2 — Nav shell + Home dashboard

- `app.html`: replace the flat `.topbar-nav` with two clusters — primary (`Home`, `Debates`, `New case`) and utility (notification bell — placeholder/no-op until Phase 4a, brand `<select>`, mode switch, account menu holding logout).
- New `Home` component (`ng generate component features/dashboard/home`), route `{ path: '', component: Home, canActivate: [authGuard] }` replacing today's redirect.
- Data: reuse `listDebates()`/`listCases()` (spec 0027's existing `DebatesApi`, already ownership-scoped) — no new backend endpoint required for this phase. "Needs your review" = client-side filter `status IN (JUDGED, NO_CONSENSUS)` AND (once Phase 4 ships) no `human_review` present on the row; until Phase 4 ships, this filters on status alone. "In progress" = `status IN (ARGUING, CONVERGING)`. Both sorted oldest-first within their section (surfacing what's waited longest).
- Empty state: both sections empty → a nudge to `/consultation`, not a blank page.
- `/debates` (existing `DebatesList`, spec 0027) gets status chips (new status tokens from Phase 1) and two facets (case type, status) added to its existing rows — no backend change, `case_type`/`status` are already on each joined row.

## Phase 3 — Human Review

**Backend** (`apps/reviews/`): a `HumanReviewSerializer` + a view exposing `POST /api/debates/{id}/review/` (create, ownership-checked against the debate's `created_by`, 409 if a review already exists — the model's `OneToOneField` on `debate` already enforces this at the DB level, the view just needs to surface it as a clean 409 not a 500) and folding the review (if present) into the existing `GET /api/debates/{id}/` response (`DebateSerializer` gains a nested `human_review` field, null if not yet reviewed) rather than a separate fetch — the debate detail page already owns loading this data. `decision_options` for the button choices come from the existing `CaseTypeConfig` already loaded for the case (decision 5c/8) — no new config surface needed, just wiring what already exists.

**Frontend**: a review panel appended to `debate-thread.html` under the verdict entry, shown when `d.status` is `JUDGED` or `NO_CONSENSUS`. Renders `CaseTypeConfig.decision_options` as buttons (empty list → comment-only, matching decision 5c exactly) plus a required comment textarea and a submit action; once `d.human_review` is present (own submission or reload), renders read-only (decision, comment, reviewer, timestamp) instead of the form. No new route.

## Phase 4a — Notifications: persisted read path (no live push yet)

Ships the browsable half first, matching this repo's own precedent (spec 0008 shipped real data over polling before specs 0013/0014 added push) — the live-push half (4b) is a materially separate piece of work (an orchestrator-side publish call plus a new FastAPI relay endpoint, comparable in shape to ADR 0006's per-debate streaming work) and shouldn't block shipping a working notifications screen.

**Backend** (`apps/notifications/`): `GET /api/notifications/` (ownership-scoped to the requesting user, `-created_at` ordered — the model's `Meta.ordering` already does this) and `PATCH /api/notifications/{id}/` (mark read, ownership-checked). No creation endpoint from the frontend — `Notification` rows are only ever created server-side (Phase 4b, and future lifecycle-event hooks).

**Frontend**: bell icon in the nav utility cluster opens a drawer listing recent notifications (unread first), each linking to its `related_debate`/`related_case`; a "view all" link opens a new `/notifications` route (paginated-by-scroll archive of the same data, no new backend shape needed beyond the list endpoint above). Until 4b ships, the bell has no live badge — it's populated on load/navigation only, honestly not claiming real-time.

## Phase 4b — Notifications: live push (fast-follow)

Extends ADR 0006's existing pattern rather than inventing a new one: orchestrator publishes to a single shared `app_notifications` Redis channel (decision 17) at the lifecycle points it names — research starting, debate starting/ending, consultation completed — creating a `Notification` row at the same time (never push-only). FastAPI needs a new relay surface for this shared channel (decision 17 specifies per-user in-memory routing at the FastAPI layer, distinct from the existing per-debate `WS /api/debates/{id}/stream` channel-per-debate model) — exact transport (a second WebSocket vs. SSE) decided at implementation time against current FastAPI/Starlette docs, per this repo's verify-don't-recall rule. Frontend: the nav bell gets a live unread badge and the drawer updates without a manual refresh.

## Explicitly out of scope

- Any change to `DebateSerializer`'s existing fields beyond adding `human_review` (Phase 3).
- Pagination on `/debates` or `/notifications` beyond what's specified (revisit if real volume ever justifies it — no user is near that today, same call spec 0027 already made).
- A third brand theme, or a "custom theme" builder — two brands, as decided.
- Any backend `display_name`/color field on `CaseTypeConfig` — case-type visual distinction stays label/icon-only (ADR 0011 Decision 2), computed client-side exactly like `HumanizeSlugPipe` already does.
- Consultation history/list screen — still blocked on "no read API exists for consultation turns" (unchanged gap, noted since spec 0027).

## Verification plan (per phase, at implementation time)

Each phase gets its own real-browser verification against the running stack, following this repo's existing standard (not a glance — DOM/computed-style checks, real data, ownership-scoping checks where a new endpoint is added): Phase 1 — all four brand/mode combinations checked for contrast on at least the Home and Debate Thread screens; Phase 2 — a real account with a mix of judged/live/reviewed debates confirms correct bucketing and sort order; Phase 3 — a real `research_debate` (empty `decision_options`) and a real `loan_approval` (non-empty) both confirm the comment-only vs. buttons rendering, plus a real 409 on double-submit and ownership-IDOR check on the new endpoint; Phase 4a — ownership scoping on the new list endpoint, mark-read persists across reload; Phase 4b — a real lifecycle event (e.g. starting a debate) confirms the badge/drawer update live without a manual refresh, and confirms the underlying `Notification` row still exists if the client is disconnected when it fires (the actual point of decision 17's persisted-record design).

## Branch

`redesign/product-shell-multi-theme` (created for this initiative; not merged to `main` until each phase's implementation is reviewed).
