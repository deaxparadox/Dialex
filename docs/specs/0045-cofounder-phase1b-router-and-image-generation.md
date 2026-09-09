# Spec 0045 — Cofounder Phase 1b: real router + image-generation path

Implements ADR 0014's Phase 1, second slice. Replaces Phase 1a's placeholder single-LLM-call reply with the original's actual routing structure — a real LangGraph `StateGraph`, run the same way `ConsultationWorkflow` already runs one (via `temporalio.contrib.langgraph`'s `LangGraphPlugin`, not manual per-node Activity wiring). Only the `image_generation_agent` branch is fully real; `ideation`/`roadmap` are deferred to their own later specs (1c/1d/1e) since each needs its own new-dependency approval.

## Current state, verified directly against the original source (not assumed)

- `ai/graphs/enterpreneur_graph.py`: the compiled graph has `START` → `user_query_node` → `entrepreneur_router_agent` → `entrepneur_conditional_node` (a conditional edge reading `state['router_response']['recommended_node']`) → one of three real destinations. **Two nodes are added to the graph but never reachable from the conditional edges** — `entrepreneur_chat_node` and `entrepreneur_overview_agent` — dead code in the original, not ported.
- `ai/prompts/entrepreneur_router_prompt.py`: the router's system prompt lists exactly 3 valid `recommended_node` values — `entrepreneur_ideation_agent`, `entrepreneur_roadmap_agent`, `image_generation_agent` — and asks for a JSON object (`intent`/`recommended_agent`/`recommended_node`/`reasoning`/`next_action`), parsed via manual string-stripping (`` ```json `` removal) + `json.loads`. Not ported as-is — Dialex's own established convention (`ConsultationWorkflow`'s `_draft`/`_critique` nodes) uses `.with_structured_output(SomeModel)` for exactly this kind of LLM-produces-structured-decision step, which is more robust than string-stripping and is what this spec uses instead — a deliberate, minor improvement, not a literal port of the original's parsing mechanism.
- `ai/tools/image_generation.py`'s `image_gen()`: a direct `openai.AsyncOpenAI().images.generate(model="dall-e-3", prompt=user_query, n=1, size="1024x1024", response_format="url")` call — the user's message is passed straight through as the DALL-E prompt, no LLM-crafted prompt-refinement step (the original's `image_generation_prompt()` import is commented out, unused). Verified the `openai` package is already installed in `dialex-orchestrator` (2.54.0, a transitive dep of `langchain-openai`) — no new dependency needed. `image_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)` in the original — same key already in use for chat, confirmed by this repo's own `settings.openai_api_key`.
- `ai/agents/enterpreneur_agent.py`: the image path's final response is `{"type": "image_response", "logo": <url>}` (`json.dumps` of `image_gen()`'s return), distinct in shape from the ideation/roadmap paths' plain string — the frontend needs to render an image, not just text, when this branch fires.
- `dialex-orchestrator/app/dialex/consultations/graphs.py`: the actual mechanism to copy. `build_consultant_graph()` returns a plain (uncompiled) `StateGraph`; each node is registered with `metadata={"execute_in": "activity", "start_to_close_timeout": ..., "retry_policy": ...}` — `temporalio.contrib.langgraph`'s own mechanism for making a LangGraph node run as a genuine, durable, retryable Temporal Activity automatically, with zero hand-written `@activity.defn`/`workflow.execute_activity()` boilerplate per node. The graph is registered once in `worker.py`'s `LangGraphPlugin(graphs={CONSULTANT_GRAPH: build_consultant_graph()})` and invoked from the Workflow via `await graph(CONSULTANT_GRAPH).compile().ainvoke(state)`. Conditional-edge routing functions must be `async def`, not sync — verified in that file's own comment: LangChain's runnable-coercion falls back to a background-thread executor for sync callables under `ainvoke()`, and Temporal's workflow sandbox forbids spawning real OS threads.

## Fix

### `dialex-orchestrator`

New `app/cofounder/chat/graphs.py`, mirroring `consultations/graphs.py`'s structure exactly:
```python
COFOUNDER_GRAPH = "cofounder-graph"

class CofounderGraphState(TypedDict):
    session_id: int
    turns: list[dict]       # already includes the current user message (Phase 1a's convention)
    router_response: dict | None
    reply: str | None
    image_url: str | None

class RouterDecision(BaseModel):
    intent: str
    recommended_node: Literal["entrepreneur_ideation_agent", "entrepreneur_roadmap_agent", "image_generation_agent"]
    reasoning: str

async def _route(state) -> dict:               # execute_in: activity
    # real LLM call, .with_structured_output(RouterDecision), same router-prompt
    # content as the original (3 destinations, routing rules) ported into a
    # system prompt — not the original's manual JSON-string-parsing.
    ...

async def _route_conditional(state) -> str:    # must be async (see above)
    node = state["router_response"]["recommended_node"]
    return "image" if node == "image_generation_agent" else "not_available"

async def _image_generation_agent(state) -> dict:   # execute_in: activity
    # direct openai.AsyncOpenAI().images.generate(...), same call shape as the
    # original's image_gen() — ported faithfully, this path is fully real.
    ...
    return {"reply": "Here's what I generated:", "image_url": url}

async def _not_available(state) -> dict:       # execute_in: activity
    return {"reply": "I can only generate images so far in this early version — ideation and roadmap planning are coming in a later phase."}

def build_cofounder_graph() -> StateGraph:
    g = StateGraph(CofounderGraphState)
    ...
    g.add_edge(START, "route")
    g.add_conditional_edges("route", _route_conditional, {"image": "image_generation_agent", "not_available": "not_available"})
    g.add_edge("image_generation_agent", END)
    g.add_edge("not_available", END)
    return g
```
`worker.py`: registers `COFOUNDER_GRAPH: build_cofounder_graph()` in the existing `LangGraphPlugin(graphs={...})` dict alongside `ARGUMENT_GRAPH`/`JUDGE_OPENING_GRAPH`/`JUDGE_CLOSING_GRAPH`/`CONSULTANT_GRAPH`.

`workflows.py`: `CofounderWorkflow.submit_message` replaces its call to `activities.generate_cofounder_reply` with `result = await graph(COFOUNDER_GRAPH).compile().ainvoke(state)`, builds `state` from `session_id`/`turns`, and returns `{"reply": result["reply"], "image_url": result.get("image_url")}`. `activities.py`'s `generate_cofounder_reply` (the Phase 1a placeholder) is deleted — the graph replaces it entirely, not sits alongside it. `persist_cofounder_turn`/`fetch_cofounder_turns` stay exactly as they are, called from the Workflow before/after the graph runs (same pattern as `ConsultationWorkflow`) — only the "generate the actual reply" step changes shape.

`schemas.py`: `SubmitMessageResponse` gains `image_url: str | None = None`.

### `dialex-backend`

No change — this phase doesn't touch persisted data shape (an image URL is just conversational content, stored as `CofounderTurn.content` the same way text is, matching how the original stored a JSON-encoded response either way).

### `dialex-frontend`

`(protected)/cofounder/page.tsx`: `ChatMessage` gains an optional `imageUrl`; when a reply includes one, render an `<img>` under the reply text instead of (or alongside) the text. `cofounder-chat-api.ts`'s `SubmitMessageResponse` gains the matching `image_url` field.

## Explicitly out of scope

`ideation_agent` and its 5 tools (own later specs, each new dependency gets its own approval — DuckDuckGo/Google Places/Pinecone RAG; the 2 Bubble.io tools stay a known gap per the user's call). `roadmap_agent` and `enrich_roadmap_with_resources` (needs Pinecone, same reason). WebSocket/status streaming (still not needed yet — even a 2-node graph here is short; revisit once `ideation`'s tool-calling loop, which can genuinely run long, actually lands). Any change to how `CofounderSession`/`CofounderTurn` are structured.

## Verification plan

Real API calls (not curl-only-then-assume): a message that should clearly route to image generation (e.g. "generate a logo for my bakery called Sunrise Bread") — confirm the response includes a real, fetchable `image_url` and the reply text isn't empty/wrong. A message that should route to ideation or roadmap (e.g. "help me think through whether this business idea makes sense") — confirm the router correctly identifies it as *not* image generation and the "not available yet" message comes back cleanly, not an error. Direct DB check that both turns persisted correctly. Real browser: send an image-generation request through the actual UI, confirm the image renders; send a non-image request, confirm the graceful "not available" message renders as plain text; reload (fresh session, still expected); zero console errors, zero 4xx/5xx.

## Branch

Continuing on `main` in all three repos, matching every prior phase.
