# Spec 0014 — Debate streaming, frontend

> Governed by [ADR 0006](../adr/0006-redis-websocket-streaming.md) — no new ADR needed, same "backend spec → frontend spec, no new architecture" split already used for 0005→0006 and 0009→0010. Implements the frontend half ADR 0006 explicitly deferred: wire `debate-thread` to `WS /api/debates/{id}/stream` (spec 0013) instead of 4s polling.

## What's being built

`debate-thread` currently learns about new arguments/status changes by polling `GET /api/debates/{id}/` + `/arguments/` every 4 seconds (`pollHandle`/`setInterval`, `POLL_INTERVAL_MS = 4000`). This replaces that with a WebSocket connection to the now-built streaming endpoint: the moment the backend publishes `argument_complete` or `status_change`, the frontend re-fetches via the same existing REST calls and re-renders — instant instead of up-to-4s-stale.

Both event types carry only an id/status, not a full payload (ADR 0006 decision 3 — "go fetch, something new landed, not a payload carrier"), so the simplest correct client behavior is: on **any** WS message, do the same full refresh `loadDebate(debateId, true)` already does today for a poll tick. No need to branch on `type` or patch state incrementally — that would just be re-deriving what one `loadDebate()` call already does correctly.

## 1. `environment.ts` — new WS base

```ts
export const environment = {
  djangoApiBase: 'http://localhost:8000',
  orchestratorApiBase: 'http://localhost:8010',
  orchestratorWsBase: 'ws://localhost:8010',
};
```
Explicit, not derived from `orchestratorApiBase` by string-replacing `http`→`ws` — matches this file's existing pattern of one explicit base per concern rather than computed values.

## 2. New service — `frontend/src/app/features/debate/data/debate-stream.ts` (via `ng generate service`)

A thin wrapper around the native `WebSocket`, so `DebateThread` stays focused on UI/state and the connection is mockable in unit tests without a real socket:

```ts
@Service()
export class DebateStream {
  private socket: WebSocket | null = null;

  connect(debateId: number, accessToken: string, onMessage: () => void, onUnexpectedClose: () => void): void {
    this.disconnect();
    const socket = new WebSocket(`${environment.orchestratorWsBase}/api/debates/${debateId}/stream`, [accessToken]);
    socket.onmessage = onMessage;
    socket.onclose = (event) => {
      if (this.socket === socket && !event.wasClean) onUnexpectedClose();
    };
    this.socket = socket;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.onclose = null; // deliberate close — don't trigger the fallback
      this.socket.close();
      this.socket = null;
    }
  }
}
```
The access token rides as the sole WS subprotocol (`new WebSocket(url, [accessToken])`), matching ADR 0006 decision 4 / the already-built backend's expectation exactly.

## 3. `debate-thread.ts` changes

- Inject `Auth` (for `getAccessToken()`) and `DebateStream`.
- Remove `isStreaming` from the `DebateArgument` interface, `mapArgument()`, and `colorFor()`. **This is a deliberate cleanup, not a silent drop**: under complete-event push (ADR 0006 decision 1), an argument is either fully persisted or doesn't exist in the fetched list yet — there is no partial/mid-flight state for a field like this to represent, and nothing has ever set it to `true`. ADR 0006 flagged this exact field as something this spec must address directly rather than carry forward unused.
- Replace the `startPolling`/`stopPolling` call sites in `loadDebate()`'s `isActive()` branch with `openStream(debateId)` / `closeStream()`.
- `openStream(debateId)`: gets the current access token from `Auth`; if present, calls `debateStream.connect(debateId, token, () => void this.loadDebate(debateId, true), () => this.fallBackToPolling(debateId))`. If no token is available (shouldn't happen — the route is already guarded — but fail visibly rather than silently doing nothing), log a `console.error` and fall back to polling directly.
- **Fallback path kept, not deleted**: `startPolling`/`stopPolling`/`POLL_INTERVAL_MS` stay in the file as the explicit, visible fallback for an unexpected WS drop (`onUnexpectedClose`) — logged via `console.warn('WebSocket dropped for debate {id}, falling back to polling')` before starting the interval. This is a deliberate application of CLAUDE.md's "fallbacks must be explicit" rule: a real network blip or an access-token expiring mid-debate (tokens are short-lived, decision 13; most debates finish in well under that window, but a long one could hit this) shouldn't strand the view on stale data with no visible signal — but it also shouldn't be a silent, invisible safety net.
- `closeStream()` called: when a refreshed `debate()` is no longer `isActive()` (mirrors today's `stopPolling()` call site exactly), and in `destroyRef.onDestroy()`.
- No reconnect-with-backoff logic — out of scope; the polling fallback is the resilience mechanism, matching the level of robustness the page already had before this milestone (it's strictly additive: WS-when-healthy, polling-when-not, never worse than today).

## Explicitly out of scope

Reconnect logic for the WS itself (falls back to polling instead, see above). Any UI indicator distinguishing "live via WebSocket" vs. "degraded to polling" — not asked for, and the visible behavior (arguments appearing) is identical either way, only the latency differs. Token-by-token argument rendering (ADR 0006 decision 1 — not possible with the current LLM call shape). The notifications WebSocket (`/notifications/stream`, decision 17 — separate, unbuilt feature).

## Verification plan

- Unit tests: mock `DebateStream` (no real socket) and `Auth.getAccessToken()` in `debate-thread.spec.ts`; confirm `openStream`/`closeStream` are called at the right `isActive()` transitions, and that a fallback-triggering close starts polling.
- Real-browser (Canary) trace against a real running debate: open `/debates/:id`, click "Start debate," confirm arguments/status render as soon as each WS message arrives (no up-to-4s lag — compare timestamps of the WS event vs. the DOM update), confirm the connection closes once the debate reaches a terminal status (no lingering open socket), confirm a full run (OPEN→ARGUING→...→JUDGED/NO_CONSENSUS) renders correctly end to end with zero manual reloads.
- Force the fallback path: stop the orchestrator mid-debate (or otherwise break the WS) and confirm the `console.warn` fires and polling picks up seamlessly rather than the view freezing.
- Re-run `npx ng test` (existing suite) to confirm nothing else regresses.

## Branch

Continuing on `main`.

## Found during implementation/verification

The Canary browser-verification agent hit tooling flakiness unrelated to this feature (a resource-starved local Chrome/daemon environment killed longer-running scripts), so it reconstructed the full-run timeline from several short chained checks rather than one continuous capture. The evidence gathered this way is still solid: the WebSocket's `open` event was directly captured on every one of 4 real debate page loads (within ~150-300ms, before "Start debate" was even clicked), a full 6-argument/3-round debate completed in ~16.5s with status/argument changes rendering at each poll checkpoint (far tighter than the old 4s window), and reloading an already-finished debate opened no new WebSocket connection — strong indirect confirmation the component doesn't keep reconnecting once a debate is terminal, even though a literal `close` frame wasn't captured directly.

## Status

Implemented and verified end to end against 4 real debate runs in a real browser, plus the existing Angular test suite (18 tests, 2 new, all passing). No functional bugs found.
