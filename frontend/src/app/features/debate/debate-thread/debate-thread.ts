import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { Auth } from '../../../core/auth/auth';
import { ApiArgument, ApiCase, ApiDebate, DebatesApi } from '../data/debates-api';
import { DebateStream } from '../data/debate-stream';

export interface DebateArgument {
  id: string;
  agentId: number;
  agentName: string;
  agentRole: string;
  round: number;
  /** 0 = fully divergent/reject, 1 = fully convergent/approve. Drives both x-position and node color. */
  leaning: number;
  position: string | null; // null while still generating
  confidence: number | null;
  text: string;
  respondsToId: string | null;
  respondsToLabel: string | null;
}

export interface AgentLegendEntry {
  agentId: number;
  initial: string;
  name: string;
  role: string;
}

interface Connector {
  fromId: string;
  toId: string;
}

const PLOT_X_MIN = 60;
const PLOT_X_MAX = 840;
const PLOT_Y_MIN = 100;
const PLOT_Y_MAX = 380;

const ACTIVE_STATUSES = new Set(['OPEN', 'ARGUING', 'CONVERGING']);
const POLL_INTERVAL_MS = 4000;

// Vertical distance between adjacent lanes (spec 0015) — at least 2×node-radius
// (15px) plus a small pad, so two same-round, same-position arguments (which
// share an x too) never fully overlap even in the worst case.
const LANE_GAP = 36;

function mapArgument(api: ApiArgument): DebateArgument {
  return {
    id: String(api.id),
    agentId: api.agent_persona.id,
    agentName: api.agent_persona.name,
    agentRole: api.agent_persona.role_description || api.agent_persona.role,
    round: api.round_number + 1, // display 1-indexed; the API's round_number is 0-indexed
    leaning: api.leaning,
    position: api.position,
    confidence: api.confidence,
    text: api.content,
    respondsToId: api.responds_to_id !== null ? String(api.responds_to_id) : null,
    respondsToLabel: null, // filled in once the full list is known — see fillRespondsToLabels
  };
}

/** First letter of the persona's name, uppercased — e.g. "Pragmatist" → "P".
 * (Was `.slice(-1)`, the *last* letter, which produced meaningless node
 * labels like "t"/"d" — spec 0015.) */
function initialFor(agentName: string): string {
  return agentName.charAt(0).toUpperCase();
}

function fillRespondsToLabels(args: DebateArgument[]): DebateArgument[] {
  const byId = new Map(args.map((a) => [a.id, a]));
  return args.map((a) => {
    if (!a.respondsToId) return a;
    const target = byId.get(a.respondsToId);
    if (!target) return a;
    return { ...a, respondsToLabel: `Responds to ${target.agentName}, round ${target.round}` };
  });
}

@Component({
  selector: 'app-debate-thread',
  imports: [],
  templateUrl: './debate-thread.html',
  styleUrl: './debate-thread.css',
})
export class DebateThread {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(DebatesApi);
  private readonly auth = inject(Auth);
  private readonly debateStream = inject(DebateStream);
  private readonly destroyRef = inject(DestroyRef);

  // Theme deliberately stays local, not a query param (spec 0007) — it's a
  // personal display preference, not "which view of this debate," and a
  // shared link shouldn't force the sharer's theme on whoever opens it.
  readonly theme = signal<'light' | 'dark'>('light');
  readonly mode = signal<'minimal' | 'detail'>(this.readModeParam());

  readonly loading = signal(true);
  readonly noDebateSelected = signal(false);
  readonly notFound = signal(false);

  readonly debate = signal<ApiDebate | null>(null);
  readonly case = signal<ApiCase | null>(null);
  readonly arguments = signal<DebateArgument[]>([]);
  readonly connectors = computed<Connector[]>(() =>
    this.arguments()
      .filter((a): a is DebateArgument & { respondsToId: string } => a.respondsToId !== null)
      .map((a) => ({ fromId: a.respondsToId, toId: a.id })),
  );
  readonly roundNumbers = computed(() => [...new Set(this.arguments().map((a) => a.round))].sort((a, b) => a - b));

