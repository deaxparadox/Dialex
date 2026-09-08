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

## Found during implementation

Two real bugs, both CORS, both surfaced only once the orchestrator became reachable from `frontend-next/` for the first time (Phases 1/2 only ever hit Django):
- The orchestrator's own CORS allow-list (`orchestrator/app/core/config.py`'s `cors_allowed_origins`, a separate config from Django's, per its own existing code comment) only trusted `localhost:4200` — added `localhost:3000`, same category of gap spec 0034 already fixed on the Django side.
- Fixing the origin allow-list surfaced a second, distinct failure: `Access-Control-Allow-Credentials` missing on the orchestrator's response, because the frontend's shared `useApiFetch` (spec 0034) hardcoded `credentials: 'include'` on every call. Root-caused against the actual Angular code it was supposed to port: the real `auth-interceptor.ts` never sends credentials at all — only `Auth`'s own direct login/register/refresh/logout/csrf calls do, bypassing the interceptor entirely. `credentials: 'include'` was an unintended addition in spec 0034's port, harmless against Django (already configured for it) but broke every orchestrator call outright, since Bearer-only auth never needed cookies there and its CORS config correctly didn't allow them. Fixed by removing the hardcoded `credentials: 'include'` from `useApiFetch` — a caller that ever needs it (a future Django POST needing the CSRF cookie round-trip, e.g. Phase 5's Human Review submit) can still pass it via `init`.
- Restored `/debates`'s empty-state "Start your first case" link (dropped in spec 0035 since `/consultation` didn't exist yet) now that it does.

## Found during verification

Three real Canary sessions against the live stack (Django + orchestrator + Temporal + Redis, all real): the first caught the missing-origin CORS bug; the second, after that fix, caught the missing-credentials-flag bug (a different failure mode, root-caused by comparing against the actual `auth-interceptor.ts` source rather than guessing); the third, after both fixes, passed end to end — register → New case → pick `loan_approval` → a genuine multi-turn negotiation (premature "finalize now" correctly refused, citing the exact missing fields; finalized once all five required fields were actually present) → "Approve and start debate" → real navigation to `/debates/{id}` (a clean 404 there, expected — Phase 4 not built yet). Zero CORS errors on the final pass. Regression-checked: session survives reload, `/debates` still loads, `frontend/` (Angular) unaffected, 40/40 tests still pass.

One incidental, pre-existing observation, **not a bug this migration introduced** (same backend/prompt behavior an Angular consultation would hit today): the consultant asked for an exact numeric collateral value before finalizing even though `collateral`'s schema type is a free-form string (spec 0030: `"What secures the loan, if anything (or 'none')"`) — a qualitative answer ("a car worth more than the loan") wasn't accepted as sufficient. Orthogonal to this phase's frontend-only scope; noted in `TODO.md` as a low-priority follow-up, not fixed here.

## Status

Implemented and verified against the real running stack. Closes Phase 3 of ADR 0012/spec 0033. Phase 4 (debate thread) is next — the largest remaining phase; its own spec (0037+) to be written before it starts, likely splitting into two sub-specs (static rendering, then live streaming) once scoped in detail, per spec 0033's own anticipation.

## Branch

`migration/nextjs-frontend` (continuing).
