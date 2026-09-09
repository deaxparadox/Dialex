# Spec 0048 — Cofounder Phase 1e: Pinecone RAG + basic roadmap agent

Implements ADR 0014's Phase 1, fifth slice — a reduced scope of the original "roadmap_agent + Pinecone RAG" goal, split further per the user's explicit call after a much larger real scope surfaced during investigation (see below). This phase: ingest the original's 6 training documents into a real Pinecone index, a `query_pinecone_tool` for `ideation_agent`, and a basic `roadmap_agent` that generates a roadmap via LLM + that RAG tool alone — **no template-workbook seeding** (the 31-file downloadable template system + its own prompt-embedding mechanism is Phase 1f, its own spec).

## Scope correction, recorded transparently

The original spec-writing pass for this phase assumed "roadmap_agent + Pinecone RAG" was one coherent, modestly-sized unit, matching the size of Phases 1c/1d. Reading the actual source revealed a much larger reality: `entrepreneur_roadmap_agent`'s prompt (`cofounder_roadmap_prompt`) isn't a plain string — it's an async function that loads `services/template.yaml` and embeds a whole 7-step curriculum structure (Personal Finance Readiness → Idea Validation → Legal/Compliance → MVP → Systems/Infra → Launch → Operations) plus references to 31 real downloadable template files (`media/templates/step-{1-7}/*.{xlsx,docx,rtf}`) and a file-download endpoint (`ai/views/template.py`'s `TemplateWorkbookView`) — none of which was previously known or scoped. Flagged directly to the user; their call: split further. This spec covers only the Pinecone-RAG half; the template/workbook system is Phase 1f.

## New dependencies (each verified, not assumed)

- **`pinecone==10.0.0`** — the original used `pinecone==7.3.0`; verified live against the current SDK docs that the API has genuinely changed across that 3-major-version gap, not just a version bump. Decision (user's call): use the new **integrated index** feature (`IntegratedSpec`/`EmbedConfig`) — Pinecone embeds text server-side, so there's no separate OpenAI embedding call to make or maintain, and no raw-vector upload code — a real simplification over the original's bring-your-own-embedding approach (`services/pinecone.py`'s `embed_query` calling OpenAI directly, then uploading the raw vector). Verified the async client (`AsyncPinecone`) fully supports `upsert_records`/`search` with the same integrated-embedding shape as the sync client — no `asyncio.to_thread` wrapping needed anywhere, genuinely async end to end.
- **`python-docx==1.2.0`** — reads the 6 `.docx` training files' text content for ingestion. Not previously installed.

## Current state, verified directly against the original source

- `ai/tools/pinecone.py`'s `query_pinecone_tool` calls `services/pinecone.py`'s `query_pinecone` — which is defined **twice** in the original (a real, pre-existing bug/leftover, not something this port introduces); only the second definition is ever actually called (Python keeps the later one), returning `list[dict]` with a single `text` key per match — no title/url metadata exists in the original's real ingested content either.
- `ai/prompts/enterpreneur_get_step_resources.py`'s `get_resources_for_step_prompt` asks an LLM to select 3-5 relevant sources from retrieved Pinecone text and return `title`/`reason`/`url` — "url if available," not fabricate-a-url-regardless. Deferred to Phase 1f along with `enrich_roadmap_with_resources` (the per-roadmap-step enrichment loop) — this phase's `roadmap_agent` returns a plain LLM-generated roadmap, not yet enriched per-step from Pinecone.
- The 6 training `.docx` files (`Academic.docx`, `Competitive analysis.docx`, `Customer validation source.docx`, `Real time market intelligence.docx`, `free_databases_by_country.docx`, `free_databases_with_tax_authorities.docx`) are modest in size (22KB-143KB) — generic startup-research reference material, verified not client-confidential by content/naming. User's call: port as-is.

## Fix

### `dialex-orchestrator`

`requirements.txt` gains `pinecone==10.0.0`, `python-docx==1.2.0`.

`core/config.py`: new `pinecone_api_key: str = Field(min_length=1)` (same fail-fast pattern as `openai_api_key`/`google_api_key`) and a behavioral-knob default `pinecone_index_name: str = "cofounder-training"` (a name, not a secret — CLAUDE.md rule 5 allows a safe code default here). `.env.example` gains both.

