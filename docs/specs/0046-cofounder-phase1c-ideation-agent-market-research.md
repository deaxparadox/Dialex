# Spec 0046 — Cofounder Phase 1c: ideation agent + market research tool

Implements ADR 0014's Phase 1, third slice. Adds the `ideation_agent` path to the cofounder graph — a ReAct tool-calling agent, faithfully ported including its full market-research web-search-and-scrape pipeline (the user's explicit call, over a simplified snippets-only version). The two Bubble.io-only tools (`get_bubble_entreprenurs`/`get_bubble_freelancers_v2`) are bound as honest placeholders, per the user's earlier instruction — not removed, not built against a real data source yet.

## New dependencies (each verified, not assumed)

- **`ddgs==9.16.0`** — the original's `duckduckgo_search` package was renamed; verified live (web search) that this is an active, ongoing rename, not a one-time bump — LangChain's own `DuckDuckGoSearchResults`/`DuckDuckGoSearchAPIWrapper` wrapper has a real, currently-open compatibility issue with it (GitHub `langchain-ai/langchain#31892`), plus a longer-running, separate fragility pattern in the same library (`VQDExtractionException`, DuckDuckGo's unofficial scraping endpoint breaking periodically as DuckDuckGo changes its page structure). Decision: bypass `langchain_community`'s wrapper entirely and call `ddgs`'s own documented API directly (`from ddgs import DDGS; DDGS().text(query, max_results=...)`, verified against the library's real README — returns `list[dict]` with keys `title`/`href`/`body`, **not** `title`/`link`/`content` as the original code assumed) — same practical result, sidesteps the known-broken integration, and means `langchain-community` itself isn't needed as a dependency at all.
- **`beautifulsoup4==4.15.0`** — HTML content extraction for fetched pages, ported as-is.
- **`aiohttp==3.14.3`** — the actual page-fetching client, ported as-is. Neither this nor `beautifulsoup4` was previously installed in `dialex-orchestrator` (verified directly, not assumed — both raised `ModuleNotFoundError`).
- `brotli` stays optional (try/except import, graceful degradation), matching the original's own pattern exactly — not a hard dependency.

## Current state, verified directly against the original source

- `ai/tools/web_search.py`'s `market_research_tool`: generates 3 targeted search queries (market size, trends, competitors) from the user's base query, runs each through DuckDuckGo, fetches and cleans each result page's actual HTML (BeautifulSoup content extraction, manual gzip/deflate/brotli decompression fallbacks, retry-with-backoff on 429s, randomized User-Agent rotation, a semaphore-limited concurrent fetch), buckets results into 3 categories, caps at 6 total results — real, hardened scraping logic (the inline "REDUCED from 5000"/"CHANGE 1/2/3" comments show this was tuned against real failures already), not naive.
- `ai/llm/openai.py`: `ideation_llm_chat = create_react_agent(tracked_llm, tools=[get_bubble_entreprenurs, get_bubble_freelancers_v2, market_research_tool, search_place_and_rating_v2, query_pinecone_tool])` — a `langgraph.prebuilt.create_react_agent`, confirmed available in this project's installed `langgraph==1.2.9`. This phase binds only the 3 tools that exist right now (the 2 Bubble.io placeholders + market research); `search_place_and_rating_v2`/`query_pinecone_tool` get added to this same tool list once Phases 1d/1e land.
- `ai/graphs/enterpreneur_graph.py`'s `entrepreneur_ideation_agent`: builds `messages = [{"role": "system", "content": cofounder_ideation_agent_prompt}, *history, {"role": "user", "content": user_query}]`, invokes `ideation_llm_chat.ainvoke({'messages': messages}, ...)`, takes `response['messages'][-1].content` as the final reply — the react-agent's entire multi-step tool-calling loop runs inside this one call, matching this codebase's own node-runs-as-one-Activity granularity with zero special handling needed.
- `ai/prompts/entrepreneur_ideation_prompt.py`'s system prompt instructs the model to always wrap its answer in `{"type": "general_response", "data": "..."}` JSON — verified this envelope is never actually consumed anywhere: the graph node itself just stores the raw string, and the only downstream parse attempt (`agents/enterpreneur_agent.py`) wraps `json.loads()` in a bare `try/except: pass`, silently keeping the raw string on any failure. Since nothing ever branches on `type` (only one value, `general_response`, is ever used) and the field carries no behavior, this spec drops the JSON-envelope instruction from the ported prompt — the substantive guidance (guide brainstorming, ask clarifying questions, validate for market fit/differentiation, never generate roadmaps) is kept verbatim; only the unused formatting requirement is cut. A deliberate, minor adaptation, not a redesign — flagging it explicitly rather than silently changing it.

## Fix

### `dialex-orchestrator`

`requirements.txt` gains `ddgs==9.16.0`, `beautifulsoup4==4.15.0`, `aiohttp==3.14.3`.

