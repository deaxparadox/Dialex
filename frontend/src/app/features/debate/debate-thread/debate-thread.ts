import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
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
  /** 0 = fully divergent/reject, 1 = fully convergent/approve. Drives the position/confidence color. */
  leaning: number;
  position: string | null; // null while still generating
  confidence: number | null;
  text: string;
  respondsToId: string | null;
  respondsToLabel: string | null;
}

const ACTIVE_STATUSES = new Set(['OPEN', 'ARGUING', 'CONVERGING']);
const POLL_INTERVAL_MS = 4000;

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
  // Kept exactly as it renders today per explicit instruction (spec 0016) —
  // there's no more reading-panel for 'detail' to open, so this is currently
  // a no-op, reserved for a future definition rather than removed.
  readonly mode = signal<'minimal' | 'detail'>(this.readModeParam());

  readonly loading = signal(true);
  readonly noDebateSelected = signal(false);
  readonly notFound = signal(false);

  readonly debate = signal<ApiDebate | null>(null);
  readonly case = signal<ApiCase | null>(null);
  readonly arguments = signal<DebateArgument[]>([]);
  readonly roundNumbers = computed(() => [...new Set(this.arguments().map((a) => a.round))].sort((a, b) => a - b));

  /** Stable first-seen agentId order — index 0 renders left, everyone else
   * right (spec 0016). Every debate today has exactly 2 participants; a
   * hypothetical 3rd would stack on the right, an accepted simplification. */
  private readonly agentOrder = computed<number[]>(() => {
    const seen: number[] = [];
    for (const a of this.arguments()) {
      if (!seen.includes(a.agentId)) seen.push(a.agentId);
    }
    return seen;
  });

  private readonly threadContainer = viewChild<ElementRef<HTMLDivElement>>('threadContainer');

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

    // Auto-scroll to the newest argument as the thread grows (same pattern
    // already used in consultation-chat.ts) — replaces spec 0015's
    // selection-based live-follow, and with it the race condition that
    // depended on a "selected argument" concept that no longer exists.
    afterRenderEffect(() => {
      this.arguments();
      const el = this.threadContainer()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  private async loadDebate(debateId: number): Promise<void> {
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
      await this.loadDebate(debateId);
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
      () => void this.loadDebate(debateId),
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
    this.pollHandle = setInterval(() => void this.loadDebate(debateId), POLL_INTERVAL_MS);
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

  private readModeParam(): 'minimal' | 'detail' {
    const param = this.route.snapshot.queryParamMap.get('mode');
    return param === 'minimal' || param === 'detail' ? param : 'detail';
  }

  /** `replaceUrl: true` is deliberate (spec 0007) — a mode toggle click
   * updates the URL without pushing a new history entry. */
  private syncQueryParams(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode: this.mode() },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  argumentsInRound(round: number): DebateArgument[] {
    return this.arguments().filter((a) => a.round === round);
  }

  isLeft(arg: DebateArgument): boolean {
    return this.agentOrder().indexOf(arg.agentId) === 0;
  }

  colorFor(arg: DebateArgument): string {
    return arg.leaning >= 0.5 ? 'var(--convergence)' : 'var(--divergence)';
  }
}
