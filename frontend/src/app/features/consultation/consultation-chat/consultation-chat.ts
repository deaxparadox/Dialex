import { Component, ElementRef, afterRenderEffect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';

import { Auth } from '../../../core/auth/auth';
import { HumanizeSlugPipe } from '../../../shared/pipes/humanize-slug-pipe';
import { ConsultantStep, ConsultationStepStream } from '../data/consultation-step-stream';
import { ConsultationsApi } from '../data/consultations-api';

export interface ChatMessage {
  speaker: 'user' | 'consultant';
  content: string;
}

@Component({
  selector: 'app-consultation-chat',
  imports: [HumanizeSlugPipe],
  templateUrl: './consultation-chat.html',
  styleUrl: './consultation-chat.css',
})
export class ConsultationChat {
  private readonly api = inject(ConsultationsApi);
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly stepStream = inject(ConsultationStepStream);

  readonly caseTypes = signal<string[]>([]);
  readonly selectedCaseType = signal<string | null>(null);
  readonly loadingCaseTypes = signal(true);

  readonly sessionId = signal<number | null>(null);
  readonly messages = signal<ChatMessage[]>([]);
  readonly draftText = signal('');
  readonly readyToFinalize = signal(false);
  readonly sending = signal(false);
  readonly approving = signal(false);
  readonly error = signal<string | null>(null);

  /** Which reflection step is currently running for the in-flight turn
   * (ADR 0008 decision 5) — a live nudge only, `sendMessage()`'s own
   * `POST /messages` call remains the sole source of truth for the reply. */
  readonly currentStep = signal<ConsultantStep | null>(null);

  /** Explicit pixel width for the pending bubble (spec 0024) — `null` falls
   * back to the CSS `width: fit-content` rule, giving a sensible natural
   * size the moment the bubble mounts; the very next effect run pins it to
   * a real px value so every subsequent label change has something numeric
   * to `transition: width` from (a plain CSS transition can't animate from
   * "auto"/"fit-content" — verified via web search, not assumed: the
   * modern CSS-only alternative, `interpolate-size`, only works in
   * Chrome/Edge today, not Firefox/Safari). */
  readonly pendingWidth = signal<number | null>(null);

  private readonly messagesContainer = viewChild<ElementRef<HTMLDivElement>>('messagesContainer');
  private readonly thinkingInner = viewChild<ElementRef<HTMLSpanElement>>('thinkingInner');
  private readonly pendingBubble = viewChild<ElementRef<HTMLParagraphElement>>('pendingBubble');

  constructor() {
    this.loadCaseTypes();

    // Scrolls to the latest message whenever the transcript changes or the
    // "Thinking…" row appears/disappears — afterRenderEffect (not a plain
    // effect) since this reads/writes the DOM, not just reactive state
    // (verified against Angular's own docs, not assumed).
    afterRenderEffect(() => {
      this.messages();
      this.sending();
      this.currentStep();
      const el = this.messagesContainer()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });

    // Re-measures the pending bubble's natural width every time the step
    // label changes, so `.thinking-row`'s width transition (spec 0024) has
    // a real target to animate toward — no ResizeObserver needed, since
    // `currentStep` is already the one thing that changes this element's size.
    //
    // `pendingWidth` is bound to the *bubble's* (border-box) width, but only
    // `.thinking-inner` (the un-padded content wrapper) is measured — so the
    // bubble's own horizontal padding has to be added back in explicitly, or
    // the bubble ends up squeezing that padding out of the same number it's
    // supposed to just be wrapping around (a real bug, found the hard way:
    // showed up as lopsided spacing, a full gap before the spinner but none
    // after the text, since the deficit gets clipped on the right by
    // `overflow: hidden` while the left padding still reserves its space).
    afterRenderEffect(() => {
      this.currentStep();
      const inner = this.thinkingInner()?.nativeElement;
      const bubble = this.pendingBubble()?.nativeElement;
      if (!inner || !bubble) {
        this.pendingWidth.set(null);
        return;
      }
      const { paddingLeft, paddingRight } = getComputedStyle(bubble);
      const horizontalPadding = parseFloat(paddingLeft) + parseFloat(paddingRight);
      this.pendingWidth.set(inner.getBoundingClientRect().width + horizontalPadding);
    });
  }

  private async loadCaseTypes(): Promise<void> {
    try {
      const types = await this.api.getCaseTypes();
      this.caseTypes.set(types.map((t) => t.type));
      this.selectedCaseType.set(types[0]?.type ?? null);
    } catch {
      this.error.set('Could not load case types — try reloading the page.');
    } finally {
      this.loadingCaseTypes.set(false);
    }
  }

  onSelectCaseType(type: string): void {
    this.selectedCaseType.set(type);
  }

  onDraftInput(text: string): void {
    this.draftText.set(text);
  }

  async startConsultation(): Promise<void> {
    const caseType = this.selectedCaseType();
    if (!caseType) return;
    this.error.set(null);
    try {
      const { session_id } = await this.api.startConsultation(caseType);
      this.sessionId.set(session_id);
    } catch {
      this.error.set('Could not start a consultation — try again.');
    }
  }

  async sendMessage(): Promise<void> {
    const id = this.sessionId();
    const text = this.draftText().trim();
    if (id === null || !text || this.sending()) return;

    this.messages.update((msgs) => [...msgs, { speaker: 'user', content: text }]);
    this.draftText.set('');
    this.sending.set(true);
    this.error.set(null);
    this.currentStep.set('draft'); // seeded optimistically — draft always starts immediately

    // Opened *before* the POST below, deliberately (ADR 0008 decision 5) —
    // Redis pub/sub has no replay, so subscribing after the request fires
    // risks missing the "draft started" event and sitting on the generic
    // label until "critique" happens to arrive.
    const stepAbort = new AbortController();
    const token = this.auth.getAccessToken();
    if (token) {
      this.stepStream.connect(id, token, (step) => this.currentStep.set(step), stepAbort.signal);
    }

    try {
      const result = await this.api.sendMessage(id, text);
      this.messages.update((msgs) => [...msgs, { speaker: 'consultant', content: result.message }]);
      this.readyToFinalize.set(result.ready_to_finalize);
    } catch (err: unknown) {
      this.error.set(this.describeError(err, 'Could not send that message — try again.'));
    } finally {
      stepAbort.abort(); // the POST's own resolution is the completion signal, not a step event
      this.currentStep.set(null);
      this.sending.set(false);
    }
  }

  async approve(): Promise<void> {
    const id = this.sessionId();
    if (id === null || !this.readyToFinalize() || this.approving()) return;

    this.approving.set(true);
    this.error.set(null);
    try {
      const result = await this.api.approve(id);
      await this.router.navigate(['/debates', result.debate_id], { replaceUrl: true });
    } catch (err: unknown) {
      this.error.set(this.describeError(err, 'Could not approve this case — try again.'));
      this.approving.set(false);
    }
  }

  private describeError(err: unknown, fallback: string): string {
    const status = (err as { status?: number })?.status;
    if (status === 409) {
      return 'This consultation is already approved or failed — it can no longer accept messages.';
    }
    return fallback;
  }
}
