# Spec 0016 — Debate-thread center-stage restyle: chat thread, not scatter plot

> No new ADR — presentation-layer only, same data already fetched (`content`/`position`/`confidence`/`agent_persona`/`responds_to_id` via the existing `GET /api/debates/{id}/arguments/`), no backend/schema change. Prompted by the user stepping back mid-session to question whether the app — and specifically the debate-thread UI — had been accumulating complexity (lanes, legends, node animations, a split verdict panel) without the underlying signal actually being precise enough to deserve it. Confirmed direction: restyle only, using the data we already have; the deeper "structured fact citation" data-model question is explicitly deferred, not decided here.

## What's being built

Replace `.main-split` (the scatter-plot `.graph-panel` + separate click-to-read `.reading-panel`) with one scrolling column: each argument renders as a chat bubble, left/right by agent, full text inline, grouped under round dividers, with an inline "responds to" citation chip and a verdict entry at the end of the thread. Modeled on the "center stage" of a sample dashboard layout the user shared (a chat-style debate transcript with rebuttal-linking and evidence tags) — deliberately **not** adopting that sample's surrounding dashboard chrome (metrics bar, event log, fallacy detector, consensus donut, strength chart, reasoning mini-graph), which would be complexity creep in the opposite direction from what prompted this spec.

This is also a genuine deletion, not just an addition: with no more "click a node to read it elsewhere" indirection, none of spec 0015's node-graph machinery is needed — lane offsets, the agent-initial legend, node-position/color CSS animations, the split-panel/verdict-scroll layout, and the `userHasSelected` live-follow-selection logic (including its logged race-condition bug, TODO.md) all go away because there's no "selected argument" state left to maintain or race on.

## 1. `debate-thread.ts` — removed

`Connector` interface, `connectors` computed, `connectorPath()`, `xFor`/`yFor`/`yForRound`, `PLOT_X_MIN/MAX`/`PLOT_Y_MIN/MAX`, `LANE_GAP`/`laneOffset()`/`agentOrder`'s lane role, `AgentLegendEntry`/`agentLegend`/`initialFor()` (bubbles show the full `agentName`/`agentRole` directly, like the old reading-panel's `rh-name` — no monogram needed), `selectedId`/`selectedArgument`/`revealedText`/`userHasSelected`/`select()`, the `selected` query param (read on load, written back in `syncQueryParams`).

## 2. `debate-thread.ts` — kept, mostly unchanged

