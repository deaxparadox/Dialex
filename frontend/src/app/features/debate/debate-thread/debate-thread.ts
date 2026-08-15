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
import { HumanizeSlugPipe } from '../../../shared/pipes/humanize-slug-pipe';
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
  createdAt: string;
  respondsToId: string | null;
  respondsToLabel: string | null;
}

/** A turn's LLM call has started but not finished yet (spec 0018/0019) — no
 * content, just enough to show a live "who's generating" indicator instead
 * of silence until the corresponding complete event lands. */
export interface GeneratingTurn {
  agentPersonaId: number;
  agentName: string;
  stage: 'opening_statement' | 'argument' | 'verdict';
  roundNumber: number | null;
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
    createdAt: api.created_at,
    respondsToId: api.responds_to_id !== null ? String(api.responds_to_id) : null,
    respondsToLabel: null, // filled in once the full list is known — see fillRespondsToLabels
  };
}

/** First letter of a name, uppercased — e.g. "Pragmatist" → "P" (spec 0015,
 * removed in 0016, reintroduced in 0019 for the avatar chip specifically). */
function initialFor(name: string): string {
  return name.charAt(0).toUpperCase();
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
  imports: [HumanizeSlugPipe],
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

  /** `roundNumbers` plus the in-progress round if a `turn_started` (spec
   * 0018) arrives for a round that has no real arguments yet — otherwise
   * the very first turn of a new round has no round-divider to render its
   * "thinking" bubble under. */
  readonly roundsToRender = computed<number[]>(() => {
    const rounds = new Set(this.roundNumbers());
    const gt = this.generatingTurn();
    if (gt?.stage === 'argument' && gt.roundNumber !== null) rounds.add(gt.roundNumber + 1);
    return [...rounds].sort((a, b) => a - b);
  });

  /** Live "who's generating right now" signal (spec 0018/0019) — cleared the
   * moment the corresponding complete event arrives and fresh data is fetched. */
  readonly generatingTurn = signal<GeneratingTurn | null>(null);

  /** Accumulated live text for whatever turn is currently generating (spec
   * 0020) — a single signal, not a per-turn map, since `DebateWorkflow` is
   * fully sequential (verified by reading `workflows.py`): only one
   * participant/judge call is ever streaming at a time, globally, per
   * debate. Cleared on `turn_started` (fresh turn), `turn_token_reset` (the
   * same turn restarting after a Temporal-level retry), and once the turn's
   * complete event lands and real data is fetched. */
  readonly streamingText = signal<string>('');

  /** `generatingTurn`, but only when it's actually the opening-statement
   * turn — null (not just "some other stage") once round 1's turn_started
   * arrives, so the template's @else-if chain correctly falls through to the
   * "not ready yet" fallback instead of getting stuck rendering nothing.
   * Found as a real bug during spec 0019 verification: the template used to
   * check `generatingTurn(); as gt` directly, which is truthy for *any*
   * stage — once it moved to 'argument', the opening-statement branch was
   * "claimed" but rendered nothing, leaving a ~2s blank gap before the next
   * refetch happened to land. */
  readonly openingGeneratingTurn = computed(() => {
    const gt = this.generatingTurn();
    return gt?.stage === 'opening_statement' ? gt : null;
  });

  /** Stable first-seen agentId order — index 0 renders left, everyone else
   * right (spec 0016). Extended (spec 0019) to also seed from a live
   * `generatingTurn` so the very first "thinking" bubble of a debate — before
   * any real argument exists — still has a side to render on. Every debate
   * today has exactly 2 participants; a hypothetical 3rd would stack on the
   * right/reuse agent-b's color, an accepted simplification. */
  private readonly agentOrder = computed<number[]>(() => {
    const seen: number[] = [];
    for (const a of this.arguments()) {
      if (!seen.includes(a.agentId)) seen.push(a.agentId);
    }
    const gt = this.generatingTurn();
    if (gt?.stage === 'argument' && !seen.includes(gt.agentPersonaId)) seen.push(gt.agentPersonaId);
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

    // Auto-scroll to the newest argument/indicator as the thread grows (same
    // pattern already used in consultation-chat.ts) — replaces spec 0015's
    // selection-based live-follow, and with it the race condition that
    // depended on a "selected argument" concept that no longer exists.
    afterRenderEffect(() => {
      this.arguments();
      this.generatingTurn();
      this.streamingText();
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
   * `startPolling` fallback below. `turn_started` (spec 0018) carries no
   * persisted content, so it just updates `generatingTurn` directly; the
   * other event types mean "something changed, go re-fetch" (ADR 0006
   * decision 3), same as before. */
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
      (event) => {
        if (event.type === 'turn_started') {
          this.streamingText.set('');
          this.generatingTurn.set({
            agentPersonaId: event.agent_persona_id,
            agentName: event.agent_name,
            stage: event.stage,
            roundNumber: event.round_number,
          });
        } else if (event.type === 'turn_token') {
          this.streamingText.update((text) => text + event.token);
        } else if (event.type === 'turn_token_reset') {
          this.streamingText.set('');
        } else {
          // `generatingTurn` clears immediately, but `streamingText` is left
          // as-is deliberately (not reset here) — `loadDebate()`'s refetch is
          // async, and clearing both synchronously left a real gap where
          // `generatingTurn` was already null but the real complete data
          // hadn't arrived yet: the opening-statement fallback (built for a
          // different case, reconnecting mid-generation) doesn't know about
          // `streamingText` and unconditionally showed dots, so already-
          // streamed text visibly reverted to a loading indicator for
          // ~100-150ms right before the swap (found during spec 0021
          // verification). Leaving `streamingText` populated until the next
          // `turn_started` naturally clears it means that fallback (and the
          // verdict-thinking block) keep showing the same, now-complete text
          // instead of reverting — a seamless swap once the real data lands.
          this.generatingTurn.set(null);
          void this.loadDebate(debateId);
        }
      },
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

  isLeft(agentId: number): boolean {
    return this.agentOrder().indexOf(agentId) === 0;
  }

  /** Which of the 2 agent-identity colors (spec 0019) this agent gets —
   * keyed off the same first-seen order `isLeft` uses, so it's stable
   * across every round. A hypothetical 3rd+ agent reuses 'b'. */
  agentSlot(agentId: number): 'a' | 'b' {
    return this.agentOrder().indexOf(agentId) === 0 ? 'a' : 'b';
  }

  initialFor(name: string): string {
    return initialFor(name);
  }

  timeFor(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  colorFor(arg: DebateArgument): string {
    return arg.leaning >= 0.5 ? 'var(--convergence)' : 'var(--divergence)';
  }
}
