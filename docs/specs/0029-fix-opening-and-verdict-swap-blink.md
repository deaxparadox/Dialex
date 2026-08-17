# Spec 0029 — Fix the streaming-to-final swap gap (argument scroll-flicker, opening-statement/verdict blink)

No ADR — a state-timing fix within an existing, already-established mechanism (the streaming-to-final swap, spec 0021), not a new pattern.

## Root cause (found via systematic debugging, confirmed with real DOM/scroll capture on live debates — not guessed)

Three symptoms, logged separately (one by the user, two by re-verification of an older bug), all traced to the **same root cause**: `debate-thread.ts`'s WS handler (`openStream`) clears `generatingTurn` to `null` **synchronously** the instant a turn's completion event arrives (`debate-thread.ts:293`), while the real data refetch (`loadDebate()`, line 294) is **async**. For a real (confirmed, measured) window between those two points, the UI has already discarded the "in-progress" state but doesn't yet have the "final" state to replace it with:

1. **Argument bubbles — user-reported scroll flicker.** The per-round "thinking" bubble (`debate-thread.html:117-130`) is a sibling element appended after the round's real-argument `@for` loop, not an `@else` alternative to it. Confirmed via real scroll/DOM polling (~25-35ms samples, gap-free, 2 argument turns on a live debate): the instant `generatingTurn` clears, the thinking bubble is removed — `bubble-row` count and `scrollHeight` both measurably dip (e.g. 3→2 rows, `sH` 895→702) — then, once `loadDebate()`'s refetch lands (often nearly simultaneously with the *next* turn's `turn_started`, since the backend graph is fully sequential), the count/height jump back up, frequently **past** the pre-dip value (e.g. 2→4 rows, not 2→3) because the next turn's own thinking bubble arrives in the same instant. The auto-scroll effect (`debate-thread.ts:187-193`) unconditionally re-pins `scrollTop = scrollHeight` on every one of these changes, so the visible thread panel dips then overshoots — the "scroll goes up a little, then flickers" the user described.
2. **Opening statement — avatar blinks, text stays visible** (previously logged, re-investigated here): a 3rd template branch (`debate-thread.html:62`, `isActive() && d.status !== 'OPEN'`) is specifically built to keep `streamingText()` visible during this same gap, but has no avatar/header markup at all. Measured ≤41ms both times on 2 fresh debates.
3. **Verdict — whole block blinks, worse than opening statement** (previously logged, re-investigated here): no equivalent 3rd branch exists at all, so *neither* branch matches during the gap — avatar **and** reasoning text both disappear for ~41ms.

## Fix — close the gap at the source, not per-symptom

**Primary fix**: don't clear `generatingTurn` until the refetch that will replace it has actually landed. This removes the gap itself rather than patching each place it becomes visible — for arguments, the thinking bubble never disappears before the real bubble is ready (no dip, no overshoot, no scroll flicker); for opening statement and verdict, their existing "thinking" branches (which already have full avatar+content markup) simply keep matching and rendering throughout, so the completion-event race no longer reaches either fallback gap at all.

`debate-thread.ts`, the WS handler's completion branch (`:279-295`):
```ts
} else {
  const completingTurn = this.generatingTurn();
  void this.loadDebate(debateId).then(() => {
    // Only clear if nothing newer already replaced it — the backend graph
    // is fully sequential, so the *next* turn's turn_started can arrive
    // while this refetch is still in flight; naively nulling here would
    // clobber that newer, already-correct state.
    if (this.generatingTurn() === completingTurn) {
      this.generatingTurn.set(null);
    }
  });
}
```
`streamingText` is untouched (already left populated until the next `turn_started`, spec 0021) — this fix only changes *when* `generatingTurn` clears, not `streamingText`'s existing behavior.

**Two remaining gaps, independent of the fix above, still need the fallback markup from the original draft of this spec** — not for the completion-event race (now closed), but for a genuinely different scenario: loading/reconnecting to the page mid-generation, before any WS-driven client state exists at all (no `turn_started` was ever received client-side, so `generatingTurn` is null even though the debate is actively generating server-side). Opening statement's 3rd branch already exists for exactly this reason (its own comment says so); verdict has no equivalent today.

- **Opening statement's existing fallback branch** (`debate-thread.html:62-84`) gets an avatar+header added, matching the final branch's header text exactly (`d.judge_persona.name` is already in scope, no dependency on `gt`):
```html
} @else if (isActive() && d.status !== 'OPEN') {
  <div class="opening-entry">
    <div class="opening-head">
      <span class="avatar avatar-judge avatar-inline">{{ initialFor(d.judge_persona.name) }}</span>
      Opening Statement &middot; {{ d.judge_persona.name }}
    </div>
    <div class="thinking-row">
      @if (streamingText()) {
        <p class="opening-text">{{ streamingText() }}</p>
      } @else {
        <span class="thinking-label">Generating opening statement&hellip;</span>
        <span class="typing-indicator"><span></span><span></span><span></span></span>
      }
    </div>
  </div>
}
```
- **Verdict gets a new 3rd branch**, mirroring the pattern above. **Caught and corrected during implementation** (see "Found during implementation" below) — a first attempt gated this on a new client-only `lastGeneratingStage` signal, which doesn't actually cover a genuine fresh page load (it starts `null`, same as `generatingTurn`, so it can't disambiguate anything on first load). Corrected to a condition derived entirely from refetchable data: every debate today has exactly 2 participants (established elsewhere in this file), so once `max_rounds * 2` real arguments exist with no verdict yet, argument generation is provably done and the verdict must be next — no client-only signal needed at all:
```html
} @else if (!d.verdict && d.status !== 'OPEN' && arguments().length >= d.max_rounds * 2) {
  <div class="round-divider">
    <span class="round-line"></span>
    <span class="round-label">Verdict</span>
    <span class="round-line"></span>
  </div>
  <div class="verdict-entry">
    <div class="verdict-head">
      <span class="avatar avatar-judge avatar-inline">{{ initialFor(d.judge_persona.name) }}</span>
      Verdict &middot; {{ d.judge_persona.name }}
    </div>
    @if (streamingText()) {
      <p class="verdict-reasoning">{{ streamingText() }}</p>
    } @else {
      <span class="typing-indicator"><span></span><span></span><span></span></span>
    }
  </div>
}
```

