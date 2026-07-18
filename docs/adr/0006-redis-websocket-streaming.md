# ADR 0006 — Redis pub/sub + WebSocket live debate streaming

> Written before any code, per this repo's CLAUDE.md. Triggers the ADR bar on two counts: a new dependency category (a Redis client, the first real use of the already-provisioned-but-idle Redis container) and a new cross-cutting pattern (the first WebSocket endpoint in the app). Implements decisions 12 and 13a from [references/002-design-review-findings.md](../../references/002-design-review-findings.md) — with one deliberate, evidence-based narrowing of decision 12's scope, explained below. Scope: **backend only** — Redis wiring, publish calls, the WebSocket endpoint. The frontend (removing polling, wiring a WS client) is a separate follow-up spec, same split as the last two milestones.

## Decision 1 — Complete-event push, not token-by-token argument streaming

Decision 12's text asks for arguments to "stream token-by-token as they're generated." Verified against the actual current code and the actual current model, not assumed:

- `DebateWorkflow`'s argument generation is one call to `ChatOpenAI(...).with_structured_output(ArgumentOutput).ainvoke(...)` — `ArgumentOutput` needs `content`, `position`, `confidence`, and `responds_to_argument_id` together, and `position`/`confidence`/`responds_to_argument_id` are judgments that can only be made from the *complete* argument text, not a partial prefix.
- Directly tested `.with_structured_output(ArgumentOutput).astream(...)` against the real `gpt-4o-mini` model, in this environment, with the pinned `langchain-openai` version: it yields **exactly one chunk** — the full, final object — not incremental partial content. (A live, currently-open LangChain GitHub issue, "Streaming blocked by Structured Output" — Jan 2026 — corroborates this isn't a one-off fluke.)
- Directly tested plain `.astream()` (no `with_structured_output`) against the same model: **63 real incremental chunks** for a two-sentence response — confirming streaming itself works fine; the limitation is specifically the combination with structured output.
- A workaround was considered and rejected: dropping `with_structured_output()` for the streaming call and hand-parsing a custom trailing text format for `position`/`confidence`/`responds_to_argument_id` out of the accumulated stream. Rejected because it trades a proven, atomic constraint for an unpredictable one — a bespoke parser's failure mode can't be bounded the way schema validation's can, and the *structured* fields still can't be shown until the full text is generated either way, so the parser buys no real behavioral improvement for the fields that actually needed it.

**Conclusion:** the atomic response is a real, irreducible constraint of needing structured judgments derived from a complete argument, not an artifact of implementation laziness. This milestone pushes the **complete** argument (and status/round transitions) live the instant each is ready, replacing the up-to-4-second polling delay with instant delivery — a real, substantial improvement — without attempting a word-by-word typing effect on an individual argument's text. True token streaming remains a possible future upgrade to the same Redis/WebSocket plumbing if a future model/library combination resolves the structured-output-streaming gap; nothing built here forecloses that.

**Consequence for the `retry` event (decision 12):** its stated purpose is clearing stale *partial* output before a retried Activity's next attempt lands. Since no partial output is ever published under complete-event push (an argument is published once, fully formed, or not at all), there is nothing for a `retry` event to clean up in this scope — it's deferred, not dropped; it becomes relevant again only if/when true token streaming is built.

## Decision 2 — Redis client and configuration

`redis==8.0.1` (current stable, verified via PyPI at implementation time, not assumed) — ships `redis.asyncio`, native asyncio support, no separate `aioredis` package needed (that project merged into `redis-py` some time ago). New orchestrator dependency, confirmed before adding per CLAUDE.md.

New required setting, `redis_url`, no default (fail-fast, matching `database_url`/`temporal_address`'s existing pattern) — `redis://redis:6379/0` inside compose (`orchestrator`/`orchestrator-worker` services, mirroring how `DATABASE_URL` is already overridden for compose-internal hostnames), `redis://localhost:6380/0` in `orchestrator/.env` for host-side tooling (matching the existing `REDIS_PORT=6380` remap, decision-9-adjacent — already documented in `CHANGELOG.md` as "Redis 6379→6380" since the default port was taken on the dev machine).

No numbered-database separation beyond `/0` (decision 12 already settled this — channel naming, not DB index, is what separates traffic; `SELECT` doesn't exist in Redis Cluster mode, so building on DB-index isolation would need redoing later regardless).

## Decision 3 — Where publishes happen (existing Activity boundaries, no new ones)

No change to `DebateWorkflow`'s control flow or `graphs.py`'s LLM call shape — publishing is added at the *existing* Activity boundaries, immediately after each already-happens DB write:

- `persist_argument` → publish `argument_complete: {argument_id}` (exact shape already documented in `docs/API.md` — the frontend fetches the full row via the existing `GET /api/debates/{id}/arguments/`, this event is just "go fetch, something new landed," not a payload carrier).
- `set_debate_status` / `close_debate` (called from `persist_verdict_and_close`) / `mark_failed` → publish `status_change: {status}`.
- No dedicated round-progress event — a round's `argument_complete` events already imply the round via each argument's own `round_number`, fetched from the existing REST endpoint; adding a second event type for the same information would be redundant.
- No publish from `check_convergence` (internal computation, not something the frontend needs a live view of) or `persist_opening_statement` (a known, accepted minor gap: the opening statement lands in Postgres slightly before the first `argument_complete` event of the round, so there's a brief window where it exists but nothing has told the frontend to re-fetch yet — closes itself within moments once the first argument completes; not worth a new event type for this scope).

## Decision 4 — WebSocket endpoint and decision 13a's auth handshake

`WS /api/debates/{debate_id}/stream`. Verified against Starlette's actual API (not assumed): a WebSocket connection's requested subprotocols arrive as `websocket.scope["subprotocols"]` (a list), and `await websocket.accept(subprotocol=...)` echoes back the chosen one to complete the handshake. Browsers can't set custom headers on a WebSocket handshake, so the access token rides as the (sole) requested subprotocol (`new WebSocket(url, [accessToken])` client-side) rather than a query parameter — avoids the token landing in plaintext access logs (decision 13a's own stated reason).

Handshake sequence: read the offered subprotocol, decode/verify it as a JWT (same `AuthContext`-producing logic already used for REST, refactored into a callable both paths share — not duplicated), reject (`close` with an appropriate code) if invalid; then, same IDOR-avoidance shape already used on `POST /debates/{id}/start` (spec 0005) and the consultation endpoints (spec 0009): fetch the debate + owning case, close the connection (not just reject — nothing to fall back to on a WebSocket) if the authenticated user isn't the owner. Only after both checks pass: `accept()`, subscribe to `debate:{debate_id}:stream`, relay every message received to the client as JSON until the debate reaches a terminal status or the client disconnects.

**Multiple simultaneous viewers**: each WebSocket connection subscribes independently — Redis fans out to every subscriber on a channel natively, no connection-manager/broadcast code needed on the FastAPI side.

**No history/replay**: Redis pub/sub delivers only to currently-subscribed clients — a viewer connecting mid-debate sees nothing from before they connected. This is by design (decision 12 never promised replay) and already solved: the existing `GET /api/debates/{id}/` + `/arguments/` endpoints (spec 0008) are the catch-up mechanism — fetch current state once via REST, then open the stream for what happens next. No new work needed here, just confirming the existing pieces already cover it.

## What this doesn't cover

The frontend (separate follow-up spec — removing `pollHandle`/`setInterval`, opening the WebSocket, wiring the already-present-but-dormant `isStreaming` field... though per Decision 1, that field's naming is now slightly misleading — it will represent "not yet confirmed complete," not "actively streaming tokens"; the follow-up spec should address this directly, not silently). The notification system (decision 17's `app_notifications` channel/`WS /notifications/stream`) — same Redis instance, genuinely separate feature, not built here. The preparation/research round's event types (`research_sources_found` etc.) — no research round exists yet (decisions 5b/11, still deferred), so these stay reserved/unbuilt. The `retry` event (Decision 1's consequence, above). Consultation chat streaming (ADR 0005 already decided SSE, not this Redis+WebSocket mechanism, is the candidate there if it's ever built).
