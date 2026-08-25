# ADR 0011 — Product shell architecture & multi-theme color system

> Reached via a full brainstorming session with the user (branch `redesign/product-shell-multi-theme`), including a visual-companion round for the dashboard IA and several rounds for color. Two genuinely cross-cutting decisions bundled here, following ADR 0001/0009's own precedent of bundling "frontend architecture & design principles" and "app-wide motion system" as single ADRs rather than one per screen.

## Context

The frontend has grown one screen at a time (specs 0001–0031): login/register, a consultation chat, a debate thread, and a flat "My debates" list. There is no home surface — `''` redirects straight into the debates list (spec 0027) — and two flows the PRD locks as core to the product (`docs/PRD.md` §6-7) have no UI or backend endpoint at all:

- **Human Review** (decision 8, `references/002-design-review-findings.md`) — every debate requires a human decision before anything real happens; this is the product's actual mechanical point, not a nice-to-have.
- **Notifications** (decision 17) — debates are long-running and disconnect-tolerant by design, so a persisted, browsable notification record is how a user finds out what happened while they weren't watching.

Separately, ADR 0001's theming section established one token system — light/dark variants of a single neutral palette (`styles.css`) — validated early and extended consistently since (spec 0012 panel styling, spec 0019 per-agent colors, spec 0026 motion). Asked directly, the user found that palette too muted/gray for the product they want, and — after a design-companion round comparing three brighter directions — asked for two of them (not one) to both ship as user-selectable brand identities, each with its own light and dark mode.

## Decision 1 — Product shell: a Home dashboard, not a redirect

Home leads with **"Needs your review"** — debates in `JUDGED`/`NO_CONSENSUS` status with no `HumanReview` row yet, oldest first — because that's the literal mechanical point of decision 8. A slimmer "In progress" strip follows for live debates. This was chosen over two alternatives shown to the user in the visual companion:

- **Three-lane kanban** (Consulting/Debating/Needs Review columns) — rejected as more structure than a single-user tool with realistically a handful of active debates needs; it's machinery built for a triage team.
- **Unified chronological feed** — rejected because it buries the one thing that matters most ("what needs me right now") inside undifferentiated volume, the wrong trade-off for a product whose entire premise is a mandatory human checkpoint.

`/debates` (today's flat list) becomes the full, filterable archive — a superset of Home's curated excerpt, not a competing home page. Nav becomes a primary cluster (`Home`, `Debates`, `New case`) and a utility cluster (notification bell, account/theme controls) — see Decision 3 for what lives in the utility cluster.

**Human Review does not get its own route.** It's a panel appended to the existing Debate Thread page under the verdict once judged (or read-only once submitted) — the verdict is already "the thread's final entry" by design (spec 0016/0017), so forcing navigation away from it at the exact decision moment is friction, not structure. `/debates/:id` stays the one URL for a debate's whole life.

**Notifications** get a bell + drawer in the topbar for the live/recent view, plus a `/notifications` archive route for the full history — mirroring decision 17's own two-path model (instant push + durable persisted record) with two matching UI entry points onto the same data.

## Decision 2 — Status color is its own namespace, not borrowed

`--divergence`/`--convergence` (styles.css) already carry a specific, different meaning: `debate-thread.ts`'s `colorFor(arg)` maps them to one argument's `leaning` value. Reusing them for case-level status (e.g. "no consensus" as a case status vs. "this argument leans away from consensus") would overload the same hue with two meanings at two different scopes in the same app. Shown three options in the visual companion — reuse existing tokens, a single-accent-plus-neutral scheme, and a dedicated new status namespace — the user picked the dedicated namespace. New tokens (`--status-action`, `--status-live`, `--status-done`, or equivalent, finalized in the spec) never alias the argument-leaning or agent-identity tokens. Case type itself stays label/icon-only, deliberately not given a color — a fourth color axis would collide with agent-identity and leaning colors already carrying meaning.

## Decision 3 — Two independent brand themes, each with light + dark

Rejected evolving the existing neutral palette in place (shown to the user as "Option 1 — Refined neutral" and explicitly turned down as still reading gray/dull) in favor of two new, fully-realized brand identities:

- **Sunlit Citrus** — warm orange as the dominant brand color (page/panels warm-white to warm-black across modes), plum used sparingly only for the judge's identity. Deliberately not blue or purple, to avoid reading as another generic SaaS or "AI-purple-gradient" tool.
- **Electric Contrast** — a real navy chrome color (not gray) framing a bright page in light mode, deepening to a near-black navy page in dark mode, with high-voltage lime/amber/pink accent chips.

Both are genuinely independent — not a hue swap of one shared structure — each gets its own light and dark token set, confirmed against real contrast in a 2×2 matrix (Citrus-light, Citrus-dark, Electric-light, Electric-dark) before approval. This is a deliberate scope expansion over "just pick one direction": the user explicitly chose "two independent brand themes, each with its own light+dark" over reusing the existing light/dark mechanism as the only axis.

**Control model:** theme (Citrus/Electric) is a `<select>` — it has no OS-level signal to fall back to, so it always needs an explicit, persisted choice (default: Citrus). Mode (light/dark) stays a toggle switch and keeps its existing fallback behavior (`prefers-color-scheme` when the user hasn't explicitly overridden it, per ADR 0001/spec 0007's original "theme is a personal, local preference, not shareable state" call). Both controls move into the nav's utility cluster (Decision 1) — the debate-thread page's own light/dark toggle (spec 0016 onward) is retired in favor of this one global control; the page's separate Minimal/Detail toggle is unaffected, since that's genuinely about how this one reading experience is displayed, not the app's color identity.

**Token structure:** two independent attributes on `:root` — `data-brand` (`citrus`, default | `electric`) and the existing `data-theme` (`light` | `dark` | absent-follows-system). Four compound selectors define the four token sets; `data-brand` is always written explicitly by the app (no CSS-only default reads correctly without it, since there is no brand equivalent of `prefers-color-scheme`). Persisted the same way the existing theme choice is (`localStorage`, client-only — no backend field, since like today's theme choice this is a personal display preference, not shared state).

## Consequences

- Every future spec that touches a screen must define its colors as semantic tokens under both brand namespaces, not hardcoded hex — the token count roughly doubles from ADR 0001's single set, which is real, accepted cost for a feature the user explicitly asked for.
- `debate-thread`'s per-agent (`--agent-a`/`--agent-b`), judge (`--judge`), and argument-leaning (`--divergence`/`--convergence`) tokens are retained conceptually but get real values under all four brand/mode combinations — they are not part of the new status-color namespace (Decision 2) and don't change scope.
- Implementation is sequenced as several follow-up specs under one umbrella (`docs/specs/0032-...`), not one giant patch — consistent with this repo's existing one-spec-per-milestone history.
