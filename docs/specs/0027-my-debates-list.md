# Spec 0027 — "My debates" history list

No ADR — a new route + component using this codebase's existing patterns exactly (ownership-scoped list fetch, join client-side, standalone Angular component), not a new architecture/dependency/cross-cutting pattern. Closes the gap `debate-thread.html`'s own placeholder text already named: *"No debate selected — open one via a direct link for now (a 'browse my debates' list is a separate, not-yet-built screen)"*.

## Root cause / current state, verified directly (not assumed)

Nothing to build on the backend — both endpoints this needs already exist, are already ownership-scoped (`get_queryset` filtering, not fetch-then-check — the IDOR-avoidance pattern this codebase already learned, spec 0005/0008), already unpaginated (no `DEFAULT_PAGINATION_CLASS` configured), and already ordered `-created_at`:
- `GET /api/debates/` (`DebateListView`, `backend/src/apps/debates/views.py:12`) — returns `DebateSerializer` rows: `id`, `case_id`, `status`/`status_display` (spec 0025), `turn_strategy`, `judge_persona`, `verdict`, timestamps. No nested case type.
- `GET /api/cases/` (`CaseListView`, `backend/src/apps/cases/views.py:7`) — returns `id`, `type`, `status`, `created_at`.

Neither response nests the other, so a useful list row (case type + debate status) needs a client-side join on `case_id` — reusing two already-verified endpoints rather than adding a backend join/nested-serializer field for a purely cosmetic list-row need.

Scoped with the user: debates only, not consultations (no read API exists for those at all yet — a separate, larger effort, not touched here).

## Design

**New route**, replacing the current bare `''` → `DebateThread` mapping:
```ts
// app.routes.ts
{ path: 'debates', component: DebatesList, canActivate: [authGuard] },
{ path: 'debates/:id', component: DebateThread, canActivate: [authGuard] },
{ path: 'consultation', component: ConsultationChat, canActivate: [authGuard] },
{ path: '', redirectTo: 'debates', pathMatch: 'full' },
```
`''` becomes a real redirect to `/debates` instead of rendering `DebateThread` with no id — the brand logo (`routerLink="/"`, `app.html:4`) then lands on the actual list, not a placeholder. This makes `DebateThread`'s existing `noDebateSelected` signal/branch (`debate-thread.ts:176`, `debate-thread.html:3-7`) permanently unreachable — deleted, not left as dead code, along with its placeholder text and `.state-sub` CSS rule if nothing else uses it.

**New component**, scaffolded via `ng generate component features/debate/debates-list` (matching the existing `features/debate/debate-thread` folder convention):
- Fetches `listDebates()` and `listCases()` in parallel (two new `DebatesApi` methods: `GET /api/debates/`, `GET /api/cases/` — the existing single-item `getCase(id)` already hits the same base path).
- Joins client-side: a `Map<number, ApiCase>` keyed by `id`, looked up per debate by `case_id`.
- Renders one row per debate: humanized case type (reusing `HumanizeSlugPipe`, spec 0025), humanized status (`status_display`, spec 0025), a formatted date (a plain component method following this codebase's existing convention — `debate-thread.ts:376`'s `timeFor()` uses `toLocaleTimeString`, not Angular's `DatePipe` — a new `dateFor()` method here uses `toLocaleDateString`), and a `routerLink` to `/debates/{id}`.
- Ordering: trust the API's existing `-created_at` order, no client-side re-sort.
- Empty state: no debates yet → a message plus a link to `/consultation` ("Start your first case"), not a bare blank list.
- Loading/error states follow the existing `state-message`/`.error` class conventions already used in `consultation-chat`/`debate-thread`, including the same `animate.enter`/`animate.leave` treatment spec 0026 just added for `.error` messages elsewhere.

**Navbar** (`app.html`): add `<a routerLink="/debates">My debates</a>` to `.topbar-nav`, alongside the existing "New case" link.

## Explicitly out of scope

Consultation history (needs new backend read endpoints — not started). Pagination (no user has anywhere near enough debates yet to need it; revisit if that changes). Filtering/search. Any change to `DebateSerializer`/`CaseSerializer` — both already return everything this needs.

## Verification plan

- `npx ng test` — full suite plus new specs for `DebatesList` (loading state, populated list with correct join/humanization, empty state, error state).
- Real browser: log in as a user with existing debates, confirm `/` redirects to `/debates` and lists them, most-recent-first, each row showing a humanized case type and status; click through to a debate and confirm it still loads correctly; log in as a fresh user with zero debates and confirm the empty state renders with a working link to start one; confirm the navbar's new "My debates" link works from every other screen.
- Confirm ownership scoping holds: a second real user's debates never appear in the first user's list (the backend already guarantees this — confirm the frontend doesn't accidentally show anything extra, e.g. from a stale cache).

## Branch

Continuing on `main`.

## Found during verification

No bugs in the shipped code. One real, unrelated infrastructure problem surfaced during the first verification attempt, root-caused rather than worked around:

The orchestrator-worker container had lost all internet egress — not specific to OpenAI, a raw socket connect to any external IP (`8.8.8.8:443`, `api.openai.com:443`) timed out, while DNS resolution still worked (resolves locally via Docker's embedded resolver, independent of NAT) and the host machine reached the internet fine. Compared the project's `dialex_default` Docker network (created 2026-07-30, containers running continuously since) against a brand-new plain-`bridge` test container created live during debugging — the new one reached the internet immediately, and its network showed a `Created` timestamp from *today*, revealing the Docker daemon itself had restarted at some point since the prior session. A daemon restart re-establishes NAT/MASQUERADE iptables rules only for networks it initializes fresh; a long-running network whose containers survive the restart keeps stale/missing rules for its own subnet. Fixed, with the user's explicit approval (it briefly stops the whole stack): `docker compose down && docker compose up -d`, recreating `dialex_default` with fresh rules — confirmed via a direct socket-connect test from inside the container (0.02s to `api.openai.com`, down from a 16s timeout) before re-running verification. No data loss (named volumes persist across the recreate).

Re-verified clean end to end after the fix, real browser, fresh test user:
- Empty state (0 debates) confirmed correct both before and after the network fix, cross-checked against Postgres.
- A real consultation negotiated to approval (6 genuine back-and-forth turns, well within the ~60s Activity timeout now that the network issue was fixed) created a real Case + Debate.
- The new debate appeared in `/debates` with the correct humanized case type ("Loan approval") and status ("Open"), reached via the navbar link (not URL typing); clicking the row navigated to the exact right `/debates/:id`.
- The navbar's "My debates" link confirmed working from the debate detail page too (the one check the first, network-blocked pass couldn't reach).
- Ownership scoping confirmed with real data, not just reasoning about the backend filter: a direct Postgres query showed 47 total debates across 15 users in the database, and exactly 1 for the fresh test user — matching precisely what the UI showed.
- Zero console errors throughout either pass.

## Status

Implemented and verified against the real running stack. Closes the "browse my debates" gap named in `docs/FLOWS.md` since spec 0019.