  /** Stable per-agent lane index, first-seen order (spec 0015) — separates
   * same-round/same-position nodes vertically instead of them fully
   * overlapping, and doubles as a consistent per-agent visual identity
   * (a given agent always occupies the same lane across every round). */
  private readonly agentOrder = computed<number[]>(() => {
    const seen: number[] = [];
    for (const a of this.arguments()) {
      if (!seen.includes(a.agentId)) seen.push(a.agentId);
    }
    return seen;
  });

  readonly agentLegend = computed<AgentLegendEntry[]>(() => {
    const byId = new Map(this.arguments().map((a) => [a.agentId, a]));
    return this.agentOrder().map((agentId) => {
      const a = byId.get(agentId)!;
      return { agentId, initial: initialFor(a.agentName), name: a.agentName, role: a.agentRole };
    });
  });

  private laneOffset(agentId: number): number {
    const order = this.agentOrder();
    const index = order.indexOf(agentId);
    const n = order.length;
    if (index < 0 || n <= 1) return 0;
    return (index - (n - 1) / 2) * LANE_GAP;
  }

  readonly selectedId = signal<string | null>(null);
  readonly selectedArgument = computed(
    () => this.arguments().find((a) => a.id === this.selectedId()) ?? null,
  );
  readonly revealedText = signal('');
  /** True once the user has ever clicked a node themselves — until then,
   * the reading panel auto-follows the newest argument live (spec 0015);
   * after, their manual selection is respected exactly as before. */
  private readonly userHasSelected = signal(false);

  readonly isActive = computed(() => ACTIVE_STATUSES.has(this.debate()?.status ?? ''));
  readonly starting = signal(false);
  readonly startError = signal<string | null>(null);
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private streaming = false;

  constructor() {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (!idParam) {
      this.noDebateSelected.set(true);
      this.loading.set(false);
      return;
    }
    void this.loadDebate(Number(idParam));
    this.destroyRef.onDestroy(() => {
      this.closeStream();
      this.stopPolling();
    });
  }

