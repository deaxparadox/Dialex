# Spec 0044 — Cofounder Phase 1a: chat mechanism only, no graph/tools yet

Implements ADR 0014's Phase 1, first slice. Proves the Django-owns-data / Temporal-owns-execution mechanism works end to end for the cofounder agent, with the smallest possible agent behavior behind it (a single plain LLM call, no LangGraph graph, no tools). The actual `entrepreneur_graph` (router → ideation/roadmap/image-generation, all 5 tools) is Phase 1b+, its own spec(s), once this mechanism is proven.

## Decisions made reaching this spec (recorded here since no ADR update is needed — this is execution detail, not new architecture)

- **No Celery, no bare Activity called directly from HTTP** — rejected. A Temporal client can only start a *Workflow*; Activities are always workflow-scheduled. The correct shape is a thin, long-running Workflow (already proven in this codebase as `ConsultationWorkflow`) that accepts `@workflow.update` calls for each new message and delegates real work to Activities.
- **Synchronous reply, no WebSocket in this phase** — verified directly against the original source (`ai-bot-handover`, `dev/backend`, `src/ai/views/agent.py`): the original's chat reply already returns synchronously in the HTTP response (`{"message": response}`); its WebSocket is a *separate*, secondary status/progress tracker (`{"agent": ..., "action": ...}`), never the content-delivery path. So `ConsultationWorkflow.submit_message`'s pattern (Update call returns the reply directly) is the right template, not `DebateWorkflow`'s (WS is the only way to get content). WS/status streaming is deferred to Phase 1b, once there's a real multi-step graph worth reporting progress on — the user's own call, since a single LLM call has no sub-steps to report yet.
- **No new dependencies, no product-scope decisions in this phase** — the two Bubble.io-only tools (`get_bubble_entreprenurs`/`get_bubble_freelancers_v2`, verified to query `settings.BUBBLE_BASE_URL` directly — no equivalent data source exists in Dialex) and the three real tools (DuckDuckGo, Google Places, Pinecone RAG) are all out of scope here — this phase doesn't touch the graph or any tool at all.
- **No shared `AgentPersona` reuse** — Dialex's `debates.AgentPersona.Role` choices (`participant`/`consultant`/`judge`) don't fit a standalone chat product, and coupling cofounder to a Dialex-owned model's enum would undercut the whole point of product isolation (ADR 0014 Decision 1). Phase 1a uses a single hardcoded placeholder system prompt in code, not a DB-configurable persona — explicitly a simplification, revisit only if cofounder ever needs persona-switching.

## Current state, verified directly (not assumed)

- Original chat persistence (`ai-bot-handover`, `dev/backend`): `AgentChatIDModel` (`bubble_user` FK, `chat_id`, `chat_name`, `deleted`) holds only chat *metadata* — the actual message history lives entirely in LangGraph's own `AsyncPostgresSaver` checkpointer, fetched via `Saver.saver.aget(config={"configurable": {"thread_id": chat_id}})` (`ai/views/chat_session.py`). Since ADR 0014 already decided against carrying that checkpointer forward, Django must own real message content now — there's no equivalent to fall back on.
- `dialex-backend`'s `apps/dialex/consultations/models.py` (`ConsultationSession`/`ConsultationTurn`) is the closest existing analog: a session row plus an ordered turn/speaker/content log, written via SQLAlchemy from the orchestrator, never through a Django REST endpoint (`consultations` has no `urls.py` at all — confirmed). `ConsultationWorkflow` (`dialex-orchestrator`, `app/dialex/consultations/workflows.py`) is the exact template: `@workflow.run` parks on `workflow.wait_condition` for the session's lifetime, `@workflow.update async def submit_message` persists the user's turn (Activity), fetches context/history (Activities), runs the actual work, persists the reply (Activity), and returns the reply directly as the Update's return value — no Redis/WS involved in the content path.

## Fix

### `dialex-backend`

