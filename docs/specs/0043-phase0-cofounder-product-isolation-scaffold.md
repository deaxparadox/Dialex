# Spec 0043 — Phase 0: product-isolation scaffold (backend + orchestrator + frontend)

Implements ADR 0014's Decision 1 and Sequencing step 1. Moves Dialex's *existing* code into nested per-product packages/routes so `apps.cofounder.*`/`app.cofounder.*`/a `(protected)/cofounder/*` route group have a real, symmetric place to live alongside it. Zero new functionality — no cofounder-specific code in this spec, restructuring only.

**Revision note**: the first version of this spec kept the frontend untouched and treated Dialex's existing Django app labels/migration history as something to preserve byte-for-byte, since that repo has real dev data behind it. The user has since confirmed the dev DB can simply be wiped and recreated if the restructuring makes that easier — restructuring shouldn't be constrained by data continuity — and asked for full symmetry across all three repos, including the frontend routes. This revision reflects both.

## Root cause / current state, verified directly (not assumed)

**`dialex-backend`** — `apps/{accounts,cases,debates,consultations,reviews,notifications}` sit flat, each `AppConfig.name` set to `apps.<name>` (e.g. `apps/debates/apps.py:6`), registered the same way in `INSTALLED_APPS` (`src/config/settings/base.py:44-49`). Five cross-app imports, all absolute (`grep`-confirmed, nothing missed): `debates/serializers.py`→`reviews.serializers`, `debates/urls.py`→`reviews.views`, `debates/views.py`→`cases.models`, `reviews/views.py`→`debates.models`, `config/urls.py`→`cases.views`. Exactly one string-based cross-app FK (`debates/models.py:41`, `ForeignKey("cases.Case", ...)`) plus `AUTH_USER_MODEL = "accounts.User"` (`config/settings/base.py:32`) — both reference the app **label**, which Django keeps independent of the app's Python import path.

**`dialex-orchestrator`** — `app/{consultations,debates}` sit flat next to `app/core/` (genuinely shared: config, db, observability, redis_client, security, temporal_client — confirmed no product-specific code inside it). All 8 cross-module imports go the same direction, `debates`/`consultations` importing from `core` via relative imports (`from ..core.X`) — never from each other. `main.py` includes both routers via `.consultations.router`/`.debates.router`. `DebateWorkflow`/`ConsultationWorkflow` are both plain `@workflow.defn` with no explicit `name=` — verified against the official Temporal Python SDK docs that this defaults to "the unqualified class name," not the module's dotted path, so moving the module doesn't change anything Temporal-visible.

**`dialex-frontend`** — Dialex's routes sit flat under `(protected)/{consultation,debates,notifications}` plus the Home dashboard at `(protected)/page.tsx` (root `/`). Six reference sites found (`grep`-confirmed, nothing missed): nav links in `(protected)/layout.tsx` (`href="/debates"`, `href="/consultation"`), `consultation/page.tsx:117` (`router.replace('/debates/${id}')`), `_components/notification-bell.tsx:68` (`href="/notifications"`), `debates/page.tsx:49` (`href="/consultation"`), `_components/debate-row-link.tsx:10` and `_components/notification-row.tsx:18` (both `href="/debates/${id}"`). The redirect-preserving line in `layout.tsx:21` (`redirect=${encodeURIComponent(pathname)}`) needs no change — it just captures whatever the current path is. API paths (`/api/debates/...`, `/api/consultations/...`) are backend/orchestrator REST routes, unrelated to these Next.js page routes, and don't move.

## Fix

### `dialex-backend`

1. `git mv apps/{accounts,cases,debates,consultations,reviews,notifications} apps/dialex/` (six directories under a new `apps/dialex/` package, plus `apps/dialex/__init__.py`).
2. Each moved app's `apps.py`: update `name = "apps.dialex.<app>"`. Also add `label = "<app>"` explicitly (matches Django's own documented pattern for a moved/reusable app) — cheap and self-documenting, though no longer load-bearing for data continuity now that a DB wipe is an acceptable fallback.
3. `INSTALLED_APPS` (`config/settings/base.py`): `"apps.accounts"` → `"apps.dialex.accounts"`, same for the other five.
4. Update the five cross-app absolute imports found above to the new dotted path, plus `config/urls.py`'s `cases.views` import.
5. Wipe the dev Postgres data volume and re-run `migrate` fresh on the new structure — simpler than reasoning about whether existing migration history stayed byte-compatible, and the user has confirmed this is acceptable. `apps/__init__.py` (the now-empty former package root) stays as-is; only `apps/dialex/__init__.py` is new.

### `dialex-orchestrator`

1. `git mv app/{consultations,debates} app/dialex/` (plus `app/dialex/__init__.py`). `app/core/` does not move.
2. Update the 8 relative imports inside the moved modules from `..core.X` to `...core.X` (one extra directory level).
3. `main.py`: `.consultations.router`/`.debates.router` → `.dialex.consultations.router`/`.dialex.debates.router`.
4. `worker.py`: update its imports of `DebateWorkflow`/`ConsultationWorkflow`, activities, and graphs to the new `.dialex.*` paths. No change to `@workflow.defn`/`@activity.defn` usage.
5. If Temporal's own datastore (the `temporal-postgresql` volume in the platform-infra repo) has any state referencing these workflows, wipe and recreate it too rather than reasoning about compatibility — same "restructuring, not required to preserve data" principle the user gave for the app DB.

### `dialex-frontend`

