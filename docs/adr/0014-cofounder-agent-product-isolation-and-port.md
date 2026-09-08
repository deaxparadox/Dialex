# ADR 0014 — Cofounder agent: product-isolation scaffold + porting architecture

## Context

ADR 0013 split Dialex into three service repos (`dialex-backend`/`dialex-orchestrator`/`dialex-frontend`) with the stated intent that each becomes "the shared home for every product as internal modules (a Django app per product, an orchestrator module per product, a frontend route-tree per product)." That intent was never actually built — verified directly (not assumed) against all three repos: `dialex-backend`'s `apps/` holds only Dialex's own apps (`accounts`/`cases`/`debates`/`consultations`/`reviews`/`notifications`) flat in `INSTALLED_APPS`; `dialex-orchestrator`'s `app/` holds only `consultations`/`debates` flat plus a genuinely product-agnostic `core/`; `dialex-frontend`'s route groups are just `(guest)`/`(protected)` with no product segment. Nothing today would stop new product code from becoming more undifferentiated flat siblings.

This ADR is triggered by starting the first real product port — the AI cofounder agent ("Brunda", client: The Entrepreneur Lab) — chosen by the user as the second product. Its actual source was verified live (not from the months-old analysis docs alone) on `~/Documents/gt-atul/ai-bot-handover`'s `dev/backend`/`dev/frontend` git branches, confirmed to match `~/Documents/gt-dp/project-analysis/entrepreneur-lab-cofounder/`'s architecture documentation. Original stack: Django ASGI + LangGraph (two graphs: a free-form router-based graph and a 7-step structured graph) + Django Channels WebSocket consumers reading raw Redis pub/sub + LangGraph's own `AsyncPostgresSaver` checkpointing + Pinecone RAG + a Bubble.io SSO bridge (`bubbleio` app, since the original ran embedded inside a Bubble.io-hosted client SaaS).

Also surfaced during source verification, unrelated to this ADR's scope: `~/Documents/gt-atul/ai-bot-handover`'s git remote has a GitHub Personal Access Token embedded in plaintext, pointing at the client's own org (`thentrepreneurlab`) — flagged directly to the user to rotate/revoke if still live; not touched here.

## Decision 1 — Nested per-product packages, not flat

`dialex-backend`: Dialex's existing apps move from `apps/{cases,debates,...}` to `apps/dialex/{cases,debates,...}`; cofounder's new apps land at `apps/cofounder/*`. `dialex-orchestrator`: same pattern, `app/dialex/*` (moving `consultations`/`debates`) and `app/cofounder/*`; `app/core/` stays where it is (genuinely shared, not product-specific). `dialex-frontend`: cofounder's routes get their own group/segment, kept separate from Dialex's existing `(protected)` pages (exact route shape decided in the frontend-port phase, not this ADR).

This is a real, enforced boundary (a physical package per product), not a naming convention — chosen because a naming-only convention (e.g. `cofounder_agent` sitting flat next to `debates`) gets easier to violate as more products are added, and this repo is explicitly meant to host several.

**The one real risk this decision introduces**: Dialex's existing Django apps must move to a new Python import path (`apps.dialex.debates` instead of `apps.debates`) without corrupting migration history or `ContentType` records, both of which are keyed by the app's **label**, not its import path. Verified directly against the official Django 5.2 docs (not recalled): `AppConfig.name` (the import path) and `AppConfig.label` (the DB-facing identifier) are independently settable — Django's own documented reusable-app pattern pins `label` explicitly while `name` differs from it. The docs explicitly warn that changing `label` after migrations exist breaks things, so the safe move is: relocate each app's directory, update its `INSTALLED_APPS` entry to the new dotted path, and **explicitly set `label` in each `AppConfig`** to its current, unchanged value. No migration files change, no `ContentType` rows change, no FK `to="debates.Model"`-style references change (those already address the label, never the import path).

## Decision 2 — Cofounder shares Dialex's existing auth, not a separate bridge

The original `bubbleio` app (custom `BubbleUserModel`, Bubble.io SSO handoff) is not ported at all — there is no Bubble.io host in this platform. Cofounder's Django models hang off Dialex's existing `accounts` User model via FK, exactly like every other Dialex app already does. One platform, one login — the user's explicit call, consistent with the original "unify all of them in one place" goal.

## Decision 3 — Real-time/orchestration architecture mirrors Dialex's existing split, not the original's

The original's Django Channels WebSocket consumers (reading raw Redis pub/sub, with LangGraph's Postgres checkpointer holding graph state) are **not** ported as-is. Instead: Django (`dialex-backend`, `apps/cofounder/*`) owns persisted chat sessions/messages + the REST API — the same role `debates`/`consultations` apps already play. `dialex-orchestrator` (`app/cofounder/*`) owns the actual agent execution: the two LangGraph graphs (free-form router graph, 7-step structured graph) become Temporal-orchestrated activities, and status updates stream over the orchestrator's existing FastAPI WebSocket + Redis pub/sub pattern — not Django Channels.

**Why** (the user's own reasoning, recorded verbatim in intent): Django stays for account handling and will later gain Celery for background tasks like email — it was never meant to run agent workloads. The orchestrator is FastAPI specifically because agent execution needs to be async and durable (Temporal), which is what it already does for Dialex. Introducing Django Channels here would mean either converting Django to fully async (of no benefit to Dialex's own needs) or running two independent parallel real-time mechanisms side by side in a platform that's explicitly meant to converge on one shared pattern per service, per ADR 0013's own goal.

## Sequencing

1. **Phase 0** (spec 0043): the product-isolation scaffold above, applied to Dialex's *existing* code only — zero functional change. Verified standalone (full regression pass, same standard as every prior cutover) before any cofounder-specific code is written. Chosen deliberately separate from Phase 1 so a regression during verification is unambiguous — it can only be the restructuring, since no new code exists yet to blame it on.
2. **Phase 1+** (not yet specced): cofounder's Django models/API (`apps/cofounder/*`), the LangGraph→Temporal-activity translation (`app/cofounder/*`), and the frontend chat surface — each gets its own spec when it starts, not bundled into one. New external dependencies this port needs (Pinecone, Google Places API, DALL-E, DuckDuckGo search) each require individual approval before being added, per this repo's standing no-new-dependency-without-asking rule.

## What this doesn't cover

The actual LangGraph-to-Temporal-activity design (node-by-node mapping, checkpointing strategy replacing `AsyncPostgresSaver`), the cofounder data model, the frontend chat UI's shape, or the Pinecone/Google Places/DALL-E integration specifics — all deferred to their own later specs once Phase 0 is verified.
