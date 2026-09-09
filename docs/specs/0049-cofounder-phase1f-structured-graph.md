# Spec 0049 — Cofounder Phase 1f: structured 7-step graph

Implements ADR 0014's Phase 1, sixth slice — ports `entrepreneur_structured_graph`, the client-driven 7-step conversational flow that runs alongside (not through) the free-form router graph already ported in Phases 1a-1e. This phase covers the graph, its 7 step prompts, and the persistence needed to make step-aware conversations real and resumable. It deliberately excludes the 31-file downloadable template/workbook system (`services/template.yaml` + `media/templates/step-{1-7}/*` + its download endpoint) — Phase 1g, its own spec — even though every step's live prompt injects that data in the original; each step's prompt is ported with that injection dropped for now, same deferral pattern Phase 1e already used for the roadmap prompt.

## Why this is its own phase, and why it wasn't caught earlier

`entrepreneur_structured_graph` was never scoped in any prior phase — Phases 1a-1e ported `entrepreneur_graph` (the LLM-routed free-form graph) exclusively, and the structured graph's existence was only surfaced when the user directly asked about it after Phase 1e ("you haven't told me about is where is the seven step graph, that was the main graph in cofunder"). Investigating it in full (all 7 step prompt files, the graph builder, the runner, the checkpointer) showed it's coupled to the same 31-file template system Phase 1e already deferred — the conversational half and the static-file half are the same product, not separable — so it needed folding into that deferred scope rather than staying unscoped. Splitting the combined "structured graph + templates" scope further, into this phase (graph mechanism only) and Phase 1g (templates), was the user's explicit call after this phase's design was first presented as one unit — porting both together risks losing a lot of time isolating what broke if something doesn't work, and each phase should stand as a real, browser-verifiable slice on its own (a `step` column with no consumer yet was considered and rejected for the same reason — it isn't independently verifiable).

## Current state, verified directly against the original source

- `ai/graphs/enterpreneur_structured_graph.py`: a separate `StateGraph(StateStructured)`, compiled with `checkpointer=Saver.saver` — the same `AsyncPostgresSaver` singleton `entrepreneur_graph` also uses. `START` → `user_query_node` → `entrepreneur_conditional_node` (returns `state['step']` directly, no LLM routing) → one of `entrepreneur_step_1` through `_7` → `END`.
- Every step function is structurally identical: build that step's prompt (the latest versioned function only — `_v6`/`_v4`/`_v2`/`_v2`/`_v3`/`_v3`/`_v2` for steps 1-7 respectively, verified via the graph's own imports; earlier versions in each file are dead), call `get_query()` to build the message list, then `ideation_llm_chat.ainvoke({"messages": query}, config={"configurable": {"thread_id": chat_id}})` — the exact same `create_react_agent` instance already ported (bound to all 5 tools: 2 Bubble.io placeholders, market research, Google Places, Pinecone RAG). That `thread_id` config is inert — `ideation_llm_chat` is built with no checkpointer at all, so all continuity comes from the outer graph explicitly building the message list.
- `create_step_message()` tags every message with `metadata={"step": ...}`. `get_query()`'s actual rule: if the previous message's step differs from the current step (or this is the first message ever), send `[system_prompt, user_query]` only — fresh context, no history. Otherwise (continuing the same step), send `[system_prompt, *the entire accumulated messages list, user_query]` — every message from every step ever visited in that thread, not filtered to the current step.
- Persistence is `Saver.saver` alone, keyed by a client-supplied `chat_id` string used as `thread_id` on both this graph and the free-form one — verified there's no code-level separation between the two graphs' checkpoint state (`checkpoint_ns` is never set by either), so a shared `chat_id` would merge their identically-named `messages` channels. This port doesn't have that risk: `session_id` is a server-generated integer, and (per the design below) structured/free-form turns are kept behaviorally separate within the same session on purpose, not by accident of a shared key.
- Each of the 7 live prompts (`cofounder_roadmap_step_N_prompt_v*`) is a large, hand-scripted stage-machine (exact button-text scripts, one/two-questions-at-a-time conversational rules, off-topic redirects, worked example conversations) — hundreds of lines each — and every one starts by calling `load_template_workbook()` and embedding `template_workbook_data_dict['step-N']` as YAML, plus a `backend_template_download_url` for `TemplateWorkbookView`. Both dropped this phase (Phase 1g).
- Two REST endpoints in the original (`ai/views/agent.py`, `ai/views/structured_agent.py`) both just read `chat-id` from a query param — no session concept beyond that string; the structured one additionally requires `step` in the request body.

