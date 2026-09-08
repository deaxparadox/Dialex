# ADR 0012 — Migrate the frontend from Angular to Next.js

> Reached via a full brainstorming session with the user (branch `migration/nextjs-frontend`). Architectural on every count: a new project (the Next.js app), a wholesale framework swap, and eventual deletion of the existing Angular codebase.

## Context

The Angular frontend (17 non-test `.ts` files: `Auth`/`Theme` core services, an auth guard/interceptor, 5 feature components — login, register, consultation-chat, debates-list, debate-thread — and their data-layer services) is real, working, and just gained a dual-brand/light-dark theme system (ADR 0011 Phase 1). Separately, ADR 0011's Phases 2-5 (Home dashboard, Human Review, Notifications) are designed but not yet built.

The user's actual motivation isn't a specific Angular limitation — it's consolidation: rather than splitting learning effort across two frontend frameworks (having started with Angular, per this project's original architecture choice, but not gotten to full fluency in it), they want to commit to one framework and go deep. That reframes the migration's success criterion: idiomatic, thorough use of Next.js's own patterns matters more here than a fast mechanical port, matching this project's existing precedent of using itself as a deliberate vehicle to learn real patterns hands-on (Temporal, LangGraph, microservices) rather than shipping the fastest possible version.

## Decision 1 — Next.js App Router, not Pages Router

Verified against current Next.js docs (v16.2.9, context7 — not memory, given this project's training-data cutoff predates this major version): `create-next-app`'s own recommended defaults are App Router + TypeScript + Tailwind CSS + ESLint, and the Pages Router docs themselves say "it is recommended to migrate to the App Router to leverage React's latest features." Not a close call — App Router is the current, actively-developed default; Pages Router is legacy-maintained.

## Decision 2 — Tailwind CSS, not a ported version of the existing token system

ADR 0011 just built a real dual-brand (Citrus/Electric) × light/dark CSS custom-property token system, verified for WCAG contrast in all 4 combinations. Porting it verbatim (framework-agnostic CSS, would have worked with zero rework) was the lower-cost option and the assistant's recommendation — the user explicitly chose Tailwind instead, since adopting it is itself part of the consolidation goal (Next.js's own scaffold default, worth learning alongside the framework). Consequence: the theme system gets *rebuilt* in Tailwind's theming approach (Phase 1 below), not ported — real, accepted rework, same category of deliberate cost ADR 0011 itself already took on for the token count doubling.

## Decision 3 — Coexistence: side-by-side dev servers, no reverse proxy

Both apps run on their own ports throughout the migration; whichever has the feature you need is the one you use day to day. No shared-origin routing infrastructure (nginx/reverse proxy) — that solves a problem real production traffic mid-migration has, which a solo-dev learning project doesn't. The Angular app is deleted only once every phase below is ported and verified (Phase 7) — until then it keeps running unmodified, a working reference to migrate *from*, not alongside a broken intermediate state.

## Decision 4 — ADR 0011's Phases 2-5 fold into this migration, not built in Angular first

Home dashboard, Human Review, and Notifications are designed (ADR 0011, spec 0032) but unbuilt. Building them in Angular now only to re-port them to Next.js immediately after would be double work with no learning benefit — they become phases of *this* migration instead, using ADR 0011's already-approved IA/design decisions verbatim (dashboard bucketing logic, Human Review's placement under the verdict, Notifications' bell+drawer+archive shape). The `redesign/product-shell-multi-theme` branch's scope shrinks to Phase 1 only (already merged, done) — its remaining phases are superseded by this ADR's Phases 5/6 below, not abandoned.

## Sequencing

Seven phases, each its own spec written just before it starts (not all up front) — matching this project's established one-spec-per-milestone discipline and the user's explicit "small specs, not one big spec" instruction:

1. **Scaffold + theme + auth** — `create-next-app`, the Tailwind theme rebuild, login/register + the JWT-cookie/CSRF flow. No realtime yet — the smallest slice that proves real backend integration.
2. **Home dashboard + My debates list** — two read-only, no-realtime screens (ADR 0011's dashboard IA, spec 0027's list equivalent).
3. **Consultation chat** — SSE step-indicator stream + the turn request/response flow. First realtime pattern, simpler than WebSocket.
4. **Debate thread** — WebSocket token streaming, the opening/verdict/argument swap-gap logic (specs 0013-0029's accumulated behavior), Minimal/Detail view. The largest phase; likely splits into its own two specs (static rendering, then live streaming) once scoped in detail.
5. **Human Review** — frontend panel + the backend endpoint (`POST /api/debates/{id}/review/`, not built yet).
6. **Notifications** — bell/drawer/archive + backend endpoints (also not built yet).
7. **Cutover** — delete the Angular app, update docs/deployment.

## What this doesn't cover

Any change to the Django/FastAPI backend beyond what Phases 5/6 already need for their own reasons (Human Review, Notifications endpoints) — the REST/WS/SSE contracts Next.js consumes are unchanged from what Angular already consumes today. Any redesign of app *behavior* beyond what ADR 0011 already decided — this is a framework/tooling migration, not a fresh product redesign.