`mapArgument`/`fillRespondsToLabels` (still need `respondsToLabel` — now shown inline in every bubble instead of only in a selected reading panel), `roundNumbers` (still groups arguments for round dividers), `colorFor()` (still leaning-based divergence/convergence color, now applied to a bubble's position/confidence line instead of a node stroke), `isActive`/`openStream`/`closeStream`/`startPolling`/`stopPolling`/`loadDebate` (all unchanged — this spec doesn't touch data-loading/streaming, only what's done with `arguments()` once loaded), `theme`/`setTheme`/`mode`/`setMode`/`readModeParam` (kept, `setMode` still writes the `mode` query param — the toggle just controls nothing visually anymore, see below).

`agentOrder` (first-seen `agentId` order) is kept, repurposed for left/right assignment: index 0 → left, every other index → right. Two-participant debates (the only kind that exist today) map cleanly to alpha-left/beta-right; a hypothetical 3rd+ participant would stack on the right alongside index 1 — an accepted simplification, not a regression, since nothing today has more than 2 participants (verified: every debate's `DebateParticipant` count is 2).

`loadDebate`'s `preserveSelection` parameter and the whole selection-preserving/live-follow branch are removed — a WS-triggered or poll-triggered refresh just re-sets `this.arguments`, and the template (see below) renders whatever's there. No selection to preserve, so nothing to race on.

## 3. New: auto-scroll to newest

Same pattern already used in `consultation-chat.ts` (`viewChild<ElementRef<HTMLDivElement>>('threadContainer')` + `afterRenderEffect`, scrolling to `scrollHeight` whenever `arguments()` changes) — not the more elaborate "only auto-scroll if already near the bottom" chat-UI pattern. This is a deliberate simplification, not an oversight: matches the one auto-scroll precedent this codebase already has, and the debate thread today has no comparable UX complaint about being yanked away from manually-scrolled-up history to justify the extra logic.

## 4. `debate-thread.html` — the new thread panel

Replaces `.graph-panel`+`.reading-panel` with one `.thread-panel` (same outer card treatment — border/shadow/`--ground`/`--panel-shadow`, same as today's panels):

```html
<div class="thread-panel" #threadContainer>
  @for (round of roundNumbers(); track round) {
    <div class="round-divider">
      <span class="round-line"></span>
      <span class="round-label">Round {{ round }}</span>
      <span class="round-line"></span>
    </div>
    @for (arg of argumentsInRound(round); track arg.id) {
      <div class="bubble-row" [class.left]="isLeft(arg)">
        <div class="bubble" [class.left]="isLeft(arg)">
          <div class="bubble-head">
            <span class="bubble-name">{{ arg.agentName }} &middot; {{ arg.agentRole }}</span>
          </div>
          @if (arg.respondsToLabel) {
            <div class="bubble-cite">&#8617; {{ arg.respondsToLabel }}</div>
          }
          <div class="bubble-text">{{ arg.text }}</div>
          <div class="bubble-meta" [style.color]="colorFor(arg)">
            @if (arg.position) {
              {{ arg.position }} &middot; {{ arg.confidence }}
            } @else {
              generating&hellip;
            }
          </div>
        </div>
      </div>
    }
  }
  @if (d.verdict; as v) {
    <div class="round-divider">
      <span class="round-line"></span>
      <span class="round-label">Verdict</span>
      <span class="round-line"></span>
    </div>
    <div class="verdict-entry">
      <div class="verdict-head">Verdict &middot; {{ d.judge_persona.name }}</div>
      <p class="verdict-decision">{{ v.decision }} &middot; {{ v.confidence }}</p>
      <p class="verdict-reasoning">{{ v.reasoning }}</p>
    </div>
  }
}
</div>
```

`argumentsInRound(round)` is a small helper (`arguments().filter(a => a.round === round)`) — the arguments are already round-then-insertion-ordered from the API, so no re-sorting needed. `isLeft(arg)` wraps the `agentOrder` index-0 check.

The verdict is now just the thread's last entry (no fixed-height/internal-scroll split needed — spec 0015's problem was a *separate panel* whose position shifted with argument length; inside a single scrolling thread, the verdict simply appears where it naturally falls, like any other message).

## 5. Mode toggle — kept, no-op

`mode`/`setMode`/the toggle buttons in `.header-card` stay exactly as they render today (signal, query param, active-state styling) per explicit instruction — but since there's no more reading-panel for `mode === 'detail'` to open, it currently controls nothing. Not removed, not repurposed yet; a placeholder for a future decision.

## 6. `debate-thread.css`

Remove: `.plot-area`/`.plot`/`.wash`/`.gridline`/`.round-label` (SVG-specific)/`.connector`/`.node-*`/`@keyframes node-appear`/the `prefers-reduced-motion` block guarding those/`.legend`/`.agent-key`/`.reading-panel*`/`.verdict-card`'s old flex-split rules/`.verdict-reasoning-scroll`/`.reading-head`/`.reading-body`/`.reading-caret`/`@keyframes caretblink`/the mobile `.reading-panel`/`.reading-scroll` overrides.

Add: `.thread-panel` (the renamed/repurposed `.graph-panel`'s card styling — border/shadow/scroll — applied to the new single column instead), `.round-divider`/`.round-line`/`.round-label` (linear divider version, not the old SVG gridline), `.bubble-row`/`.bubble` (left/right alignment via `justify-content`/`flex-direction`, rounded corners asymmetric toward the "tail" side, matching common chat-bubble conventions), `.bubble-head`/`.bubble-name`/`.bubble-cite`/`.bubble-text`/`.bubble-meta`, `.verdict-entry` (a plain block, not a flex-split panel — no more fixed-height requirement since it's not competing for space with anything above it in a bounded panel).

## Explicitly out of scope

The sample dashboard's surrounding chrome (metrics bar, event log, fallacy detector, consensus donut, strength chart, mini reasoning graph) — not asked for, and adding it would directly contradict what prompted this spec. Literal SVG connector lines between a rebuttal and what it responds to (the sample could draw these because entries were always adjacent; in a real scrolling thread an argument can respond to something several turns back, and drawing a line across an arbitrary scroll distance is a real step up in complexity — the existing `respondsToLabel` citation chip carries the same information far more simply). A distinct per-agent accent color system (the sample used cyan/purple per agent) — left/right position plus the agent's name/role text already distinguish speakers, the same way a normal two-party chat transcript does, without introducing a second color language alongside the existing divergence/convergence one. Showing `opening_statement`/`closing_summary` — already fetched but never rendered anywhere, a pre-existing gap this spec doesn't touch. Any change to `Argument`'s schema, the LangGraph node's structured output, or convergence-check logic — the "agents should cite specific facts" direction from this conversation is a real, separate, bigger decision, deliberately deferred.

## Verification plan

- Real browser (Canary): run a full debate, confirm bubbles render left/right correctly, round dividers group arguments correctly, a rebuttal's citation chip shows the right "Responds to X, round N" text, the verdict appears as the thread's final entry with the judge's name, and the thread auto-scrolls to each new argument as it streams in live (no stale/frozen view, and — since there's no selection state anymore — no possibility of the previously-logged race condition recurring).
- Confirm the mode toggle still renders/highlights correctly on click (even though it currently does nothing else).
- Re-run `npx ng test`; existing tests referencing removed signals/methods (`selectedId`, `select()`, node/connector helpers) will need updating to match the new component surface.

## Branch

Continuing on `main`.

## Found during implementation/verification

Two real debates were needed to verify item 4 fully: the first (unanimous "approve" both agents, both rounds) never triggered a rebuttal citation, since the backend only cites a responded-to argument when the agent's own position actually changes across rounds (an existing, deliberate rule, not something this spec touches). A second, deliberately borderline case ($25k loan, 610 credit score, 48% DTI) produced real position changes and genuine "↩ Responds to X, round N" citations, cross-checked directly against `Argument.responds_to` in Postgres. No functional bugs found.

## Status

Implemented and verified in a real browser across 2 full debate runs. All items confirmed working as designed: bubble left/right consistency (DOM-measured), round grouping, auto-scroll (numerically confirmed pinned to bottom), rebuttal citations (cross-checked against real DB data), verdict block, mode toggle no-op behavior, live WebSocket updates, zero console errors. 18 Angular tests pass, no regressions.
