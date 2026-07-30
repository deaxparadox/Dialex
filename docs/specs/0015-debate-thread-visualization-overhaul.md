# Spec 0015 — Debate-thread visualization overhaul

> No new ADR — everything here is presentation-layer work on top of already-decided architecture (spec 0008's leaning/graph model, ADR 0006's streaming). Spec A of the 3-spec batch agreed after user feedback on 2026-07-19 (spec B: enum humanization, spec C: consultant reflection — separate specs). Covers 6 of the reported items; the other 3 (superadmin, temperature, consultant reflection) were handled separately or are out of scope here.

## Root causes, verified directly (not assumed) — see TODO.md for the original repro detail

1. **Node/label overlap**: `get_leaning()` (`backend/src/apps/debates/serializers.py`) derives `leaning` purely from `position`'s index in `CaseTypeConfig.position_options` — confidence and agent identity never factor in. Two same-round arguments with the same `position` get identical `leaning`, hence identical `(x, y)` in `debate-thread.ts` (`xFor`/`yFor` depend only on `leaning` and `round`) — full visual stack. Confirmed against debate #17, round 1 (both agents "approve").
2. **No agent identity**: the node monogram is `arg.agentName.slice(-1)` — the *last* character of the persona's name ("Pragmatist" → "t", "Scale-minded" → "d"), not initials, and there's no legend anywhere mapping it back to a name.
3. **No judge in the UI at all**: `d.judge_persona` is already in the API response (`DebateSerializer`) but never referenced in `debate-thread.html`.
4. **Reading panel doesn't live-follow**: `loadDebate()`'s first load (0 arguments, debate still `OPEN`) sets `selectedId = null`. Every later refresh (poll, and now the WS-triggered one from spec 0014) takes the `preserveSelection = true` branch, which deliberately keeps `selectedId` untouched — correct once the user has picked something, but if they never have, it stays `null` forever and the panel shows "No arguments yet." even as the graph fills up live.
5. **No animation**: `[attr.cx]`/`[attr.cy]`/`[attr.stroke]` are plain SVG attribute bindings with no `transition` anywhere in `debate-thread.css` — any position/color change is an instant jump.
6. **Verdict shifts position**: `.reading-panel` is one `overflow-y: auto` region holding the argument body *and* the verdict card in the same flow — the verdict's vertical position depends on how long the currently-selected argument's text is.

## 1. Fix node overlap + give agents a stable identity (same underlying change)

`debate-thread.ts`: assign every distinct `agent_persona.id` appearing in the debate a stable **lane index**, in first-seen order (0, 1, 2, …) — computed once from `arguments()`, not from `position`. `yFor(arg)` becomes `yForRound(arg.round) + laneOffset(laneIndexOf(arg))`, where `laneOffset` centers lanes symmetrically around the round's gridline (`(i - (n-1)/2) * LANE_GAP`, `LANE_GAP = 16`) — so for the common 2-participant case, one agent sits slightly above the round line and the other slightly below it, consistently across every round. `xFor` is unchanged (still leaning-driven) — two same-position arguments in the same round now differ in `y` (their lane), so they never fully overlap even when `x` is identical.

This doubles as the agent-identity fix: since a given agent occupies the *same* lane in every round, "top lane" / "bottom lane" becomes a consistent visual identity independent of the confusing monogram. Also fix the monogram itself — `arg.agentName.slice(-1)` → first character of the name, uppercased (`arg.agentName.charAt(0).toUpperCase()`): "Pragmatist" → "P", "Scale-minded" → "S". Add a small legend line (new entries in the existing `.legend` row in `debate-thread.html`, not a new color system — color still means leaning) listing each distinct agent in the debate: `P Pragmatist`, `S Scale-minded`, computed as a small derived list (`agentLegend = computed(...)`, one entry per distinct `agent_persona.id` in first-seen order, each `{ initial, name, role }`).

## 2. Show the judge

Two additions, both using data already in `ApiDebate.judge_persona` (no API change needed):
- `debate-thread.html`'s `.case-meta` row gets a new `<span><b>Judge</b>&nbsp; {{ d.judge_persona.name }}</span>`, alongside Status/Strategy/Round — visible from the moment the page loads, not just once a verdict exists.
- The verdict card's header changes from `Verdict` to `Verdict &middot; {{ d.judge_persona.name }}` — ties the decision directly to who made it.

## 3. Live-follow the reading panel until the user picks something themselves

New signal in `debate-thread.ts`: `private readonly userHasSelected = signal(false)`, set `true` inside `select()` (the existing click handler) — never reset, so once a user reads anything, their choice is respected exactly as it is today (this part isn't broken and shouldn't change). In `loadDebate()`'s `preserveSelection` branch: if `!this.userHasSelected() && mapped.length > 0`, advance `selectedId`/`revealedText` to the newest argument (same "last in round order" logic the initial-load path already uses) instead of leaving them untouched. If the user *has* selected something, behavior is unchanged from today.

## 4. Smooth graph animation