New `app/cofounder/chat/data/training/` — the 6 `.docx` files copied in verbatim (real, committed reference content, not a secret).

New standalone script `scripts/ingest_cofounder_training_data.py` (run manually once, safely re-runnable — not part of request-serving code, matches the `seed_case_types` precedent's "idempotent, explicit setup step" pattern from spec 0043 but as a plain script since the orchestrator has no Django-style management-command machinery): creates the Pinecone integrated index if it doesn't already exist (`pc.indexes.list()` check, same idempotent-check discipline used elsewhere), reads each `.docx`'s paragraphs via `python-docx`, chunks into ~1000-character sections (simple paragraph-accumulation, not a naive single-blob-per-file upload — better retrieval granularity for reasonably-sized documents), and calls `index.upsert_records(namespace="cofounder-training", records=[{"_id": ..., "text": ...}, ...])` — Pinecone embeds each chunk server-side, no separate embedding step.

New `app/cofounder/chat/tools/pinecone_rag.py`: `query_pinecone_tool` (ported faithfully — same docstring/purpose as the original), calling `index.search(namespace="cofounder-training", inputs={"text": question}, top_k=5)` via `AsyncPinecone`, returning `list[dict]` with `text` per hit (matching the original's actual real behavior, not its unused first `query_pinecone` definition).

`graphs.py`:
- `_ideation_agent`'s tool list grows to 5 — adds `query_pinecone_tool` alongside the existing 4.
- New `_roadmap_agent` node (`execute_in: "activity"`, same generous timeout class as ideation given a real LLM call producing a large structured JSON response): a plain `ChatOpenAI` call (`.with_structured_output()`, matching this port's established convention over the original's manual JSON-string handling) using a **trimmed** version of the original's roadmap schema — `idea_summary`/`roadmap` (steps with title/description/objectives) kept; `execution_support`/`mentorship`/`events`/`funding` sections **kept in the schema but explicitly flagged in the spec and to the user as inherently ungrounded** — the original itself never wired any real data source for funding/mentor/event suggestions either (no tool queries a funding database or events calendar anywhere in the source), so this isn't a new limitation introduced by this port, just an inherited one worth being transparent about. No `enrich_roadmap_with_resources` step yet (Phase 1f) — the `resources`/`templates` fields per step are whatever the LLM produces on its own for this phase, not yet grounded in the real 31-file catalog.
- `_route_conditional`: `entrepreneur_roadmap_agent` → `"roadmap"` (real now, replacing the `not_available` fallback for this destination). Image generation and the ideation `not_available`-adjacent behavior are unaffected.

### `dialex-backend` / `dialex-frontend`

No change — same `SubmitMessageResponse` contract, roadmap never returns an image.

## Explicitly out of scope

The 31-file template/workbook system, `services/template.yaml`, the `TemplateWorkbookView` file-download endpoint, and `enrich_roadmap_with_resources`'s per-step Pinecone-enrichment loop — all Phase 1f, its own spec, once this phase's mechanism is proven. Any UI to render a roadmap's rich structure nicely (this phase's frontend just shows whatever text the graph returns, same minimal-rendering approach every phase has used so far).

## Verification plan

**Ingestion**: run the script once against the real Pinecone account, confirm the index is created (or already exists, idempotent), confirm a direct `index.describe_index_stats()`-style check shows a non-zero, sensible record count matching the actual chunk count produced from the 6 files.

**Real API calls**: a message that should clearly trigger `query_pinecone_tool` from within ideation (e.g. "what free databases exist for market research by country?" — content genuinely present in the ingested `free_databases_by_country.docx`) — confirm the reply reflects specific content that could only come from the ingested documents (not generic LLM knowledge — cross-check against the actual source `.docx` content). A message that should trigger the roadmap path (e.g. "give me a roadmap to launch this business") — confirm a real, structured, multi-step roadmap comes back as a coherent reply (not an error, not a truncated/malformed response). Regression check: market research, Google Places, image generation, and the ideation Bubble.io-placeholder path all still route/work correctly. Direct DB check that all turns persist correctly. Real browser: exercise both new paths through the actual UI; zero console errors, zero 4xx/5xx.

## Branch

Continuing on `main` in `dialex-orchestrator` (no backend/frontend changes this phase), matching every prior phase.