## Explicitly out of scope

Any change to `streamingText`'s own lifecycle (spec 0021, working correctly, untouched). Any change to the auto-scroll effect itself — with the dip/overshoot gone at the source, its unconditional re-pin-to-bottom behavior is no longer the problem; not touching it avoids an unrelated risk.

## Verification plan

- Real browser, gap-free DOM/scroll polling (same technique that found this) across at least 2-3 argument-round transitions on a live debate: confirm `bubble-row`/`scrollHeight` no longer dip at all during a turn's completion — should transition monotonically (only ever grow), no shrink-then-grow.
- Same polling technique across the opening-statement and verdict swaps: confirm avatar/header present in every sample, no gap.
- Separately, confirm the reconnect-mid-generation scenario still works for both opening statement and verdict: load/refresh the page while a debate is actively generating (no prior client-side WS state), confirm the fallback branches render correctly with an avatar/header, not just streamed text.
- Confirm the race guard: contrive or reason carefully about back-to-back turns arriving close together and confirm the *next* turn's `generatingTurn` is never incorrectly cleared by a stale completion callback.
- `npx ng test`.

## Branch

Continuing on `main`.

## Found during implementation

**Caught before shipping, not after**: the first draft of the verdict fallback branch's condition used a new client-only `lastGeneratingStage` signal (mirroring `streamingText`'s lifecycle) to disambiguate "reconnected mid-argument-round" from "reconnected mid-verdict." Verifying my own reasoning against `isActive()`'s actual definition (`ACTIVE_STATUSES.has(d.status)`, purely server-refetched data) exposed the flaw: on a genuine fresh page load, `lastGeneratingStage()` starts at `null` too — same as `generatingTurn()` — so it can never actually fire for the scenario it was built for. Brought back to the user rather than shipped as-is; corrected to a condition derived entirely from refetchable data (`arguments().length >= d.max_rounds * 2`, since every debate today has exactly 2 participants) — this one genuinely works on a cold reload, confirmed later in real-browser verification.

## Found during verification

**A second real bug, introduced by the corrected verdict fallback branch itself**: real-browser DOM/scroll polling across the argument→verdict boundary found a one-frame stale-content flash — the last argument's leftover `streamingText()` briefly rendered inside `.verdict-reasoning` before the verdict's own `turn_started` event reset it. Root cause: by construction, that branch only ever renders while `generatingTurn()` is null — i.e. strictly *before* the verdict's own turn_started has been received — so any `streamingText()` visible at that point can only be stale leftover from the just-finished argument turn, never legitimate verdict content. Fixed by never referencing `streamingText()` in that branch at all (always just the placeholder dots); real verdict content correctly takes over via the proper thinking-branch the instant its own events arrive.

Full verification, in order:
- Real browser, gap-free scroll/DOM polling (~20-35ms samples) across 2-3 argument-round transitions on 2 separate fresh debates: confirmed `bubble-row` count and `scrollHeight` now increase strictly monotonically through every argument completion — zero dips, where the original bug reliably produced one every time (e.g. previously 3→2→4; now 1→2, 2→3, 3→4... with no backward step anywhere in 2244+504 combined samples across runs).
- Same polling technique across the opening-statement and verdict swaps across a full debate lifecycle (458 samples): zero "text with no avatar" or blank-region violations.
- Reconnect-mid-generation scenario confirmed for opening statement via an actual page reload mid-generation: fallback rendered correctly with avatar `M` + "Opening Statement · Moderator" + typing indicator, immediately, not blank. (Verdict's equivalent reconnect window proved too fast in this environment to catch live — reasoned as correct by construction, same pattern, same underlying data source, not directly captured.)
- After the second fix: re-verified specifically at the argument→verdict boundary (504 samples, one full debate run) — 0 hits scanning for the stale-content condition; `.verdict-reasoning` first appears with genuinely new content (matching the persisted `Verdict.reasoning` in Postgres exactly); `scrollHeight` at that boundary now *rises* instead of dipping, and stays monotonically non-decreasing through the rest of the run.
- Zero console errors throughout every pass. Debates confirmed reaching a correct final state (decision/confidence/reasoning matching the DB record) in all runs.
- 29 Angular tests pass (1 updated — the existing `generatingTurn` clear-on-completion test now asserts the delayed-clear behavior, with an extra microtask flush to let the `.then()` chain settle, matching a pattern already used elsewhere in the same test file).

## Status

Implemented and verified against the real running stack, including a bug introduced during this same implementation, found and fixed within the same pass. Closes the user-reported scroll-flicker bug and the two previously-logged opening-statement/verdict blink bugs.
