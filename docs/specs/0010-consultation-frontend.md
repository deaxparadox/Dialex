# Spec 0010 — Consultation frontend: case-type picker, chat, approve

> No new ADR — applies already-decided patterns (Angular `@Service()`/signals per ADR 0001, the consultation API contract per ADR 0005/spec 0009), not a new architecture decision. Follow-up to spec 0009, same split as 0005→0006 for debates.

## What's being built

A real, logged-in user can pick a case type, negotiate a case with the AI consultant through a normal chat UI, and approve it — landing on the resulting debate's page (`/debates/:id`, spec 0008). This is the first frontend surface that lets a user create their own case; everything before this was admin-seeded or curl-tested.

## One small backend gap this spec fills: a case-type list endpoint

Nothing today exposes the list of valid `case_type` values to a client — `docs/API.md`'s `GET /api/case-type-configs/` was sketched but never built. Needed for the picker; kept minimal (just `type`, not `position_options`/`decision_options`/`research_guardrail_prompt`, which no UI needs yet):

- `apps/cases/serializers.py` — `CaseTypeConfigSerializer` (`type` only).
- `apps/cases/views.py` — `CaseTypeConfigListView` (`generics.ListAPIView`, **not** ownership-scoped — this is shared config, not user data, same reasoning as `/api/personas/`'s existing plan).
- `apps/cases/urls.py` → `/api/case-type-configs/`.

## Frontend

### `features/consultation/data/consultations-api.ts` (new)

Same shape as `debates-api.ts` — a thin `@Service()` wrapping `HttpClient`, Django calls via `djangoApiBase`, orchestrator calls via `orchestratorApiBase` (auth already attached by the existing interceptor):

```ts
getCaseTypes(): Promise<{ type: string }[]>                                  // Django
startConsultation(caseType: string): Promise<{ session_id: number }>         // orchestrator
sendMessage(sessionId: number, text: string): Promise<{ message: string; ready_to_finalize: boolean }>  // orchestrator
approve(sessionId: number): Promise<{ case_id: number; debate_id: number }>  // orchestrator
```

### `features/consultation/consultation-chat/consultation-chat.ts/.html/.css` (new)

Signals: `caseTypes`, `selectedCaseType`, `sessionId` (null until started), `messages` (`{speaker: 'user' | 'consultant', content: string}[]`, accumulated client-side — no `GET` endpoint for turn history exists (spec 0009 explicitly left this out), so **a page reload loses the in-progress conversation**, same as decision 10's UI not existing until now; flagged here, not silently accepted), `draftText`, `readyToFinalize`, `sending`, `approving`, `error`.

Two-phase template, `@if (sessionId(); as id) { ...chat... } @else { ...picker... }`:
- **Picker phase**: loads `getCaseTypes()` on init, a `<select>` bound to `selectedCaseType`, "Start consultation" button → `startConsultation()` → sets `sessionId`, seeds `messages` empty.
- **Chat phase**: scrollable message list (user/consultant rows, minimal design pass reusing `--page`/`--ground`/`--ink`/`--ink-muted` tokens, no new palette — same call as spec 0006 made for login/register), a text input + send button (disabled while `sending()`), and an "Approve" button — **disabled unless `readyToFinalize()` is true**, since the backend already enforces this (spec 0009's `400` on approve-before-ready) and a disabled button is a better UX signal than letting the user hit that error. On send: append the user message optimistically, call `sendMessage`, append the consultant's reply, set `readyToFinalize` from the response. On approve: call `approve()`, then `router.navigate(['/debates', result.debate_id], { replaceUrl: true })` — `replaceUrl` matches the established post-action-navigation pattern (spec 0007's bug/fix), since a back-press into a finished consultation would just hit a `409` anyway.
- **Error handling**: a `409` from `sendMessage` (session already approved/failed — shouldn't happen through normal UI flow, but the backend is the source of truth) shows a clear inline message rather than a raw error; same for any unexpected failure.

### Routing (`app.routes.ts`)

New route: `{ path: 'consultation', component: ConsultationChat, canActivate: [authGuard] }`. No change to bare `/` (still `DebateThread`'s empty state, spec 0008) — this is an additive entry point, not a replacement.

### Nav entry (`app.html`/`app.ts`)

The topbar currently has only a "Log out" button. Adds a "New case" link to `/consultation`, next to it — the only way in besides typing the URL directly, matching the existing "no list/browse screen, a direct way in is enough for now" pattern already accepted for debates (spec 0008).

## Explicitly out of scope

Recovering an in-progress conversation after a page reload (no `GET` turn-history endpoint exists — a real, separate follow-up if this turns out to matter in practice). Editing a proposed payload before approving (spec 0009: approval uses it verbatim). Live token streaming (deferred, ADR 0005 decision 3 — replies arrive whole, same as spec 0009's curl verification showed). A "my consultations" list screen (same category of gap as "browse my debates," still not designed).

## Verification plan

- Real browser (Canary): log in, click "New case," pick a case type, send an opening message, confirm the consultant's reply renders; continue the conversation until `ready_to_finalize` flips true (confirm the Approve button enables exactly then, not before); click Approve; confirm navigation lands on `/debates/{new id}` showing the real, freshly-created debate (case/status/participants matching what the consultation actually produced).
- Confirm the send button disables while a reply is pending (no double-submit), and the message list renders both sides distinctly.
- Attempt to send a message on a session that's already approved (e.g., two browser tabs racing) — confirm a clean inline error, not a silent failure or a raw exception in the console.
- Confirm `GET /api/case-type-configs/` returns the real configured types and requires auth like every other endpoint.

## Verified in a real browser (Canary)

Full flow: login → "New case" → picker (both case types listed, `loan_approval` pre-selected) → "Start consultation" → chat view with Send/Approve (Approve correctly disabled) → a genuine multi-turn negotiation (5 real OpenAI round trips — more than the 1-3 originally guessed, but that's the consultant's own conversational persistence, not an app defect) → Approve enabled exactly when `ready_to_finalize` flipped true → click Approve → `POST .../approve` (200) → navigated to `/debates/9` → real case/status/strategy/round data rendered, matching the just-discussed case. Zero console errors, zero failed/unexpected network requests, zero app-level bugs found — the first milestone this session with a clean result rather than a caught bug, noted honestly rather than papering over the streak.

## Branch

Continuing on `main`.

## Status

Implemented and verified end to end in a real browser. No bugs found or fixed this pass — Django's/Angular's existing test suites still pass unmodified (8 Django tests, 15 Angular tests across 10 files).