## Design

### Persistence: extend the existing turns table, don't add a second checkpointer

Phases 1a-1e already replaced LangGraph's own checkpointing with Temporal + a plain `CofounderTurn` Postgres table (`session_id`/`turn_number`/`speaker`/`content`), fetched in full on every turn (`fetch_cofounder_turns`) and handed to a freshly-compiled, checkpointer-less graph. Reintroducing `AsyncPostgresSaver` for just this graph would fork the persistence architecture in two directions for no benefit, and would recreate the original's own cross-thread collision risk. Instead: `CofounderTurn` gains a nullable `step` column (`PositiveSmallIntegerField(null=True, blank=True)`, `1`-`7`; `null` marks a free-form turn). Structured and free-form turns live in the same session/table, distinguished by this column.

### Replicating `get_query()`'s behavior without message metadata

The "first message in step" vs "continuing" decision is computed from turn history instead of message metadata: look at the most recent turn in the session **with a non-null `step`** (i.e. skip free-form turns entirely — they're a separate conversation happening in the same session, not part of the structured journey). If there is no such turn, or its `step` differs from the current request's `step`, send `[system_prompt, user_query]` — fresh context. Otherwise send `[system_prompt, *every structured turn in the session so far (all steps, in order), user_query]` — matching the original's "continuing a step pulls in the whole structured thread's history" behavior, scoped to structured turns only (structured and free-form intentionally don't bleed into each other's context here — the original's own bleed was a side effect of a shared client-supplied key, not a deliberate feature, and this port's `session_id` model doesn't reproduce that side effect for free).

### Graph and agent construction

New `app/cofounder/chat/structured_graph.py`: `StructuredGraphState` (`session_id: int`, `turns: list[dict]`, `step: int`, `reply: str | None`), one node per step (`_step_1` .. `_step_7`), `_route_to_step` conditional edge reading `state["step"]` directly (no LLM call — matches the original). `_ideation_agent`'s inline `create_react_agent(...)` construction in `graphs.py` is factored into a shared `_build_ideation_agent()` helper (`chat/agents.py` or similar) used by both the free-form ideation node and all 7 step nodes — avoids repeating the same 5-tool list 8 times now that there are 8 callers.

### New Temporal Update + REST endpoint

`CofounderWorkflow` gains a second Update method, `submit_structured_message(session_id, text, step)`, mirroring `submit_message`'s persist-then-fetch-then-invoke-then-persist shape but running `structured_graph` and passing/persisting `step`. New router endpoint `POST /api/cofounder/sessions/{session_id}/structured-messages` (body: `{text, step}`), same ownership-check-before-Temporal shape as the existing endpoint. Reuses the same session/workflow instance as free-form chat — no new session type, no new workflow class.

### Step prompts

All 7 prompt strings ported verbatim from their live versions, minus the `load_template_workbook()` call, the embedded YAML block, and the template-download links/section (kept as plain text otherwise — the stage machine, button scripts, and conversational rules are the actual product behavior and are ported faithfully).

### Frontend

Minimal, matching every prior phase's "smallest UI that proves the mechanism" approach: a step selector (1-7) next to the existing chat input, sending to the new endpoint when a step is selected. No rich stage/button UI yet (the original's `[✅]`/`[❌]` button affordances are typed as plain text for now, consistent with how this port has rendered chat replies as plain text throughout).

## Explicitly out of scope

The 31-file template/workbook system, `template.yaml`, `TemplateWorkbookView`'s download endpoint, and injecting real template data back into these 7 prompts — Phase 1g. Any rich UI for the stage-machine's button affordances.

## Verification plan

Direct DB check: sending a structured message persists a turn with the correct `step`; a free-form message in the same session persists with `step = NULL`; both coexist without interfering with each other's history. Real conversation flow: step 1's Stage A opening message appears verbatim on first contact; a step switch (1 → 2 → back to 1) resets context on the switch and resumes with full step-1 history on return, per the design above. Regression: free-form ideation/roadmap/image-generation paths unaffected. Full real-browser pass exercising both the existing chat and the new step selector.

## Branch

Continuing on `main` in `dialex-backend` (migration) and `dialex-orchestrator` (graph/workflow/router), `dialex-frontend` (step selector) — matching every prior phase.