New app `apps/cofounder/chat/` (mirrors `apps/dialex/consultations/` exactly): `apps.py` (`name = "apps.cofounder.chat"`, `label = "cofounder_chat"` — explicit, since `chat` alone would be an ambiguous label if another product ever also has a `chat` app), `models.py`:
```python
class CofounderSession(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="cofounder_sessions")
    title = models.CharField(default="New chat", max_length=60)
    created_at = models.DateTimeField(auto_now_add=True)

class CofounderTurn(models.Model):
    class Speaker(models.TextChoices):
        USER = "user", "User"
        AGENT = "agent", "Agent"
    session = models.ForeignKey(CofounderSession, on_delete=models.CASCADE, related_name="turns")
    turn_number = models.PositiveIntegerField()
    speaker = models.CharField(max_length=20, choices=Speaker.choices)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        unique_together = ("session", "turn_number")
        ordering = ["turn_number"]
```
`admin.py` registers both (visibility/debugging, matching every other app). No `urls.py`/`views.py`/`serializers.py` — same minimal footprint as `consultations`, since the orchestrator is the sole client-facing API. `INSTALLED_APPS` gains `"apps.cofounder.chat"`. Migration via `makemigrations`/`migrate` as normal. `app/core/generated_tables.py` regenerated per its own header command afterward.

### `dialex-orchestrator`

New module `app/cofounder/chat/` (mirrors `app/dialex/consultations/`):
- `queries.py`: `insert_session(user_id) -> int`, `get_turns(session_id) -> list[dict]`, `insert_turn(session_id, turn_number, speaker, content) -> int` — same SQLAlchemy-against-`generated_tables` shape as `consultations/queries.py`'s equivalents, against the two new tables.
- `activities.py`: `persist_turn` (wraps `insert_turn`), `fetch_turns` (wraps `get_turns`), `generate_reply(session_id, turns, text) -> str` — builds a message list from `turns` plus the new `text`, calls a plain `ChatOpenAI`/`AsyncOpenAI` completion with a hardcoded placeholder system prompt (e.g. "You are Brunda, an AI co-founder assistant. (Placeholder behavior for Phase 1a — the real multi-agent graph replaces this in Phase 1b.)"), returns the reply text. No LangGraph involved at all in this phase.
- `workflows.py`: `CofounderWorkflow` — `@workflow.run` accepts the already-created `session_id` (same order `start_consultation` uses: Django row inserted first, then `start_workflow`) and parks via `workflow.wait_condition(lambda: False)` for the session's lifetime; `@workflow.update async def submit_message(session_id, text) -> dict` persists the user turn, fetches turn history, calls `generate_reply`, persists the agent turn, returns `{"reply": ...}`. **Known, deliberate limitation**: no terminal state in this phase — every session's workflow runs forever, accumulating indefinitely as an open Temporal workflow (fine for dev-scale proving-the-mechanism purposes, not something to carry into a real multi-user deployment unexamined). Ending a chat session is out of scope here; revisit once there's a real reason to close one.
- `router.py`: `POST /api/cofounder/sessions/` → `queries.insert_session(auth.user_id)`, `client.start_workflow(CofounderWorkflow.run, session_id, id=f"cofounder-{session_id}", task_queue=TASK_QUEUE)`, returns `{"session_id": ...}`. `POST /api/cofounder/sessions/{id}/messages` → ownership check (`get_session` must confirm `user_id` matches, same 404-not-403 IDOR shape used everywhere else in this codebase) then `handle.execute_update(CofounderWorkflow.submit_message, args=[session_id, text])`, returns `{"reply": ...}`.
- `main.py`: include the new router. `worker.py`: register `CofounderWorkflow` and its activities on the same existing worker process/task queue (`dialex-debates`) — no new worker deployment, matching this codebase's existing one-worker-handles-everything convention.

### `dialex-frontend`

New route `(protected)/cofounder/page.tsx` — a minimal chat UI (message list + input box), calling the two new endpoints directly (no streaming UI needed yet, matching the synchronous-reply decision above). Deliberately basic styling — this phase is about proving the mechanism, not the product's real chat experience. Nav gets a new "Cofounder" link alongside "Debates"/"New case", matching `(protected)/layout.tsx`'s existing pattern.

## Explicitly out of scope

