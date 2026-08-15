# Spec 0024 — Consultation "thinking" indicator redesign: spinner, flip, smooth resize

No ADR — a visual/animation redesign of an existing element (`consultation-chat.html`'s pending-turn bubble, added in spec 0023), no new dependency or cross-cutting pattern. Scoped to consultation-chat only, per explicit instruction — the debate-thread's identical-looking dots are a deferred follow-up (logged in `TODO.md`), not touched here.

## Why (user feedback, verbatim intent)

The 3-dot bouncing indicator plus a step label that instantly snaps between "Thinking…"/"Double-checking…"/"Revising…" felt like too much happening at once. Replace with: a single continuously-rotating circular spinner (not dots), a label that transitions with a literal 3D flip when it changes (not an instant snap), and a bubble that smoothly resizes to fit the new label instead of jumping — confirmed via AskUserQuestion: consultation-chat only for now, and the flip should be a literal 3D rotate (scoreboard/flip-clock style), not just a generic fade/slide.

## One thing verified before deciding the approach, not assumed

The obvious modern CSS-only way to animate a width change toward "however wide the new content needs to be" (`interpolate-size: allow-keywords` / `calc-size()`) currently only works in Chrome/Edge (confirmed via web search — Chrome/Edge 129+, no Firefox/Safari support yet). Not safe to rely on alone for a cross-browser app. Using the well-established, reliable alternative instead: measure the new content's actual rendered width in JS, then animate a plain `transition: width` to that explicit pixel value.

## 1. Markup — `consultation-chat.html`

```html
@if (sending()) {
  <div class="message">
    <span class="message-speaker">Consultant</span>
    <p class="message-content message-content--pending thinking-row" [style.width.px]="pendingWidth()">
      <span class="thinking-inner" #thinkingInner>
        <span class="spinner" aria-hidden="true"></span>
        @switch (currentStep()) {
          @case ('critique') { <span class="step-label">Double-checking…</span> }
          @case ('revise') { <span class="step-label">Revising…</span> }
          @default { <span class="step-label">Thinking…</span> }
        }
      </span>
    </p>
  </div>
}
```

Two structurally important points, both load-bearing for the "never restarts" requirement:
- The `.spinner` element sits *outside* the `@switch` — Angular's `@switch`/`@case` fully destroys and recreates whichever `<span class="step-label">` is active on every change, so anything that needs to keep animating continuously (the spinner) must not be inside it, or its CSS animation would restart from frame zero every time the label changes.
- The `.step-label` *is* inside the switch, and that's deliberately used to get the flip for free: since Angular truly recreates the element on each case change, the browser treats it as a freshly-inserted node each time, so a plain `animation: flip-in` on `.step-label` replays automatically on every label change — no Angular animations package, no extra JS needed for the flip itself.

## 2. Component — `consultation-chat.ts`

```ts
private readonly thinkingInner = viewChild<ElementRef<HTMLSpanElement>>('thinkingInner');
readonly pendingWidth = signal<number | null>(null);
```

Extend the existing constructor's `afterRenderEffect` (or add a second one) to re-measure whenever the step changes:
```ts
afterRenderEffect(() => {
  this.currentStep(); // dependency — re-measure whenever the label changes
  const el = this.thinkingInner()?.nativeElement;
  this.pendingWidth.set(el ? el.getBoundingClientRect().width : null);
});
```
`null` (no inline style) falls back to the CSS `width: fit-content` rule already on `.message-content--pending` — covers both "block not mounted yet" and gives a sensible natural first size the moment it does mount, before the very next effect run pins it to an explicit px value that all subsequent changes can then transition from. No `ResizeObserver` needed — `currentStep()` is already the one thing that changes the label's size, and `afterRenderEffect` is the same DOM-reading pattern already used twice in this file (auto-scroll) and in `debate-thread.ts`, not a new technique for this codebase.

## 3. CSS — `consultation-chat.css`

Replace `.typing-indicator`/`.typing-indicator span`/`@keyframes typing-bounce` with:

```css
.thinking-row {
  overflow: hidden; /* clips during the width transition and the flip's perspective */
  transition: width 0.25s ease;
}

.thinking-inner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
}

.spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--ink-muted);
  border-top-color: transparent;
  flex-shrink: 0;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.step-label {
  display: inline-block;
  transform-origin: 50% 50%;
  backface-visibility: hidden;
  animation: flip-in 0.3s ease;
}

@keyframes flip-in {
  from { transform: rotateX(90deg); opacity: 0; }
  to { transform: rotateX(0deg); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .thinking-row { transition: none; }
  .spinner { animation: none; border-top-color: var(--ink-muted); } /* static ring, no spin */
  .step-label { animation: none; }
}
```

`prefers-reduced-motion` handling mirrors the existing pattern already in `debate-thread.css` (spec 0015) — not a new convention.

## Explicitly out of scope

`debate-thread.css`'s `.typing-indicator` (logged as a separate follow-up). Any change to `currentStep`'s data source, the SSE connection, or `ConsultationStepStream` — this is purely how the existing signal gets rendered, not where it comes from.

## Verification plan

Real browser (Canary): drive a consultation turn, confirm — via `getComputedStyle`/`getBoundingClientRect`, not just a visual glance — that (a) the spinner's rotation animation never resets (same `animation-play-state`/computed rotation progressing monotonically across a label change, not jumping back to 0°); (b) the bubble's width changes smoothly across at least one label transition (sampled mid-transition, not just before/after); (c) the flip animation actually plays on each label change (element re-created, animation observed). Re-run `npx ng test`.

## Branch

Continuing on `main`.

## Found during verification

No bugs found — a clean pass, confirmed with real numeric measurements rather than a visual glance, per the verification plan:

- **Spinner rotation**: sampled `.spinner`'s computed `transform` every ~250ms across a full pending window spanning two label changes. Unwrapped rotation angle progressed continuously across both label-change boundaries (no reset to 0°, no backward jump) — cumulative rotation over a 6.142s window came out to 2457.9° (6.83 full cycles), matching the declared `0.9s`/cycle rate (expected 6.82 cycles) almost exactly.
- **Flip animation**: confirmed via `getAnimations()` plus DOM-identity tracking that each label change is a genuinely new element (Angular's `@switch` recreating it, not a text mutation), and that `flip-in` actually runs each time (`playState: "running"`, `currentTime` climbing from 0 to ~283-300ms before completing) — not just statically declared.
- **Width transition**: sampled `.thinking-row`'s `getBoundingClientRect().width` at ~66ms resolution immediately after each label change — confirmed multiple distinct intermediate widths on both a widening and a narrowing transition (e.g. 101.453 → 102.031 → 102.547 → 102.719 → 102.766 over ~267ms), not a single-frame jump.
- Two full conversation turns completed successfully, zero console/JS errors.

## Found during real-world use (post-close)

The user caught a real bug immediately after using this: longer labels ("Double-checking…", "Revising…") wrapped onto two lines instead of the bubble expanding to fit them on one — the "container not expanding" symptom. Root cause: `.step-label` never had `white-space: nowrap`. Without it, when new (longer) text renders, it wraps to fit whatever width `.thinking-row` *currently* has (a stale value from the previous, shorter label) instead of overflowing — and the measurement effect then reads the *wrapped* box's width, which just reflects the current constraint, not the text's true single-line width. That fed back into `pendingWidth()` as a value that never actually grew, so the bubble stayed stuck wrapped indefinitely. Fixed by adding `white-space: nowrap` to `.step-label`, forcing it to always report/render its true single-line width regardless of the container's current size, breaking the loop. Bundled in the same pass: `.step-label` set to `font-weight: 600` (bold), per the same feedback.

Re-verified in a real browser across 3 consultation turns: all three label texts (`"Thinking…"`, `"Double-checking…"`, `"Revising…"`) confirmed via `getClientRects().length === 1` (single line, no wrap) in every sample, `.thinking-row`'s settled width matched `.thinking-inner`'s natural width to sub-pixel precision (e.g. 148.33px vs 148px for "Double-checking…"), and `getComputedStyle(...).fontWeight === '600'` confirmed on every label. One transient state was checked and correctly ruled out as expected, not a bug: an early poll caught `.thinking-row` narrower than `.thinking-inner` mid-transition (123.5px vs 148.3px) — re-checked after the declared 0.25s transition window and confirmed the widths converge exactly, consistent with the deliberate width-grow animation, not clipping. Zero console errors, all replies arrived normally.

**A second real bug caught by the user right after the first fix**: the spinner+label content had lopsided spacing — a large gap before the spinner, none after the text. Root cause: both the bubble (`.message-content--pending`/`.thinking-row`, padding `8px 12px` from `.message-content`) *and* the inner content wrapper (`.thinking-inner`, its own `padding: 10px 12px`) each had their own padding, but `pendingWidth` only ever measured the inner wrapper's (already-padded) width and applied that number as the *bubble's* total border-box width. Under the app's global `box-sizing: border-box` reset, the bubble then had to squeeze its own 24px of padding out of that same number — eating the right-hand space (clipped by `overflow: hidden`) while the left padding, which always reserves its own space regardless of overflow, stayed visible. Fixed by removing `.thinking-inner`'s padding entirely (only the bubble's own padding applies now, matching how every other message bubble in this chat already works) and updating the measurement effect to read the bubble's actual computed padding (`getComputedStyle`) and add it to the inner content's now-unpadded natural width. Re-verified in a real browser across all three labels: left gap and right gap both measured exactly 12px (matching `.message-content`'s own padding) for "Thinking…", "Double-checking…", and "Revising…", after waiting for the width transition to settle. No console errors, replies arrived normally both turns.

## Status

Implemented and verified against the real running stack with concrete DOM/CSS measurements, not a visual impression. Two real bugs found by the user in quick succession after the first pass — (1) missing `white-space: nowrap` causing the bubble to never actually expand for longer labels, (2) double-counted padding causing lopsided left/right spacing — both root-caused, fixed, and re-verified clean with per-label measurements. 21 Angular tests pass, zero console errors.
