# Spec 0008 — Wire debate-thread to real orchestration data

> No new ADR — this applies already-decided patterns (DRF read endpoints per ADR 0002, HttpClient/signals per ADR 0001), not a new architecture decision. Governed by `docs/API.md`'s Django-owns-CRUD split and decision 9's DB-ownership rule (Django owns migrations/writes to its own tables; this milestone only adds Django-side *reads*, nothing orchestrator-side changes).

## What's being built

`debate-thread` renders a real `Debate`'s real `Argument`/`Verdict` rows via new Django read endpoints, instead of hard-coded mock data. A "start debate" button calls the orchestrator's existing `POST /api/debates/{id}/start` (spec 0005) for an `OPEN` debate. Still admin-seeded for test data — no case-submission UI exists yet (that's the separate consultant-stage follow-up).

## Resolved design gap: mapping a real `position` onto the divergence↔convergence axis

The mock data's `leaning` (0=divergent, 1=convergent — drives both x-position and node color) has no real equivalent: `Argument.position` is a plain string, `Argument.confidence` is certainty, not direction. **Confirmed with the user:** `CaseTypeConfig.position_options`' list order *is* the spectrum (index 0 = most divergent, last = most convergent); `leaning = index / (len - 1)`. For case types with no fixed options (`research_debate`), or a `position` that isn't in the configured list, fall back to clustering by distinct `position` value in first-seen order among the debate's own arguments (same formula, different list) — every case type gets *some* placement, never a crash or an arbitrary default beyond the last-resort `0.5` (single/no distinct value yet).

This changes `CaseTypeConfig.position_options`' meaning from "valid values, unordered" to "valid values, ordered as the divergence→convergence spectrum" — documented in the model's `help_text`, not a schema change.

Computed **server-side** (in `ArgumentSerializer`, not the frontend) since it needs `CaseTypeConfig` and the full arguments queryset either way — keeps this business logic in one place rather than duplicating it in TypeScript.

## Backend — new Django read endpoints, ownership-scoped

All new views filter their `get_queryset()` by the requesting user's ownership (`Case.created_by` / `case__created_by`) — never fetch-then-check-ownership-after, which is exactly the IDOR shape already caught once in spec 0005. DRF's generic views 404 naturally when `get_object()`'s lookup misses inside an already-scoped queryset.

- `apps/cases/serializers.py` — `CaseSerializer` (id, type, payload, status, created_at).
- `apps/cases/views.py` — `CaseListView`/`CaseDetailView` (`generics.ListAPIView`/`RetrieveAPIView`, `get_queryset` filtered to `created_by=request.user`).
- `apps/cases/urls.py` → `config/urls.py` under `/api/cases/`.
- `apps/debates/serializers.py`:
  - `AgentPersonaMiniSerializer` (id, name, role) — no `system_prompt`/`model_config` exposed, matching `docs/API.md`'s existing "no prompts to non-admin clients" note.
  - `ArgumentSerializer` (id, round_number, agent_persona nested mini, content, position, confidence, `responds_to` id, `cites_research_finding` id, `leaning` — the computed field above, created_at).
  - `VerdictSerializer` (id, decision, confidence, reasoning, `cited_arguments` ids, created_at).
  - `DebateSerializer` (id, case id, turn_strategy, status, current_round, max_rounds, opening_statement, closing_summary, judge_persona nested mini, verdict nested/nullable, created_at, judged_at).
- `apps/debates/views.py` — `DebateListView` (`get_queryset` filtered by `case__created_by=request.user`, optional `?case=<id>`), `DebateDetailView` (same filter), `DebateArgumentsView` (same filter via the debate, ordered by `round_number, id`, builds the `distinct_positions` fallback list once and passes both it and the case's `position_options` into serializer context).
- `apps/debates/urls.py` → `config/urls.py` under `/api/debates/`.

## Frontend

- `features/debate/data/debates-api.ts` — small data-access service (`getDebate(id)`, `getArguments(id)`), calling Django via the existing `HttpClient` + interceptor (auth already attached automatically).
- `debate-thread.ts`:
  - Reads `id` from a new route param (see routing below), fetches the debate + its arguments on init instead of `MOCK_ARGUMENTS`.
  - Maps the API response into the existing `DebateArgument` shape (kept stable to avoid touching the already-validated template/graph logic) — `respondsToLabel` still computed client-side (looks up the `responds_to` id within the already-fetched arguments array, same as before).
  - No streaming-reveal effect for real data — nothing is "in progress" without decision 12's live streaming, so `isStreaming` is always `false` and the reading panel's text just appears immediately rather than replaying the word-by-word demo animation that modeled live token arrival.
  - Loading state while fetching; a 404 (debate doesn't exist / isn't owned) shows a clear "not found" message rather than a blank graph.
  - **"Start debate" button** — shown when `debate.status === 'OPEN'`, calls the orchestrator's `POST /api/debates/{id}/start`. After starting, the page polls (refetches the debate) every few seconds while `status` is `ARGUING`/`CONVERGING`, stopping once it reaches `JUDGED`/`NO_CONSENSUS`/`FAILED`. Deliberately simple polling, not real push — a stand-in until decision 12's WebSocket streaming exists, and expected to be replaced (not layered under) once that lands.
- **Routing (a real, if small, product decision — flagging the reasoning rather than silently picking):** the route becomes `/debates/:id` (guarded, same `authGuard` as before). There's no "browse my debates" list screen yet (`docs/FLOWS.md`'s "Browse case/debate history" is a separate, still-❌ flow) — bare `/` shows a minimal empty state ("no debate selected — open one via a direct link for now") rather than either blocking this milestone on building a list screen too, or leaving `/` pointing at nothing meaningful. Test path stays the same as spec 0005's: seed a `Case`/`Debate`/participants via Django admin, then open `/debates/{that id}` directly.

## Explicitly out of scope

Redis/WebSocket live streaming (decision 12 — the polling above is a deliberately temporary stand-in), the consultant/case-submission stage (still no way for a user to create their own case), a "browse my debates" list screen, research-findings/convergence-checks/human-review endpoints from `docs/API.md` (not needed to render this view — separate future work if/when those screens get built).

## Verification plan

- Seed a `Case`/`Debate`/`AgentPersona`(x2+judge)/`DebateParticipant` set via Django admin/shell (same pattern as spec 0005), with an ordered `CaseTypeConfig.position_options`.
- `GET /api/debates/{id}/` and `/arguments/` as the owning user — confirm real data, correct `leaning` values matching the configured option order.
- Same calls as a *different* user — confirm 404, not the real data (ownership scoping working, no IDOR regression).
- Open `/debates/{id}` in a real browser (Canary) as the owning user — confirm the graph renders real arguments, node click/mode toggle still work (spec 0007's query params still apply), reading panel shows real content.
- Click "Start debate" on an `OPEN` seeded debate — confirm the orchestrator call fires, the page starts polling, and the UI reflects `ARGUING` → final status without a manual refresh, ending with a real `Verdict` rendered.
- Open `/debates/{bogus-id}` — confirm a clear not-found state, not a blank/broken graph.
- Open bare `/` — confirm the empty state, not a crash.

## Found during real-browser verification (Canary), fixed before landing

- **The orchestrator (FastAPI, port 8010) had no CORS configuration at all.** Django got `django-cors-headers` in spec 0006, but the frontend now calls the orchestrator directly too (the start-debate button) — a gap this spec didn't anticipate. Every such call failed at the browser's CORS preflight, never reaching the service. Fixed with `fastapi.middleware.cors.CORSMiddleware`, configured the same narrow-allow-list way as Django's (`cors_allowed_origins` setting, defaulting to `http://localhost:4200`).
- **A real polling bug**, found only by chaining short, gap-free snapshot checks against the live DOM (a single long wait wasn't enough to catch it): the polling-start condition was `isActive() && status !== 'OPEN'` — but `OPEN` is itself one of the active statuses. Right after `startDebate()`'s own follow-up refresh, if the backend hadn't transitioned off `OPEN` yet (a race with the workflow actually starting), polling never started at all, leaving the page frozen on "OPEN, 0 arguments" indefinitely even though the debate was running and finishing entirely server-side — confirmed by a 66-second zero-change trace while the backend had already reached `NO_CONSENSUS`. Fixed by dropping the `!== 'OPEN'` exclusion — the condition is just `isActive()` now. Re-verified with a gap-free trace: OPEN→ARGUING (3 nodes) at 6s, →NO_CONSENSUS (4 nodes, round 2 of 2, verdict rendered) at 12s, stable after — all on one page instance, zero manual reloads.

## Branch

Continuing on `main`.

## Status

Implemented and verified against a real browser (Canary), including two real bugs found and fixed along the way (orchestrator CORS, a polling race).