The actual `entrepreneur_graph`/`entrepreneur_structured_graph` port, all 5 tools (including the 2 Bubble.io-only ones, kept as a known gap per the user's explicit call — not built as placeholders in code yet, just not started), WebSocket/status streaming, token usage tracking (`TokenUsage`'s original role), any persona/system-prompt admin-configurability, multi-session UI (session list/switching — Phase 1a is one session at a time, created fresh each visit).

## Verification plan

Django: `makemigrations`, `migrate` clean against the real DB; regenerated `generated_tables.py` diffed by eye (only the two new tables, no unrelated drift). Orchestrator: a real `POST /api/cofounder/sessions/` followed by 2-3 real `POST .../messages` calls, confirming each reply is a genuine LLM response (not an echo/stub) and that `CofounderTurn` rows persist correctly in order via a direct DB check. Real browser: register/login, navigate to the new Cofounder nav link, send a few messages, confirm real replies render, reload the page (session is lost — expected, no session-resume in this phase, confirm that's what actually happens rather than an error) — zero console errors, zero 4xx/5xx.

## Branch

Continuing on `main` in all three repos, matching every prior phase.

## Found during implementation

Django app scaffolded via `manage.py startapp chat apps/cofounder/chat` (per CLAUDE.md's use-the-generator rule) rather than hand-writing the skeleton — `startapp` requires the destination directory to already exist and sets `name` to the bare directory name, both corrected afterward (`mkdir` first, `name`/`label` fixed in `apps.py`).

A real message-duplication bug caught before it ever ran, not during testing: `submit_message` calls `persist_cofounder_turn` (the user's message) *before* `fetch_cofounder_turns`, so the fetched turn list already ends with the current message — exactly matching `ConsultationWorkflow`'s own order. An initial draft of `generate_cofounder_reply` built the message list from `turns` and then appended `text` again at the end, which would have sent every user message to the LLM twice. Fixed by dropping the `text` parameter from the activity entirely — the last item in `turns` already *is* the current message.

A real worker-startup crash on first run: `ValueError: More than one activity named persist_turn`. Temporal's `@activity.defn` defaults the registered name to the plain function name (verified against the SDK docs during spec 0043), and `persist_turn`/`fetch_turns` already existed in `dialex/consultations/activities.py`, registered on the same worker process and task queue (`dialex-debates`). Fixed by renaming the new activities `persist_cofounder_turn`/`fetch_cofounder_turns`/`generate_cofounder_reply`. Also hit stale bind-mounted `__pycache__` (owned by the container's root user, same issue as spec 0042/0043) masking the fix on first restart — cleared via a one-off `alpine` container the same way as before.

`core/observability.py` gained `bind_cofounder_context` + a `_cofounder_session_id_var` ContextVar/log field, matching `bind_debate_context`/`bind_consultation_context` exactly — a genuine, minimal extension of shared `core/` infra per-product, not a violation of its product-agnostic role (ADR 0014).

## Found during verification

No bugs beyond the two above (both caught and fixed before/at the real-browser pass, not during it). Verified via real API calls (not curl-only-then-assume): registered two real users, started a real session, sent two real messages confirming genuine LLM replies and correct conversation recall across turns (cross-checked against the actual `cofounder_chat_cofounderturn` rows — exactly 4 rows, correctly ordered, no duplication), and confirmed the ownership check via a real cross-user 404 attempt (not a code read — an actual second user hitting the first user's session). `generated_tables.py`'s regenerated diff showed exactly the two new tables, nothing else. A full real-browser pass (Canary) confirmed the same behavior through the actual UI: nav link present, real coherent replies, correct two-turn recall, a reload correctly starting a fresh session (expected, no resume in this phase) rather than erroring, and zero regression to Home/Debates/New case — 170 requests captured, only 4 non-2xx (`401`s on `/api/auth/refresh/` during the pre-login anonymous probe, a pre-existing pattern investigated and closed during spec 0043, unrelated to this feature).

## Status

Implemented and verified against the real running stack, all three repos. Committed in each (`dialex-backend`, `dialex-orchestrator`, `dialex-frontend`) on `main`; not yet pushed to any of their remotes — pending the same explicit go-ahead as the earlier ADR 0013/0014 sibling-repo commits. Phase 1b (the real `entrepreneur_graph`/tools) is not yet specced.
