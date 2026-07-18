import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { ConsultationsApi } from '../data/consultations-api';

export interface ChatMessage {
  speaker: 'user' | 'consultant';
  content: string;
}

@Component({
  selector: 'app-consultation-chat',
  imports: [],
  templateUrl: './consultation-chat.html',
  styleUrl: './consultation-chat.css',
})
export class ConsultationChat {
  private readonly api = inject(ConsultationsApi);
  private readonly router = inject(Router);

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

  constructor() {
    this.loadCaseTypes();
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
    try {
      const result = await this.api.sendMessage(id, text);
      this.messages.update((msgs) => [...msgs, { speaker: 'consultant', content: result.message }]);
      this.readyToFinalize.set(result.ready_to_finalize);
    } catch (err: unknown) {
      this.error.set(this.describeError(err, 'Could not send that message — try again.'));
    } finally {
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
