# Spec 0037 — Next.js Phase 4a: debate thread, static render

Splits Phase 4 of ADR 0012 / spec 0033 into two sub-specs, per spec 0033's own anticipation ("likely splits into its own two specs... static rendering of a finished debate first, live streaming second"). This spec is the first half: render a debate's already-persisted state correctly, with no realtime. Branch `migration/nextjs-frontend`.

## Root cause / current state, verified directly (not assumed)

- `frontend/src/app/features/debate/debate-thread/{debate-thread.ts,.html,.css}` (642 combined lines, read in full) is this project's most complex frontend component — the accumulated, verified behavior of specs 0013-0029. Splitting what it does into "static" vs. "live" pieces, verified against the actual code (not guessed from memory):
  - **Static** (this spec): `loading`/`notFound` states; the header card (case type/status/strategy/round/judge, the Minimal/Detail mode toggle — itself already a behavioral no-op today, per the code's own comment: "there's no more reading-panel for 'detail' to open... currently a no-op, reserved for a future definition"); the opening statement block (rendered once `d.opening_statement` is non-null); per-round argument bubbles (left/right by first-seen agent order, avatar initials, per-agent color slots, the position/confidence meta line, the "Responds to X, round N" citation line); the verdict block (once `d.verdict` is non-null); the "Start debate" button (visible when `status === 'OPEN'`, calls `POST /api/debates/{id}/start`, then a single refetch — no live follow-up).
  - **Live** (Phase 4b, separate spec): the WebSocket connection (`DebateStream`/`WS /api/debates/{id}/stream`), `generatingTurn`/`streamingText` state, every "X is thinking…"/"X is preparing…" branch, `turn_started`/`turn_token`/`turn_token_reset` handling, the polling fallback, and the three reconnect-mid-generation branches (opening statement, argument, verdict) that exist specifically to handle a page load that missed a live event Redis can't replay.
- `mapArgument`/`fillRespondsToLabels` (plain functions, no Angular-specific behavior): map `ApiArgument` → a display shape with 1-indexed rounds and a resolved "responds to" label; port directly.
- `agentOrder`/`isLeft`/`agentSlot`: stable first-seen-agentId ordering (index 0 = left/color-a, else right/color-b) — a plain derived computation from the arguments array, no live-state dependency in the static case (the live version also seeds from `generatingTurn`, which doesn't exist yet here).
- Query-param-driven `mode` (Minimal/Detail, spec 0007): read on load, written back via `replaceUrl`-equivalent (`router.replace`, not `router.push`) on toggle — a plain, already-decided UX behavior, not realtime, in scope for this spec.
- Route: `/debates/{id}` — dynamic segment, doesn't exist yet in `frontend-next/` (Phase 2's rows link to it, correctly 404ing until now).
- `debate-thread.css` (368 lines, read in full) — full visual spec for bubbles/avatars/round dividers/verdict block; ported as Tailwind utilities, not redesigned (same standing as every prior phase).

## Fix

### 1. Shared model helpers

`frontend-next/src/lib/debate-thread-model.ts` — `DebateArgument` interface, `mapArgument`, `fillRespondsToLabels`, `initialFor` ported as plain functions (byte-for-byte logic, no framework-specific translation needed).

### 2. `(protected)/debates/[id]/page.tsx`

Fetches `getDebate(id)` + `getArguments(id)` + (once) `getCase(debate.case_id)` on mount — a plain one-shot load, no live refresh in this spec. Renders: loading/not-found states; the header card with mode toggle (`useSearchParams`/`router.replace` for the query param, matching the existing UX exactly); the opening statement block (present/absent only — no "generating" branch, since that needs `generatingTurn`); round-grouped argument bubbles via the same `agentOrder`/`isLeft`/`agentSlot`/`colorFor` logic; the verdict block (present/absent only); the "Start debate" button when `status === 'OPEN'`, calling the orchestrator's start endpoint then a single refetch (no WS, no polling — a manual page reload is the only way to see further progress until Phase 4b).

### 3. Data layer additions

`useDebatesApi()` (spec 0035) already has `getDebate`/`listDebates`/`listCases` — add `getArguments(id)` and `getCase(id)`, and a `startDebate(id)` hitting the orchestrator (`useApiFetch(config.orchestratorApiBase)`, same pattern spec 0036 established for consultations).

## Explicitly out of scope

Everything listed under "Live" above — the WebSocket connection, `generatingTurn`/`streamingText`, every thinking/reconnect branch, the polling fallback. All of it is Phase 4b, a separate spec, started immediately after this one closes (not a general future item). Human Review, notifications — Phases 5-6.

## Verification plan

Real browser: start a genuine debate via a direct orchestrator API call (or through the just-built `/consultation` flow) and let it run to `JUDGED` server-side before ever loading the Next.js page — this spec has no live-follow, so the verification must supply already-complete data, not rely on watching it progress. Confirm the loaded page renders: correct opening statement text, every argument bubble on the correct side with the correct color/avatar/position/confidence/citation line, the verdict block, `status_display`/humanized case type in the header. Confirm the Minimal/Detail toggle updates the URL query param and survives a reload. Confirm a debate still `OPEN` shows "Start debate," clicking it starts the workflow and the one-shot refetch reflects whatever state it's reached by then (still `OPEN` or already `ARGUING` — both acceptable, no live-follow expected yet). Confirm a not-owned/nonexistent debate id renders the not-found state, not a crash. Confirm `frontend/` unaffected, its own tests still pass.

## Branch

`migration/nextjs-frontend` (continuing).
