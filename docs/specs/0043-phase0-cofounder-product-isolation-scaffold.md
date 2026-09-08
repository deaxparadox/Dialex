# Spec 0043 — Phase 0: product-isolation scaffold (backend + orchestrator only)

Implements ADR 0014's Decision 1 and Sequencing step 1. Moves Dialex's *existing* code into nested per-product packages so `apps.cofounder.*`/`app.cofounder.*` have a real place to live alongside it. Zero functional change — no new cofounder code in this spec. Frontend is out of scope for this phase (see rationale below).

## Root cause / current state, verified directly (not assumed)

**`dialex-backend`** — `apps/{accounts,cases,debates,consultations,reviews,notifications}` sit flat, each `AppConfig.name` set to `apps.<name>` (e.g. `apps/debates/apps.py:6`), registered the same way in `INSTALLED_APPS` (`src/config/settings/base.py:44-49`). Five cross-app imports, all absolute (`grep`-confirmed, nothing missed): `debates/serializers.py`→`reviews.serializers`, `debates/urls.py`→`reviews.views`, `debates/views.py`→`cases.models`, `reviews/views.py`→`debates.models`, `config/urls.py`→`cases.views`. Exactly one string-based cross-app FK (`debates/models.py:41`, `ForeignKey("cases.Case", ...)`) plus `AUTH_USER_MODEL = "accounts.User"` (`config/settings/base.py:32`) — both reference the app **label**, confirmed against the official Django 5.2 docs to be independent of the app's Python import path (`AppConfig.name` vs `AppConfig.label`; Django's own reusable-app pattern pins `label` explicitly while `name` differs). No app currently sets `label` explicitly — it's auto-derived from the last dotted segment of `name` (`apps.debates` → `debates`).

**`dialex-orchestrator`** — `app/{consultations,debates}` sit flat next to `app/core/` (genuinely shared: config, db, observability, redis_client, security, temporal_client — confirmed no product-specific code inside it). All 8 cross-module imports go the same direction, `debates`/`consultations` importing from `core` via relative imports (`from ..core.X`) — never from each other. `main.py` includes both routers via `.consultations.router`/`.debates.router`. `DebateWorkflow`/`ConsultationWorkflow` are both plain `@workflow.defn` with no explicit `name=` — verified against the official Temporal Python SDK docs that this defaults to "the unqualified class name," not the module's dotted path, so moving the module is safe for anything already persisted in Temporal (workflow type identity is unaffected).

**`dialex-frontend`** — out of scope for this phase. Dialex's existing routes (`/consultation`, `/debates`, `/notifications`) are live, user-facing URLs (bookmarks, deep links) — unlike the backend/orchestrator moves, which are pure internal package paths invisible to anyone outside the codebase. Renaming them for structural symmetry alone has real cost (breaks any existing bookmark/link) and zero functional benefit right now. Decision: leave Dialex's existing frontend routes untouched; cofounder's new routes get their own segment (e.g. `(protected)/cofounder/*`) when that phase starts. Revisit only if a concrete reason to nest Dialex's own routes comes up later.

## Fix

### `dialex-backend`

1. `git mv apps/{accounts,cases,debates,consultations,reviews,notifications} apps/dialex/` (six directories under a new `apps/dialex/` package, plus `apps/dialex/__init__.py`).
2. Each moved app's `apps.py`: update `name = "apps.dialex.<app>"` and **explicitly add `label = "<app>"`** (pinning the unchanged, currently-implicit value) — e.g. `debates/apps.py` becomes `name = "apps.dialex.debates"`, `label = "debates"`.
3. `INSTALLED_APPS` (`config/settings/base.py`): `"apps.accounts"` → `"apps.dialex.accounts"`, same for the other five.
4. Update the five cross-app absolute imports found above to the new dotted path (e.g. `from apps.reviews.serializers import ...` → `from apps.dialex.reviews.serializers import ...`) plus `config/urls.py`'s `cases.views` import.
5. No migration files change. No `ForeignKey("cases.Case", ...)`-style string or `AUTH_USER_MODEL` change — both already reference the label, confirmed unaffected.
6. `apps/__init__.py` (the now-empty former package root) stays as-is; only `apps/dialex/__init__.py` is new.

### `dialex-orchestrator`

1. `git mv app/{consultations,debates} app/dialex/` (plus `app/dialex/__init__.py`). `app/core/` does not move.
2. Update the 8 relative imports inside the moved modules from `..core.X` to `...core.X` (one extra directory level).
3. `main.py`: `.consultations.router`/`.debates.router` → `.dialex.consultations.router`/`.dialex.debates.router`.
4. `worker.py` (imports `DebateWorkflow`/`ConsultationWorkflow`, activities, graphs from the moved modules): update its imports to the new `.dialex.*` paths. No change to `@workflow.defn`/`@activity.defn` usage — names stay implicit, already confirmed class-name-derived.

### `dialex-frontend`

No change (see rationale above).

## Explicitly out of scope

Any cofounder-specific code (`apps/cofounder/*`, `app/cofounder/*`, any new frontend route) — that starts in Phase 1, its own spec, only after this phase's verification passes. Any frontend restructuring. The new external dependencies the cofounder port will eventually need (Pinecone, Google Places, DALL-E, DuckDuckGo).

## Verification plan

**Before touching anything**: snapshot `django_migrations` (`app` column) and `django_content_type` (`app_label` column) for the six moving apps via a direct query against the running `db` service — confirms the exact rows that must stay byte-identical after the move.

**After the move**: re-run the same two queries, confirm zero diff (same `app`/`app_label` values, same row count) — proves the label-pinning actually worked, not just that the app imports without crashing. `python manage.py check` and `python manage.py makemigrations --check --dry-run` (must report no new migrations — if it does, a label or `name` mismatch broke something). `python manage.py migrate` (must report "No migrations to apply," matching spec 0042's own verification pattern for "did this actually reach the real, existing schema"). Bring up `dialex-orchestrator`'s worker, confirm (via `tctl taskqueue describe`, same check used in spec 0042) it still registers a poller identity on `dialex-debates` — proves `DebateWorkflow`'s type identity survived the module move.

Then the full real-browser regression journey (same one used in spec 0042 and every prior cutover): register → login → Home dashboard → My debates → a real consultation → a live debate run with real WS streaming → verdict → notifications → logout → login → reload-session-restore → logout. A fully clean pass is required before Phase 1 (any cofounder-specific code) starts.

## Branch

Continuing on `main` in all three repos — matches the precedent set by ADR 0013's own execution (the repo split and its compose work all landed directly on `main`, no feature branch). Flagging this explicitly for confirmation rather than assuming it silently carries forward, since CLAUDE.md's branch rule is human-directed by default.