`debate-thread.css`:
- `.node-ring, .node-monogram, .node-tag { transition: cx 0.4s ease, cy 0.4s ease; }` and `.node-ring { transition: cx 0.4s ease, cy 0.4s ease, stroke 0.3s ease; }` — existing nodes glide to a new position/color instead of jumping (covers e.g. `yForRound`'s spacing recalculating as more rounds appear).
- `.connector { transition: d 0.4s ease; }` — progressive enhancement; browsers that don't support animating path `d` just snap, same as today, no regression.
- A `@keyframes node-appear { from { opacity: 0; r: 0; } to { opacity: 1; } }` applied as `animation: node-appear 0.5s ease` on `.node-ring` — plays automatically when a new node is inserted into the DOM (Angular's `@for` `track arg.id` means a genuinely new argument is a genuinely new element, so CSS animations fire naturally; existing nodes are untouched since animations don't replay on unrelated re-renders).
- All of the above wrapped to respect `prefers-reduced-motion: reduce` (`transition: none; animation: none`), matching the existing pattern already used for the reading-caret blink in this same file.

## 5. Split the reading panel once a verdict exists

Restructure `debate-thread.html`'s `.reading-panel-inner`: wrap the existing `@if (selectedArgument(); as sel) {...} @else {...}` block in a new `.reading-scroll` div; wrap the verdict card's reasoning specifically (not the whole card) in a `.verdict-reasoning-scroll` div — the verdict's head/decision line stay always visible (they're short, one line each), only the (potentially long) reasoning paragraph gets its own bounded scroll region.

`debate-thread.css`:
- `.reading-panel-inner` gains `height: 100%; display: flex; flex-direction: column;` (on top of its existing rules).
- `.reading-panel` loses `overflow-y: auto` (the two inner regions scroll themselves now — no double-scrollbar).
- `.reading-scroll { flex: 1; min-height: 0; overflow-y: auto; }` — with no verdict present, this is the only scrolling child besides the (absolutely-positioned) hint, so it fills the panel exactly as today (no regression to the pre-verdict case, per the requirement that it "spans full height" until a verdict arrives).
- `.verdict-reasoning-scroll { max-height: 120px; overflow-y: auto; }` inside the existing `.verdict-card` (which itself stays `flex: 0 0 auto` — a genuinely fixed height, not shifting based on argument length above it).

## Explicitly out of scope

A judge node/marker plotted on the graph itself (the judge doesn't produce a plottable "argument" in the current data model — showing their name in the meta line + verdict card is the real gap, not a missing graph point). A "jump back to live" button for after a user has manually selected something (not asked for; `userHasSelected` never resets, matching today's existing preserve-selection intent). Reworking the leaning computation itself (item 1's fix is purely visual — lanes, not leaning values, separate the nodes) — `get_leaning()` stays as spec 0008 defined it. The dead `arg.position === null` ("generating…") template branch — confirmed unreachable under the current write path (`ArgumentOutput.position: str` is required, arguments are written complete-or-not-at-all per ADR 0006) but not one of the 9 reported items; left untouched to keep this spec's diff scoped to what was actually asked.

## Verification plan

- Real browser (Canary): re-run a debate with the same case profile used in earlier verification (same-position arguments in a round, to directly re-trigger the original overlap bug) and confirm the two nodes are now visually distinct (different lanes, no label collision), each labeled with a first-letter monogram matching the new legend.
- Confirm the judge's name renders in both the meta line (from page load, before any arguments exist) and the verdict card header once judged.
- Confirm the reading panel auto-advances to each new argument as it streams in live (no manual click needed) until the user clicks a node themselves, after which further live updates no longer move their selection.
- Confirm node/connector transitions are visible (not just present in CSS) during a live run, and that they're disabled under `prefers-reduced-motion: reduce` (DevTools emulation).
- Confirm pre-verdict the reading panel still spans full height as today; post-verdict, confirm the verdict card stays at a fixed position/height regardless of the selected argument's text length, and that a long verdict reasoning scrolls internally without moving the decision line.
- Re-run `npx ng test`.

## Branch

Continuing on `main`.

## Found during implementation/verification

Real-browser verification (3 full debate runs) surfaced a genuine, narrow race condition in item 3's live-follow fix, not caused by the fix's own logic but made newly visible by it: `openStream()`'s WebSocket message handler fires a brand-new `loadDebate()` on every message with no request sequencing, so if two WS events arrive close together and resolve out of order, a stale in-flight request can overwrite a fresher selection. Reproduced in 1 of 3 runs. Logged in TODO.md, not fixed in this pass (matching the existing WS-leak bug's "log now, fix later" treatment) — a follow-up would add a monotonic request-sequence guard in `loadDebate()`.

## Status

Implemented and verified in a real browser across 3 full debate runs. 5 of 6 fixes confirmed clean with concrete evidence (pixel-measured lane offsets, exact verdict-card bounding-box match, legend/monogram/judge text all correct). The 6th (live-follow) works as designed but has one known, narrow timing-dependent race — see above. 18 Angular tests pass, no regressions.
