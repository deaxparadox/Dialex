# Spec 0017 — Render the opening statement, and show a loading state before it exists

> No new ADR — presentation-layer only, same `ApiDebate.opening_statement` field already fetched (never previously rendered), no backend/schema change.

## Root cause, verified against a real run (not assumed)

Debate 23 (2026-07-30): workflow started 14:47:15.034; `opening statement persisted` (orchestrator-worker log) at 14:47:36.212 — a 21-second single LLM call (`graphs.py`'s judge/moderator opening-statement node) with nothing to show for it, since `Debate.opening_statement` is fetched (`ApiDebate.opening_statement`) but has never been rendered by `debate-thread.html`. The first actual `Argument` didn't land until 14:47:39.889. During that whole 24-second stretch, the thread panel showed nothing but a static "No arguments yet." — the WebSocket pipeline itself was confirmed working correctly the entire time (status/argument events all pushed within single-digit milliseconds of their DB writes), so this isn't a streaming bug; it's a content/feedback gap spec 0016 explicitly flagged as "pre-existing, not touched" and under-weighted at the time.

## What's being built

1. **Render the opening statement** as the thread's first entry, once `d.opening_statement` exists — real content, ~21s sooner than the first argument, authored by the judge/moderator persona per `graphs.py`'s actual prompt ("Give your opening statement as judge/moderator..."), so it's labeled with `d.judge_persona.name`, not a participant.
2. **A loading indicator** — reusing the exact typing-dots pattern already established in `consultation-chat.ts`/`.css` (three staggered bouncing dots, `@keyframes typing-bounce`), shown while the debate `isActive()` and neither the opening statement nor any argument exists yet. Same visual language the user already knows from the consultation flow, not a new pattern.

Priority in the template (`debate-thread.html`, before the round-dividers loop):
- If `d.opening_statement` exists → render it (regardless of active/finished — it's real content, always show it once it exists).
- Else if `isActive()` → show the "Generating opening statement…" loading indicator.
- Else (not active, no opening statement — e.g. still `OPEN`/not started, or `FAILED` before anything generated) → keep today's plain "No arguments yet." text.

## `debate-thread.html`

```html
@if (d.opening_statement) {
  <div class="opening-entry">
    <div class="opening-head">Opening Statement &middot; {{ d.judge_persona.name }}</div>
    <p class="opening-text">{{ d.opening_statement }}</p>
  </div>
} @else if (isActive()) {
  <div class="thinking-row">
    <span class="thinking-label">Generating opening statement&hellip;</span>
    <span class="typing-indicator"><span></span><span></span><span></span></span>
  </div>
} @else if (arguments().length === 0) {
  <p class="reading-empty">No arguments yet.</p>
}
```
(Round dividers/bubbles/verdict block unchanged, follow immediately after.)

## `debate-thread.css`

`.opening-entry`/`.opening-head`/`.opening-text` — same treatment as `.verdict-entry`/`.verdict-head`/`.verdict-reasoning` (a plain block, not a left/right bubble, since it isn't from either debating agent). `.thinking-row`/`.typing-indicator`/`.typing-indicator span`/`@keyframes typing-bounce` — the same small, already-proven pattern copied from `consultation-chat.css` (component styles are scoped per-component in this codebase, so this is a duplication of a known-good ~15-line pattern, not a new design).

## Explicitly out of scope

`Debate.closing_summary` — also fetched, also never rendered, but not implicated in this bug (it doesn't sit in a silent multi-second gap the way the opening statement does — the verdict already renders as soon as it's ready). Any change to the 21-second opening-statement LLM call itself (e.g. making it faster, streaming it token-by-token) — ADR 0006 already covers why token-by-token isn't feasible with the current structured-output call shape; this spec only makes the existing wait visible, not shorter.

## Verification plan

- Real browser (Canary): start a debate, confirm the loading indicator appears immediately (not a blank/static panel) while the opening statement is generating, then confirm the opening statement itself renders (labeled with the judge's name) before Round 1's bubbles appear, with no dead-silent gap anywhere in the sequence.
- Confirm the pre-start (`status === 'OPEN'`) empty state is unchanged — still plain "No arguments yet.", no loading indicator (nothing is running yet).
- Re-run `npx ng test`.

## Branch

Continuing on `main`.

## Found during implementation/verification

Real-browser verification caught a real regression in the first implementation: the loading-indicator condition was gated on `isActive()`, which deliberately includes `OPEN` (added in an earlier spec so the WS stream opens immediately, before the backend has necessarily left `OPEN`) — so the new "Generating opening statement…" indicator incorrectly appeared before "Start debate" was even clicked, contradicting this spec's own stated requirement. Fixed with `isActive() && d.status !== 'OPEN'` and re-verified with explicit DOM assertions (no loading-indicator element mounted pre-start; plain "No arguments yet." confirmed as the only content) — not just a visual glance.

## Status

Implemented and verified in a real browser end to end (pre-start state, the generating phase, opening-statement rendering, full round/verdict playthrough). One regression found and fixed within the same pass (see above), re-verified clean. 18 Angular tests pass.