1. `git mv "src/app/(protected)/consultation" "src/app/(protected)/dialex/consultation"`, same for `debates` and `notifications` — three routes nested under a new `(protected)/dialex/` segment: `/consultation`→`/dialex/consultation`, `/debates`→`/dialex/debates`, `/notifications`→`/dialex/notifications`.
2. Update the six reference sites found above to the new paths.
3. **Home dashboard (`/`) stays where it is, not nested under `/dialex`** — this is a deliberate call, not an oversight: there is no cross-product landing page/launcher built yet, and inventing one is a separate, unscoped feature decision, not something "symmetry" on its own requires for a pure restructuring pass. `/` remains Dialex's dashboard until a real platform-shell design exists. Flagging this explicitly — say so if you want `/` moved too.

## Explicitly out of scope

Any cofounder-specific code (`apps/cofounder/*`, `app/cofounder/*`, `(protected)/cofounder/*`) — starts in Phase 1, its own spec, only after this phase's verification passes. A cross-product home/launcher page. The new external dependencies the cofounder port will eventually need (Pinecone, Google Places, DALL-E, DuckDuckGo).

## Verification plan

Wipe and recreate the dev Postgres volume (and Temporal's, if needed per the backend/orchestrator fix steps above), then: `python manage.py check`, `python manage.py makemigrations --check --dry-run` (must report nothing pending — a real `name`/`label` mismatch would surface here), `python manage.py migrate` against the fresh DB (must apply cleanly end to end, proving the new app layout is structurally sound, not just importable). Bring up `dialex-orchestrator`'s worker, confirm (via `tctl taskqueue describe`, same check used in spec 0042) it registers a poller identity on `dialex-debates` — proves `DebateWorkflow`'s type identity survived the module move.

Then the full real-browser regression journey (same one used in spec 0042 and every prior cutover, adjusted for the new frontend paths): register → login → Home dashboard (`/`) → My debates (`/dialex/debates`) → a real consultation (`/dialex/consultation`) → a live debate run with real WS streaming → verdict → notifications (`/dialex/notifications`) → logout → login → reload-session-restore → logout — plus a direct check that a bare `/debates` or `/consultation` visit correctly 404s (proves the old routes are actually gone, not just unlinked). Since the dev DB is wiped, this pass necessarily starts from fresh data — that's expected, not a gap. A fully clean pass is required before Phase 1 (any cofounder-specific code) starts.

## Branch

Continuing on `main` in all three repos — matches the precedent set by ADR 0013's own execution (the repo split and its compose work all landed directly on `main`, no feature branch). Flagging this explicitly for confirmation rather than assuming it silently carries forward, since CLAUDE.md's branch rule is human-directed by default.

## Found during implementation

The dev DB wipe (approved explicitly) surfaced a real, previously-undocumented gap: `CaseTypeConfig`/`AgentPersona` reference data (`loan_approval`/`research_debate` and their personas) had never been seeded by anything durable — only ever created by hand via Django shell/admin at some point, with no fixture, migration, or management command reproducing it. This blocked the regression pass entirely (`/api/case-type-configs/` returned `[]`, so the consultation flow had nothing to select). Fixed with a new, idempotent `apps/dialex/cases/management/commands/seed_case_types.py`, checked into `dialex-backend` — this exact gap had already bitten `research_debate` once before (spec 0030's own "found during verification" note), so a durable, re-runnable fix was worth doing here rather than a one-off shell session that would just recreate the same fragility.

Content sourcing, to avoid fabricating anything silently: `loan_approval`'s `required_fields`, `policy_context`, and its two dedicated personas (Credit Risk Officer / Relationship Loan Advisor) are restored **verbatim** from specs 0030/0031, where they were originally drafted and committed in full. `position_options`/`decision_options` are restored from TODO.md's own prior documentation and the model's help text. The Pragmatist/Scale-minded/Moderator personas and both case types' consultant personas have **no recoverable original text anywhere** — asked the user how to proceed rather than guess; per their answer, drafted new content for these five, explicitly labeled as new (not a restoration) in the command's own docstring and inline comments.

## Found during verification

No bugs in the restructuring itself. Verified in two passes (the second after the seed-data fix above): `manage.py check`/`makemigrations --check --dry-run`/`migrate` all clean against a freshly wiped Postgres; `dialex-orchestrator`'s worker re-registered a live poller identity on `dialex-debates`, confirming `DebateWorkflow`'s type identity survived the module move (matches the Temporal SDK docs' documented behavior, not just a hope). Full real-browser regression, real browser navigation (not href-inspection): register → login → Home (`/`, unchanged) → nav to `/dialex/debates` → "start your first case" to `/dialex/consultation` → a real 5-turn `loan_approval` consultation (income/debt/credit-score/loan-amount/collateral) → approve, redirecting correctly to `/dialex/debates/<id>` (not the old path) → a live debate run with genuine incremental streaming across 2 rounds to a verdict, the seeded Credit Risk Officer/Relationship Loan Advisor personas both citing the case's actual numbers against the seeded policy thresholds (credit score 600 vs. 620, DTI vs. 45%), Moderator verdict `deny · 0.95` → notifications via the bell to `/dialex/notifications` → logout/login/reload-session-restore/logout. Direct typed navigation to the old `/debates`, `/consultation`, `/notifications` paths all correctly 404, confirming the routes actually moved rather than gaining aliases alongside the old ones.

## Status

Implemented and verified against the real running stack, all three repos. Committed in each (`dialex-backend`, `dialex-orchestrator`, `dialex-frontend`) on `main`; not yet pushed to any of their remotes — pending the same explicit go-ahead as the earlier ADR 0013 sibling-repo commits. Closes ADR 0014's Sequencing step 1. Phase 1 (cofounder's actual Django models, LangGraph-to-Temporal-activity translation, frontend chat surface) is not yet specced.
