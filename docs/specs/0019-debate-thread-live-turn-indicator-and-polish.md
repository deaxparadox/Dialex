# Spec 0019 — Live "who's generating" indicator, avatars, timestamps, per-agent colors

> No new ADR — consumes spec 0018's new event type plus polish already scoped in the same conversation. Frontend only.

## 1. `DebateStream` — actually pass the message through

`frontend/src/app/features/debate/data/debate-stream.ts`: today `connect()`'s `onMessage` callback takes no arguments and the raw `MessageEvent`/its `.data` is discarded entirely — every message (regardless of type) just triggers a blind `loadDebate()` refetch. That was fine when every event meant "something changed, go re-fetch" (ADR 0006 decision 3), but `turn_started` carries transient info that was never written to Postgres — there's nothing to refetch. Change the signature to parse and forward the event:

```ts
connect(debateId: number, accessToken: string, onMessage: (event: { type: string; [k: string]: unknown }) => void, onUnexpectedClose: () => void): void {
  ...
  socket.onmessage = (raw: MessageEvent<string>) => onMessage(JSON.parse(raw.data));
  ...
}
```

## 2. `debate-thread.ts` — branch on event type, add `generatingTurn`

New signal: `readonly generatingTurn = signal<{ agentPersonaId: number; agentName: string; stage: 'opening_statement' | 'argument' | 'verdict'; roundNumber: number | null } | null>(null)`.

`openStream()`'s message handler becomes:
```ts
(event) => {
  if (event['type'] === 'turn_started') {
    this.generatingTurn.set({
      agentPersonaId: event['agent_persona_id'] as number,
      agentName: event['agent_name'] as string,
      stage: event['stage'] as 'opening_statement' | 'argument' | 'verdict',
      roundNumber: event['round_number'] as number | null,
    });
  } else {
    this.generatingTurn.set(null); // this turn is done — argument_complete/status_change means fresh data is coming
    void this.loadDebate(debateId);
  }
}
```

`agentOrder` (first-seen left/right assignment) extends to also seed from `generatingTurn()` when its stage is `'argument'` and that agent hasn't appeared in `arguments()` yet — otherwise the very first "thinking" bubble of the whole debate (before any real argument exists) has no side to render on:
```ts
private readonly agentOrder = computed<number[]>(() => {
  const seen: number[] = [];
  for (const a of this.arguments()) if (!seen.includes(a.agentId)) seen.push(a.agentId);
  const gt = this.generatingTurn();
  if (gt?.stage === 'argument' && !seen.includes(gt.agentPersonaId)) seen.push(gt.agentPersonaId);
  return seen;
});
```

## 3. `debate-thread.html` — render the indicator in the right place per stage

- `stage === 'opening_statement'`: replaces spec 0017's generic "Generating opening statement…" text with the same visual (typing dots), now using the real judge name from the event instead of a hardcoded string — same position (before round dividers), same condition priority (`d.opening_statement` still wins if it already exists by the time this renders).
- `stage === 'argument'`: a bubble-shaped thinking indicator (typing dots inside a bubble shell) on the correct side via `isLeft`-equivalent logic keyed off `generatingTurn().agentPersonaId`, positioned after the last real argument in that round (or as its own trailing row if the round has no arguments yet).
- `stage === 'verdict'`: a "Judge is preparing a verdict…" block in the same position/style the eventual `verdict-entry` will occupy, shown only while `!d.verdict`.

## 4. Avatar icons

A small circular avatar (initial letter, matching the persona's first letter — same logic spec 0015 introduced and spec 0016 removed, brought back specifically for this) rendered **beside** each bubble (outer side — left of a left-aligned bubble, right of a right-aligned one), not inside the bubble text, matching normal chat-app conventions the user pointed at directly. Used on real bubbles, thinking-indicator bubbles, and the judge's opening/verdict blocks.

## 5. Timestamps

`DebateArgument` gains `createdAt: string` (from `ApiArgument.created_at`, already fetched, never stored). Rendered as a short local time (`new Date(arg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })`) in each bubble's meta line, alongside position/confidence.

## 6. Distinct per-agent bubble colors

New tokens in `styles.css` (light/dark pairs, distinct hues from the existing `--divergence`/`--convergence`/`--judge` family so they read as a separate "who" signal, not a second "how" signal): `--agent-a`/`--agent-a-bg` (blue family) and `--agent-b`/`--agent-b-bg` (rose family). `--agent-a`/`--agent-b` used for that agent's avatar background/border; `--agent-a-bg`/`--agent-b-bg` used for that agent's bubble background (replacing the current identical `var(--page)` for both sides). Which agent gets which pair is keyed off `agentOrder`'s index (0 → agent-a, 1 → agent-b), same mechanism `isLeft` already uses.

## Explicitly out of scope

Any change to the WS/data layer beyond passing the parsed message through (spec 0014's connection lifecycle, spec 0017's fallback-to-polling behavior — unchanged). A 3rd+ agent color (today's data model only ever has 2 participants; a hypothetical 3rd falls back to `--agent-b`'s pair, an accepted simplification matching spec 0016's existing left/right precedent). Avatars with real images/uploaded pictures — initials only, consistent with the existing design language.

## Verification plan

- Real browser (Canary), full debate run: confirm a "thinking" indicator appears for the opening statement, then for each participant's argument in every round (correct name, correct side), then for the verdict — with no gap anywhere where nothing is visible while the backend is working.
- Confirm the indicator disappears and the real bubble/opening-statement/verdict appears in its place once the corresponding complete event lands — no flash of both at once, no stuck stale indicator.
- Confirm avatars, timestamps, and distinct per-agent bubble colors all render correctly and consistently (same agent = same color/avatar across every round).
- Re-run `npx ng test`.

## Branch

Continuing on `main`.

## Found during implementation/verification

Real-browser verification caught a genuine, reproducible bug: the opening-statement slot went completely blank for ~1.9-2.1s (confirmed on 2 separate debates) right as the first round's `turn_started` arrived — evidence: `t003475ms.png` in the verification report showed empty space above the Round 1 divider. Root cause was two-fold: (1) spec 0018's `persist_opening_statement` never published its own completion signal (fixed there, `opening_statement_complete`); (2) this spec's own template used `@else if (generatingTurn(); as gt) { @if (gt.stage === 'opening_statement') {...} }` — the outer `@else if` is "claimed" by *any* truthy `generatingTurn`, regardless of stage, so once it moved to `'argument'` the branch matched but rendered nothing, blocking fallthrough to the fallback. Fixed with a new `openingGeneratingTurn` computed that returns `null` unless the stage actually matches, letting the chain correctly fall through. Re-verified via continuous DOM polling (~150-200ms resolution) across 2 fresh debate runs — no blank frame at any sampled instant either time, clean indicator→content swap in the same tick.

## Status

Implemented and verified in a real browser across multiple full debate runs. All items confirmed with concrete evidence: `turn_started`-driven indicators for all 3 stages (opening/argument/verdict) appear with no visible gap and are replaced by real content the instant it lands; avatars, timestamps, and distinct per-agent bubble colors confirmed via `getComputedStyle` (not just visual impression); the one real bug found (opening-statement blank gap) fixed and re-verified clean. 19 Angular tests pass, zero console errors.
