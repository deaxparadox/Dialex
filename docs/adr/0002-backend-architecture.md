# ADR 0002 — Backend architecture & scaffolding conventions

> Written before scaffolding any backend code, per this repo's CLAUDE.md: version pin, project layout, DB driver, and config-management approach are cross-cutting decisions every future backend spec builds on, not re-decided per feature.

## Django version — 5.2 LTS, not the newest 6.0

Verified rather than assumed (`pypi.org/project/Django`): Django 6.0.7 is the latest release as of mid-2026, but `djangorestframework-simplejwt` (already locked in for auth, `references/002` decision 13) doesn't yet list Django 6.0 in its compatibility range, and 6.0's general support window ends around August 2026 — a few months out. Django 5.2 LTS carries support through April 2028. Scaffold against 5.2 LTS.

## Custom user model, from the first migration

Django cannot safely introduce a custom user model after the first migration has run against real data — this is one of the few genuinely one-way doors in the framework. A thin subclass of `AbstractUser` (`accounts.User`) is created now, before any migration exists, even with no extra fields needed yet. Cost today: near zero. Cost of skipping this and needing it later: a full data migration on a live user table.

## Project layout — `src/`-style, not the classic flat default

`django-admin startproject` still generates the classic flat layout (a settings package literally named after the project) by default, but that convention has fallen out of favor for anything beyond a toy project — it conflates "the project" with "the settings module" and gives no natural home for environment-specific settings splits.

```
backend/
  src/
    config/              — the Django "project" package: settings, root urls.py, asgi/wsgi
      settings/
        base.py
        development.py
        production.py
      urls.py
    apps/
      accounts/           — custom User model
      cases/              — Case, CaseTypeConfig
      debates/             — Debate, DebateParticipant, AgentPersona, Argument,
                              ConvergenceCheck, Verdict, ResearchFinding
      consultations/       — ConsultationSession, ConsultationTurn
      reviews/             — HumanReview
      notifications/       — Notification
  manage.py
```

Settings split into `base`/`development`/`production` so environment-specific config is explicit, not `if DEBUG` branches scattered through one file.

## Database driver — `psycopg` (psycopg3), not `psycopg2`

Django has supported psycopg3 since 4.2, and it brings native async support plus connection pooling (available since Django 5.1) — psycopg2 still receives maintenance patches but isn't where new projects should start, especially one already committed to Django's async ORM (`references/002` decision 1).

## Config management — `django-environ`

Chosen specifically because it enforces this repo's own no-silent-fallback rule at the framework level: accessing a required env var with no default raises Django's `ImproperlyConfigured` immediately, rather than the app booting with a buried default and failing mysteriously later. Also Django-aware — parses `DATABASE_URL`/`REDIS_URL` directly into the dict shapes Django/redis-py expect, rather than hand-parsing connection strings.

## App breakdown, mapping the locked data model to Django apps

One app per bounded concern from `references/002-design-review-findings.md`'s entity list — `accounts`, `cases`, `debates`, `consultations`, `reviews`, `notifications` (see layout above). `debates` is the largest app since `Argument`, `ConvergenceCheck`, `Verdict`, `ResearchFinding`, `AgentPersona`, and `DebateParticipant` are all tightly coupled around one `Debate` lifecycle — splitting them further would just add cross-app FK noise for no real separation of concern.

## Confirmed compatible, verified not assumed

- DRF 3.17.1 — supports Django 4.2, 5.0, 5.1, 5.2, 6.0.
- `djangorestframework-simplejwt` 5.5.1 — supports Django 4.2–5.2 (motivates the 5.2 pin above).
- `sqlacodegen` 4.0.4 — supports SQLAlchemy 2.x, relevant later for FastAPI's side of the DB-access pattern (`references/002` decision 9); not part of this milestone's scope, confirmed compatible ahead of time so that decision doesn't need revisiting when FastAPI gets built.

## What this doesn't cover

FastAPI's own project scaffold (no code exists yet — gets its own ADR/spec when that work starts), the actual auth views/serializers (separate future spec), and CI/deployment pipelines (out of scope for now).
