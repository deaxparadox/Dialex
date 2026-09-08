# Spec 0036 — Next.js Phase 3: consultation chat

Implements Phase 3 of ADR 0012 / spec 0033. Branch `migration/nextjs-frontend`.

## Root cause / current state, verified directly (not assumed)

- `frontend/src/app/features/consultation/{consultation-chat/*,data/consultations-api.ts,data/consultation-step-stream.ts}` (read in full): a two-mode screen — a case-type picker (`GET /api/case-type-configs/`, Django) when no session exists yet, then a chat transcript once one does. `startConsultation` → `POST /api/consultations/` (orchestrator, `{case_type}` → `{session_id}`). `sendMessage` → `POST /api/consultations/{id}/messages` (`{text}` → `{message, ready_to_finalize}`), opened **before** that POST fires: a separate SSE connection (`GET /api/consultations/{id}/stream`) relaying `{"step": "draft"|"critique"|"revise"}` — a live "what's happening" nudge only, aborted the instant the POST resolves (its own resolution is the real completion signal, not a step event). `approve` → `POST /api/consultations/{id}/approve` (`{}` → `{case_id, debate_id}`), then navigates to `/debates/{debate_id}`.
- `ConsultationStepStream.run()`: plain `fetch` + manual SSE-frame parsing (not the browser's `EventSource`, which can't set an `Authorization` header) — frames separated by `\n\n`, each frame's `data:` line is JSON.
- 409 from `sendMessage`/`approve` means the session is already approved/failed — surfaced as a specific message, not the generic fallback.
- Visual behavior (`consultation-chat.css`, spec 0024): while a turn is in flight, a "Consultant" bubble shows a spinner + a step label (`Thinking…`/`Double-checking…`/`Revising…`) that smoothly resizes and cross-fades as the label changes underneath it, via a JS-measured pixel width plus a CSS 3D flip-in on the label. **Simplified for this port** (disclosed, not silent): the same observable behavior — a spinner, a changing label, some transition between labels — is kept, but implemented as a plain CSS `width: fit-content` bubble with a fade/scale transition keyed by the current step (React re-mounts the label span on step change), not a hand-measured pixel-width animation. This is an implementation-detail simplification of a decided micro-interaction, not a scope cut of the interaction itself — ADR 0012/spec 0033 explicitly migrate existing behavior, not redesign it, and the exact JS-measurement mechanism is Angular-`afterRenderEffect`-specific plumbing with no direct port, not a design decision worth preserving pixel-for-pixel.
- `GET /api/case-type-configs/` (Django, verified against `docs/API.md`) returns `{type}` only per row — `humanizeSlug` (already ported, spec 0035) is what turns `loan_approval` into a real label client-side, same as Angular does.
- No `/consultation` route exists yet in `frontend-next/` — Phase 1/2 built auth and the debate list/dashboard only.

## Fix

### 1. Data layer

`frontend-next/src/lib/consultations-api.ts` — `ApiCaseType`/`StartConsultationResponse`/`SubmitMessageResponse`/`ApproveConsultationResponse` ported field-for-field, plus a `useConsultationsApi()` hook (`getCaseTypes`, `startConsultation`, `sendMessage`, `approve`) built on `useApiFetch`. Note: `getCaseTypes` hits Django, the other three hit the orchestrator — `useApiFetch` already parameterizes only the path, not the base URL, so this needs a second base-URL constant (`config.orchestratorApiBase`, added to `lib/config.ts` alongside the existing `djangoApiBase`) and a thin per-base variant, not a new fetch mechanism.

`frontend-next/src/lib/consultation-step-stream.ts` — a `useConsultationStepStream()` hook wrapping the same `fetch` + manual SSE-frame-parsing loop, parameterized by the access token (read from `useAuth()`) exactly like the orchestrator call above needs it. Ported logic byte-for-byte (frame-splitting on `\n\n`, `data:` line parsing) — this part has no framework-specific shape to translate.

### 2. `(protected)/consultation/page.tsx`

Same two-mode screen: a picker (case-type `<select>`, humanized options, "Start consultation") when no session exists, then the chat transcript once `startConsultation` returns a `session_id`. Message list, composer (input + Send, Enter-to-send), the pending/thinking indicator (spinner + step label, simplified transition per above), the 409-aware error message, and the "Approve and start debate" button gated on `ready_to_finalize`, navigating to `/debates/{debate_id}` via `router.replace()` on success (same `replaceUrl: true` reasoning as Angular's version — this screen shouldn't sit in back-history underneath a live debate).

### 3. Nav

Add a "New case" link to `(protected)/layout.tsx`'s nav (pointing at `/consultation`) — the first time this exists, since Phase 2 deliberately dropped the dead-link version of this same CTA. Still not ADR 0011's full utility cluster (theme picker, notification bell) — those stay deferred.

## Explicitly out of scope

Debate thread, Human Review, notifications — Phases 4-6. Any backend/orchestrator contract change (this phase consumes exactly what `frontend/` already consumes). Redesigning the thinking-indicator's exact animation mechanism beyond the disclosed simplification above.

## Verification plan

Real browser, backend + orchestrator running: pick a case type, start a consultation, send a genuine multi-turn message exchange for `loan_approval` (enough to exercise the required-fields enforcement from spec 0030 — confirm a premature "finalize now" is correctly refused, then confirm it succeeds once all fields are present), confirm the step label visibly changes during at least one turn that triggers critique/revise (a real reflection round, not just "draft"), confirm `ready_to_finalize`/the approve button's enabled state track the real API response, click approve and confirm landing on the real `/debates/{id}` (which will still 404 until Phase 4 — expected, same as Phase 2's row-click check). Confirm a `research_debate` consultation still finalizes with a genuinely free-form payload (regression check against spec 0030's schema-enforcement branching). Confirm `frontend/` unaffected, its own tests still pass.

## Branch

`migration/nextjs-frontend` (continuing).
