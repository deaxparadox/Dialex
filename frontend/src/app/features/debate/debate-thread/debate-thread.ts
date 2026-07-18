import { Component, computed, signal } from '@angular/core';

export interface DebateArgument {
  id: string;
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
  isStreaming: boolean;
}

interface Connector {
  fromId: string;
  toId: string;
}

const PLOT_X_MIN = 60;
const PLOT_X_MAX = 840;
const ROUND_Y: Record<number, number> = { 1: 100, 2: 240, 3: 380 };

// Mock data standing in for what will later arrive over the per-debate WebSocket
// (references/002-design-review-findings.md, decisions 12/17). Swapping this out later
// for a real `core/` real-time service shouldn't require restructuring this component.
const MOCK_ARGUMENTS: DebateArgument[] = [
  {
    id: 'r1',
    agentName: 'Agent R',
    agentRole: 'Risk',
    round: 1,
    leaning: 0.1,
    position: 'reject',
    confidence: 0.8,
    text: 'The debt-to-income ratio sits at 46% above our typical threshold for this loan type without a compensating factor.',
    respondsToId: null,
    respondsToLabel: null,
    isStreaming: false,
  },
  {
    id: 'g2',
    agentName: 'Agent G',
    agentRole: 'Growth',
    round: 2,
    leaning: 0.95,
    position: 'approve',
    confidence: 0.9,
    text: "The co-signer's verified income covers the shortfall once recalculated against the joint application.",
    respondsToId: null,
    respondsToLabel: null,
    isStreaming: false,
  },
  {
    id: 'r3',
    agentName: 'Agent R',
    agentRole: 'Risk',
    round: 3,
    leaning: 0.875,
    position: 'approve',
    confidence: 0.75,
    text: "Reconsidering: the co-signer's income does cover the gap once I recalculate jointly. Withdrawing my objection.",
    respondsToId: 'g2',
    respondsToLabel: 'Responds to Agent G, round 2',
    isStreaming: false,
  },
  {
    id: 'c3',
    agentName: 'Agent C',
    agentRole: 'Compliance',
    round: 3,
    leaning: 0.65,
    position: null,
    confidence: null,
    text: 'Agreed on the ratio recalculation. One remaining check: the joint application needs both signatures on file before this can close, which the packet is currently missing.',
    respondsToId: null,
    respondsToLabel: null,
    isStreaming: true,
  },
];

const CONNECTORS: Connector[] = [{ fromId: 'g2', toId: 'r3' }];

@Component({
  selector: 'app-debate-thread',
  imports: [],
  templateUrl: './debate-thread.html',
  styleUrl: './debate-thread.css',
})
export class DebateThread {
  readonly theme = signal<'light' | 'dark'>('light');
  readonly mode = signal<'minimal' | 'detail'>('detail');
  readonly arguments = signal<DebateArgument[]>(MOCK_ARGUMENTS);
  readonly connectors = CONNECTORS;

  private readonly streamingArgument = computed(
    () => this.arguments().find((a) => a.isStreaming) ?? null,
  );
  readonly selectedId = signal<string>(this.streamingArgument()?.id ?? MOCK_ARGUMENTS[0].id);
  readonly selectedArgument = computed(
    () => this.arguments().find((a) => a.id === this.selectedId()) ?? null,
  );

  readonly revealedText = signal('');
  private readonly reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    const streaming = this.streamingArgument();
    if (streaming) {
      this.revealText(streaming);
    } else {
      this.revealedText.set(this.selectedArgument()?.text ?? '');
    }
  }

  setTheme(mode: 'light' | 'dark') {
    this.theme.set(mode);
    document.documentElement.setAttribute('data-theme', mode);
  }

  setMode(mode: 'minimal' | 'detail') {
    this.mode.set(mode);
  }

  select(arg: DebateArgument) {
    this.selectedId.set(arg.id);
    this.revealedText.set(arg.text);
  }

  private revealText(arg: DebateArgument) {
    if (this.reduceMotion) {
      this.revealedText.set(arg.text);
      return;
    }
    const words = arg.text.split(' ');
    let shown = 0;
    const step = () => {
      shown++;
      this.revealedText.set(words.slice(0, shown).join(' '));
      if (shown < words.length) {
        setTimeout(step, 55);
      }
    };
    step();
  }

  xFor(arg: DebateArgument): number {
    return PLOT_X_MIN + arg.leaning * (PLOT_X_MAX - PLOT_X_MIN);
  }

  yFor(arg: DebateArgument): number {
    return ROUND_Y[arg.round] ?? 100;
  }

  colorFor(arg: DebateArgument): string {
    if (arg.isStreaming) return 'var(--ink-faint)';
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
