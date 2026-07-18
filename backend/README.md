# Dialex backend

Django backend — see [docs/adr/0002-backend-architecture.md](../docs/adr/0002-backend-architecture.md) and [docs/specs/0002-backend-scaffold-and-infra.md](../docs/specs/0002-backend-scaffold-and-infra.md).

## Running everything via docker-compose (recommended)

From the repo root:

```
cp .env.example .env              # fill in real values
cp backend/.env.example backend/.env   # fill in real values
docker compose up -d
docker compose exec django python manage.py migrate
docker compose exec django python manage.py createsuperuser
```

- Django admin: http://localhost:8000/admin/
- Temporal Web UI: http://localhost:8088/
- Redis: `localhost:6380`
- App Postgres: `localhost:5433`

Ports are intentionally *not* the defaults (5432/6379/8080) — this dev machine already had other services on those ports, so `db`→5433, `redis`→6380, `temporal-ui`→8088. Change the mappings in `docker-compose.yml` if that's not the case for you.

## Running Django directly (without docker-compose)

```
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in real values; DATABASE_URL must point at a real Postgres
cd src
python manage.py migrate
python manage.py runserver
```

## Apps

One app per bounded concern from the locked data model — see ADR 0002 for the full reasoning:

- `accounts` — custom `User` model
- `cases` — `Case`, `CaseTypeConfig`
- `debates` — `AgentPersona`, `Debate`, `DebateParticipant`, `Argument`, `ConvergenceCheck`, `Verdict`, `ResearchFinding`
- `consultations` — `ConsultationSession`, `ConsultationTurn`
- `reviews` — `HumanReview`
- `notifications` — `Notification`

No API views/serializers yet — this milestone is the data model + admin only.
