# Spec 0038 — Next.js Phase 4b: debate thread, live streaming

Second half of Phase 4 (ADR 0012/spec 0033), following spec 0037's static render. Branch `migration/nextjs-frontend`.

## Root cause / current state, verified directly (not assumed)

Full mechanism re-read from `frontend/src/app/features/debate/debate-thread/debate-thread.ts` + `data/debate-stream.ts` (the exact logic this spec ports, not summarized from memory):

- `DebateStream`: opens `WS /api/debates/{id}/stream` with the access token as the sole WS subprotocol (browsers can't set custom headers on a WS handshake), parses each message as JSON, calls `onMessage`; calls `onUnexpectedClose` only if the close wasn't clean (`!event.wasClean`) — a deliberate close (component teardown) sets `onclose = null` first so it never fires the fallback.
- Event handling (`openStream`'s callback): `turn_started` → reset `streamingText`, set `generatingTurn`. `turn_token` → append to `streamingText`. `turn_token_reset` → clear `streamingText` (a Temporal-level retry silently re-entered the node). Any other event type (`argument_complete`/`status_change`/`opening_statement_complete`) means "something persisted, go re-fetch" — **not** an immediate `generatingTurn` clear (spec 0029's fix): capture the current `generatingTurn` value, call `loadDebate()`, and only null `generatingTurn` in the `.then()` if it still holds that exact same captured value — guards against the next turn's `turn_started` already having arrived while the refetch was in flight (the backend graph is fully sequential, but network/render timing isn't).
- `isActive` (`OPEN`/`ARGUING`/`CONVERGING`) gates whether the stream opens at all — `loadDebate()` opens it if active, closes it + stops polling if not (a debate that's already `JUDGED`/`NO_CONSENSUS`/`FAILED` needs neither).
- Polling (`setInterval`, 4000ms) is a fallback only, started when the WS can't open (no access token — shouldn't happen, route is already guarded) or drops uncleanly; never the primary path.
- Three "reconnect mid-generation" template branches exist because Redis pub/sub has no replay (ADR 0006 decision 4) — a fresh page load after a `turn_started` already fired server-side sees `generatingTurn === null` even though generation is actively happening:
  - Opening statement: `isActive() && status !== 'OPEN'` (excludes `OPEN` specifically — a debate that hasn't started yet has no opening statement in flight) → its own thinking bubble, showing `streamingText()` if any has arrived since page load, else dots.
  - Argument: no dedicated reconnect branch exists — `roundsToRender` (real rounds + the in-progress round, derived from `generatingTurn`) already covers the common case, and a genuine argument-mid-flight reconnect just shows nothing extra until the next real event arrives (verified: this gap is accepted as-is in the current Angular code, not something to newly invent here).
  - Verdict: `!verdict && status !== 'OPEN' && arguments.length >= max_rounds * 2` (every debate has exactly 2 participants, so this arithmetic reliably means "all argument rounds are done, verdict must be next") → its own thinking bubble, **never** showing `streamingText()` (spec 0029's second fix — at this branch's render point `generatingTurn` is still null, so any `streamingText()` present could only be stale leftover from the just-finished last argument, not real verdict content; showing it produced a one-frame stale-text flash).
- `roundsToRender` = real round numbers ∪ `{generatingTurn.roundNumber + 1}` when `generatingTurn.stage === 'argument'` — so the very first turn of a new round has a divider to render its thinking bubble under before any real argument in that round exists.
- `agentOrder` (spec 0037's `agentOrderOf`) also seeds from a live `generatingTurn.agentPersonaId` when its stage is `'argument'` — the very first "thinking" bubble of a debate, before any real argument exists, still needs a stable side to render on.
- Auto-scroll: an effect re-pins `scrollTop = scrollHeight` on every change to arguments/generatingTurn/streamingText — the exact mechanism spec 0029 fixed a flicker in by *not* clearing `generatingTurn` too early (already ported into the event-handling logic above, not a separate concern).

## Fix

### 1. `frontend-next/src/lib/debate-stream.ts`

`useDebateStream()` hook wrapping the native `WebSocket` (no library — browser API, framework-agnostic): `connect(debateId, accessToken, onMessage, onUnexpectedClose)` / `disconnect()`, same subprotocol-auth and clean-vs-unclean-close handling as the Angular original. `DebateStreamEvent` union type ported verbatim.

### 2. State machine in `(protected)/debates/[id]/page.tsx`

Adds to spec 0037's static page: `generatingTurn`/`streamingText` state, a `streamingRef`/closure-safe capture for the "only clear if still the same turn" guard (React state closures need the functional-update form, `setGeneratingTurn((current) => ...)`, to read the latest value inside the async `loadDebate().then()` callback — the direct behavioral equivalent of Angular's signal read, not a new mechanism). `roundsToRender`/`openingGeneratingTurn`/`agentOrder` (extended) become plain derived `const`s computed each render from state, same as spec 0037's already-established pattern — no `useMemo` needed at this data scale, consistent with this codebase's existing no-premature-optimization stance.

Wire the stream open/close into the existing `loadDebate` effect: open when `isActive`, close + stop any polling otherwise; teardown (`useEffect`'s cleanup) always closes the stream and stops polling, mirroring `destroyRef.onDestroy`.

### 3. Template branches

Port all three reconnect branches, the per-round thinking bubble, and the verdict thinking bubble exactly as scoped above (including the deliberate never-show-`streamingText`-in-the-verdict-reconnect-branch rule) — this is the one place fidelity matters most, since it's specifically the swap-gap behavior spec 0029 already fixed once and regressing it here would be a real, user-visible bug repeat.

### 4. Typing-indicator CSS

Port `.typing-indicator`'s 3-dot bounce (`debate-thread.css`) into `globals.css` as a plain `@keyframes typing-bounce` (same reasoning as spec 0036's `fade-in` addition) — this is a decided, existing visual, not up for redesign.

## Explicitly out of scope

Human Review, notifications — Phases 5-6. Any redesign of the swap-gap/reconnect logic beyond porting it as-is — this is existing, hard-won behavior (specs 0018/0019/0020/0021/0029), not a design decision open for revisiting.

## Verification plan

Real browser: start a genuine debate from `OPEN` through the Next.js page (not pre-seeded data, unlike spec 0037) and watch it run live end to end — confirm `turn_started` produces the correct "X is thinking…" bubble on the correct side before any content exists, token-by-token growth is visible for the opening statement/arguments/verdict, the swap from streaming to final content shows no blank gap or flicker (the exact regression spec 0029 fixed in Angular — re-verify it doesn't recur here), the verdict-reconnect branch never flashes stale argument text (reload the page mid-verdict-generation if timing allows, or reason from code inspection if a real mid-verdict reload can't be reliably timed). Confirm a WS drop falls back to polling (can be forced by closing the connection from devtools/a raw client). Confirm `frontend/` unaffected, its own tests still pass. This is the highest-risk phase in the whole migration — verification should not be a glance.

## Branch

`migration/nextjs-frontend` (continuing).