  private async loadDebate(debateId: number, preserveSelection = false): Promise<void> {
    try {
      const [debate, apiArguments] = await Promise.all([
        this.api.getDebate(debateId),
        this.api.getArguments(debateId),
      ]);
      const mapped = fillRespondsToLabels(apiArguments.map(mapArgument));
      this.debate.set(debate);
      this.arguments.set(mapped);
      if (!this.case()) {
        this.case.set(await this.api.getCase(debate.case_id));
      }

      if (!preserveSelection) {
        const requested = this.route.snapshot.queryParamMap.get('selected');
        const initialId =
          (requested && mapped.some((a) => a.id === requested) && requested) ||
          mapped[mapped.length - 1]?.id ||
          null;
        this.selectedId.set(initialId);
        this.revealedText.set(mapped.find((a) => a.id === initialId)?.text ?? '');
        this.syncQueryParams();
      } else if (!this.userHasSelected() && mapped.length > 0) {
        // Live-follow (spec 0015): the user hasn't picked anything themselves
        // yet, so keep advancing to the newest argument as it streams in —
        // otherwise the panel is stuck on "No arguments yet." forever even as
        // the graph fills up live. Once they click a node, userHasSelected
        // flips and this branch never runs again for this page view.
        const newestId = mapped[mapped.length - 1].id;
        this.selectedId.set(newestId);
        this.revealedText.set(mapped.find((a) => a.id === newestId)?.text ?? '');
      } else {
        // A poll tick refreshed the data — keep whatever the user had open,
        // just refresh its text in case it changed (it won't have, but stays correct if it ever does).
        this.revealedText.set(this.selectedArgument()?.text ?? this.revealedText());
      }

      // `isActive()` already covers OPEN — there's no reason to exclude it:
      // right after startDebate() calls loadDebate() to refresh, the backend
      // may not have transitioned off OPEN yet (a race with the workflow
      // actually starting), and excluding OPEN here meant polling never
      // started at all in that case, leaving the UI frozen even though the
      // debate was running and finishing server-side (found via real-browser
      // verification — a chained short-poll trace with zero DOM change over
      // 66s while the backend had already reached NO_CONSENSUS).
      if (this.isActive()) {
        this.openStream(debateId);
      } else {
        this.closeStream();
        this.stopPolling();
      }
    } catch {
      // 404 (not found/not owned) and any other load failure both render
      // the same "not found" state — no separate handling needed yet.
      this.notFound.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async startDebate(): Promise<void> {
    const debateId = this.debate()?.id;
    if (!debateId || this.starting()) return;
    this.starting.set(true);
    this.startError.set(null);
    try {
      await this.api.startDebate(debateId);
      await this.loadDebate(debateId, true);
    } catch {
      this.startError.set('Could not start this debate — please try again.');
    } finally {
      this.starting.set(false);
    }
  }

  /** Primary live-update path (spec 0014) — instant push instead of the
   * `startPolling` fallback below. */
  private openStream(debateId: number): void {
    if (this.streaming) return;
    const token = this.auth.getAccessToken();
    if (!token) {
      // Shouldn't happen — the route is already auth-guarded — but fail
      // visibly rather than silently leaving the view with no live updates.
      console.error(`No access token available to open the debate stream for debate ${debateId}`);
      this.startPolling(debateId);
      return;
    }
    this.streaming = true;
    this.debateStream.connect(
      debateId,
      token,
      () => void this.loadDebate(debateId, true),
      () => {
        this.streaming = false;
        console.warn(`WebSocket dropped for debate ${debateId}, falling back to polling`);
        this.startPolling(debateId);
      },
    );
  }

  private closeStream(): void {
    if (this.streaming) {
      this.debateStream.disconnect();
      this.streaming = false;
    }
  }

  /** Fallback only — used when the WebSocket can't be opened or drops
   * unexpectedly (spec 0014), not the primary update path anymore. */
  private startPolling(debateId: number): void {
    if (this.pollHandle) return;
    this.pollHandle = setInterval(() => void this.loadDebate(debateId, true), POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  setTheme(mode: 'light' | 'dark') {
    this.theme.set(mode);
    document.documentElement.setAttribute('data-theme', mode);
  }

  setMode(mode: 'minimal' | 'detail') {
    this.mode.set(mode);
    this.syncQueryParams();
  }

  select(arg: DebateArgument) {
    this.userHasSelected.set(true);
    this.selectedId.set(arg.id);
    this.revealedText.set(arg.text);
    this.syncQueryParams();
  }

  private readModeParam(): 'minimal' | 'detail' {
    const param = this.route.snapshot.queryParamMap.get('mode');
    return param === 'minimal' || param === 'detail' ? param : 'detail';
  }

  /** `replaceUrl: true` is deliberate (spec 0007) — every node click or mode
   * toggle updates the URL without pushing a new history entry, otherwise
   * the back button would tediously step through every argument ever
   * clicked instead of leaving the page. */
  private syncQueryParams(): void {
    if (this.selectedId() === null) return;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode: this.mode(), selected: this.selectedId() },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  xFor(arg: DebateArgument): number {
    return PLOT_X_MIN + arg.leaning * (PLOT_X_MAX - PLOT_X_MIN);
  }

  yForRound(round: number): number {
    const rounds = this.roundNumbers();
    const index = rounds.indexOf(round);
    if (rounds.length <= 1 || index < 0) return (PLOT_Y_MIN + PLOT_Y_MAX) / 2;
    return PLOT_Y_MIN + (index / (rounds.length - 1)) * (PLOT_Y_MAX - PLOT_Y_MIN);
  }

  yFor(arg: DebateArgument): number {
    return this.yForRound(arg.round) + this.laneOffset(arg.agentId);
  }

  initialFor(arg: DebateArgument): string {
    return initialFor(arg.agentName);
  }

  colorFor(arg: DebateArgument): string {
    return arg.leaning >= 0.5 ? 'var(--convergence)' : 'var(--divergence)';
  }

  connectorPath(c: Connector): string {
    const from = this.arguments().find((a) => a.id === c.fromId);
    const to = this.arguments().find((a) => a.id === c.toId);
    if (!from || !to) return '';
    const x1 = this.xFor(from);
    const y1 = this.yFor(from);
    const x2 = this.xFor(to);
    const y2 = this.yFor(to);
    const midY = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1 - 30} ${midY - 20}, ${x2 + 20} ${midY + 20}, ${x2} ${y2}`;
  }
}