New `app/cofounder/chat/tools/` package:
- `market_research.py` — `market_research_tool` and its full support functions (`fetch_page_text`, `fetch_multiple_pages`, `generate_market_queries`, `safe_read_response`, `manual_decompress`, `get_headers`, `USER_AGENTS`) ported near-verbatim. Two concrete fixes: the DuckDuckGo call becomes `await asyncio.to_thread(lambda: DDGS().text(search_query, max_results=...))` (DDGS's `.text()` is synchronous, wrapped so it doesn't block the event loop, replacing `langchain_community`'s async wrapper); `fetch_multiple_pages`'s field lookup changes from `item.get("link") or item.get("url")` to `item.get("href")`, matching `ddgs`'s real, verified key names.
- `bubble_placeholders.py` — `get_bubble_entreprenurs`/`get_bubble_freelancers_v2` as `@tool`-decorated async functions returning an honest, structured "not connected yet" result (e.g. `{"available": False, "message": "Entrepreneur/freelancer directory lookup isn't connected to a real data source yet in this platform."}`) rather than either a fabricated answer or a crash — the ReAct agent can reason around a clearly-marked unavailable tool.

`graphs.py`:
- New `_ideation_agent` node (`execute_in: "activity"`), a longer, dedicated timeout (`_IDEATION_NODE_TIMEOUT = timedelta(seconds=180)` — the original 60s default is too tight for 3 real search queries plus concurrent page fetches with their own retry/backoff, verified from the ported pipeline's own timeout/delay constants). Builds `create_react_agent(ChatOpenAI(model="gpt-4o-mini", ...), tools=[get_bubble_entreprenurs, get_bubble_freelancers_v2, market_research_tool])`, invokes with the same message-list shape the original used (system prompt + transcript-as-history + latest message), returns `{"reply": <final message content>}`.
- `_route_conditional` extended: `entrepreneur_ideation_agent` → `"ideation"` (real now), `image_generation_agent` → `"image"` (unchanged), `entrepreneur_roadmap_agent` → `"not_available"` (unchanged — roadmap is still Phase 1e's job).
- `build_cofounder_graph()`: adds the `ideation_agent` node/edge to the existing conditional-edges dict.

### `dialex-backend` / `dialex-frontend`

No change — same `SubmitMessageResponse` contract (`reply`, `image_url`), ideation never returns an image.

## Explicitly out of scope

`entrepreneur_roadmap_agent`/`enrich_roadmap_with_resources` (needs Pinecone — Phase 1e). `search_place_and_rating_v2` (Google Places — Phase 1d) and `query_pinecone_tool` (Pinecone RAG — Phase 1e), both deferred additions to this same tool list once their own phases land. A real data source for the 2 Bubble.io tools (the user's own future call). WebSocket/status streaming — this phase makes that genuinely more relevant (a real multi-tool-call loop can run 30-90+ seconds), but still deferred; revisit once ideation's actual latency in practice is observed.

## Verification plan

Real API calls: a message that should clearly trigger ideation with real market research (e.g. "I want to validate an idea for a subscription box for artisanal coffee — is this a good market?") — confirm the router picks ideation, the reply reads as genuinely informed by real, current web results (not a generic canned answer — check for specific facts/figures that could only come from an actual search), and it does NOT ask the agent to generate a roadmap (per the ported prompt's own instruction). Confirm the placeholder Bubble.io tools don't break anything even if the agent's own reasoning tries to call one (a graceful "not connected yet" tool result, not a crash) — may need a prompt specifically likely to invoke that tool (e.g. "find me some freelancers for this") to actually exercise that path. Re-confirm image-generation and roadmap-triggering messages still route correctly (regression check against Phase 1b). Direct DB check that ideation turns persist correctly. Real browser: send an ideation-triggering message through the actual UI, confirm a real, substantive reply renders (allow for a longer wait, given the real search/fetch latency); zero console errors, zero 4xx/5xx (allowing that this call may genuinely take significantly longer than prior phases').

## Branch

Continuing on `main` in `dialex-orchestrator` (no backend/frontend changes this phase), matching every prior phase.

## Found during implementation

The first draft's `_ideation_agent` needlessly special-cased the last turn (splitting `state["turns"]` into history + a separately-appended "current message") — since `turns` already ends with the just-persisted user message (same convention established in spec 0044), this was redundant; simplified to a single loop over all turns. No functional bug, just unnecessary code caught before it shipped.

## Found during verification

No bugs. Verified via real API calls against a real running stack (not curl-once-then-assume): a genuine market-research request ("run an actual market research search... for artisanal coffee subscription boxes") returned a reply citing a specific market-size figure ($1,281.2M → $3,500M projected, 10.6% CAGR) with a real source URL — confirming the `ddgs`-based search-and-scrape pipeline actually executed, not a generic LLM answer. A first, less pointed message ("is this a good market?") legitimately triggered the agent's own clarifying-question behavior instead of an immediate tool call — expected, matches the ported prompt's own instructions, not a bug. The placeholder Bubble.io tools were exercised directly (a message asking to check the internal freelancer/entrepreneur database) — the agent called the tool, got the "not connected" result, and gracefully redirected to external alternatives, no crash. Regression-checked: a roadmap-requesting message still correctly hits `not_available`; an image-generation request still correctly produces a real image. A direct DB check confirmed all 10 turns across these 4 request types persisted in the correct order. A full real-browser pass (Canary) independently re-verified the cited market-research URL actually resolves to a real, live page (not a hallucination) and confirmed the same regression checks through the actual UI — zero console errors, zero failed/4xx/5xx requests across every step.

## Status

Implemented and verified against the real running stack. Committed and pushed to `dialex-orchestrator` (no backend/frontend changes this phase). Phase 1d (Google Places tool) and Phase 1e (`roadmap_agent` + Pinecone RAG) are not yet specced.
