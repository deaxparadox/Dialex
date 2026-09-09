# Spec 0047 — Cofounder Phase 1d: Google Places tool

Implements ADR 0014's Phase 1, fourth slice. Adds `search_place_and_rating_v2` to the `ideation_agent`'s tool list — a 4th tool, no new graph structure. Structurally the simplest phase so far: direct HTTP calls to Google's Places API (New), no new Python package (`aiohttp` is already installed, from Phase 1c). The real requirement is a genuine external secret — a Google Cloud API key with the Places API enabled and billing configured, provided by the user.

## Current state, verified directly against the original source and the live Google API docs (not assumed)

- `ai/tools/google_place_search.py`'s `search_place_and_rating_v2`: calls `services/google/place.py`'s `search_place(place)` (POST `https://places.googleapis.com/v1/places:searchText`, field mask `places.id,places.displayName,places.formattedAddress`, takes the first result's `id`) then `get_place_details(place_id)` (GET `https://places.googleapis.com/v1/places/{place_id}`, field mask `id,displayName,formattedAddress,rating,userRatingCount,reviews,websiteUri`), both authenticated via an `X-Goog-Api-Key` header. Both use plain `aiohttp` calls — no Google SDK package.
- Verified live against Google's current Places API (New) docs: the `places:searchText` endpoint and this exact field-mask shape are still current, not deprecated. One real cost fact surfaced: `rating`/`userRatingCount` are billed at "Enterprise SKU" tier and `reviews` at "Enterprise + Atmosphere SKU" (pricier still) — a meaningfully higher cost tier than basic fields. Flagged to the user directly; their call: keep the original's exact field mask, ratings/reviews included.
- `search_place_and_rating` (the non-`_v2` version) exists in the original but isn't bound to `ideation_llm_chat`'s tool list at all — only `_v2` is. Not porting the unused `_v2`-less variant, matching the same "only port what's actually reachable" discipline used for the dead graph nodes in spec 0045.
- `core/config.py`'s existing `Settings` (pydantic-settings, fail-fast pattern, CLAUDE.md rule 4): `openai_api_key: str = Field(min_length=1)` is the direct precedent for a required-secret field that fails loudly at startup if missing, not silently.

## Fix

### `dialex-orchestrator`

`core/config.py`: new `google_api_key: str = Field(min_length=1)` — same fail-fast pattern as `openai_api_key`, a required secret, not optional (this tool genuinely can't function without it, and a blank/missing key should fail at process startup, not deep inside an Activity call). `.env.example` gains `GOOGLE_API_KEY=` with a short comment. The user provides the real value in their own `.env` (not committed, matching every other secret in this repo).

New `app/cofounder/chat/tools/google_places.py`:
```python
async def search_place(place: str) -> str | None:
    # POST places:searchText, same field mask as the original, returns the
    # first result's id (or None if nothing found).

async def get_place_details(place_id: str) -> dict:
    # GET places/{place_id}, same field mask as the original (name, address,
    # rating, review count, reviews, website).

@tool
async def search_place_and_rating_v2(place: str) -> dict:
    # Ported verbatim, including its full docstring (the original's own
    # tool-selection guidance for the ReAct agent — when to use it, how to
    # phrase queries, how to handle empty results) since that content
    # directly steers real agent behavior, not just documentation.
```

`graphs.py`: `_ideation_agent`'s tool list grows from 3 to 4 — `create_react_agent(llm, tools=[get_bubble_entreprenurs, get_bubble_freelancers_v2, market_research_tool, search_place_and_rating_v2])`. No other graph change.

### `dialex-backend` / `dialex-frontend`

No change.

## Explicitly out of scope

`entrepreneur_roadmap_agent`/`enrich_roadmap_with_resources` (needs Pinecone — Phase 1e, the last of the three real tools). Any change to the router or graph structure beyond the tool-list addition. A real data source for the 2 Bubble.io placeholders (the user's own future call).

## Verification plan

Real API calls: a message that should clearly trigger a Places lookup (e.g. "find me a good coffee roaster supplier in Seattle" or, following the tool's own documented workflow, "find me an employment lawyer in Bangalore") — confirm a real place comes back with a plausible name/address/rating (cross-check at least one result's name/address against a real search independently, the same way Phase 1c's cited URL was independently verified, to rule out hallucination). Confirm a nonsense/unfindable place query returns gracefully (empty dict, not a crash) and the agent handles that reasonably. Regression check: market research, image generation, and roadmap-not-available still all route/work correctly. Real browser: send a places-triggering message through the actual UI, confirm a plausible real-world result renders; zero console errors, zero 4xx/5xx.

## Branch

Continuing on `main` in `dialex-orchestrator` (no backend/frontend changes this phase), matching every prior phase.

## Found during implementation

A real bug caught at worker startup, not anticipated: `google_places.py`'s `from ...core.config import settings` used the wrong relative-import depth. `tools/` sits one level deeper than `graphs.py`'s own directory (`app/cofounder/chat/tools/` vs. `app/cofounder/chat/`), so reaching `app.core` needs 4 dots, not 3 — `market_research.py`/`bubble_placeholders.py` never hit this since neither imports from `core` at all. Fixed immediately; no further testing was blocked by it for long.

## Found during verification

No bugs beyond the one above. Verified via real API calls against the real running stack: a genuine Places lookup ("find me an employment lawyer in Bangalore") returned a specific, real-looking business — name, full street address, a 4.9 rating from 2,451 reviews, and a website (`kamalandcoadvocates.com`) that was independently curled and confirmed to return a real HTTP 200 — not hallucinated. An unfindable-business query ("Zzxqvplonk Frobnicate Consulting in Nowhereville") correctly returned a graceful "couldn't find it" reply, no crash. Regression-checked: market research, roadmap-`not_available`, and image generation all still route and work correctly in the same session. A direct DB check confirmed all 8 turns across these 4 request types persisted in the correct order. A full real-browser pass (Canary) independently reproduced the same result shape through the actual UI (a different, equally specific and plausible business — name, address, rating, review count, website) and confirmed all the same regression checks — zero console errors, zero failed/4xx/5xx requests across the whole run.

## Status

Implemented and verified against the real running stack. Committed and pushed to `dialex-orchestrator` (no backend/frontend changes this phase). Phase 1e (`roadmap_agent` + Pinecone RAG) is not yet specced — the last of the three real tools, and the heaviest lift (needs an account, a vector index, and real content to ingest).
