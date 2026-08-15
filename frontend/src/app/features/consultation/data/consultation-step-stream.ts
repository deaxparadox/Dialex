import { Service } from '@angular/core';

import { environment } from '../../../../environments/environment';

export type ConsultantStep = 'draft' | 'critique' | 'revise';

/** Thin wrapper around a `fetch`-based SSE reader for the consultant's
 * step-indicator channel (ADR 0008 decision 5, spec 0023) — kept separate
 * from `ConsultationChat` so it's mockable in unit tests, same reasoning
 * `DebateStream` already established for the debate WebSocket. Uses `fetch`
 * + manual SSE-frame parsing rather than the browser's `EventSource`, which
 * can't set an `Authorization` header. */
@Service()
export class ConsultationStepStream {
  connect(sessionId: number, accessToken: string, onStep: (step: ConsultantStep) => void, signal: AbortSignal): void {
    void this.run(sessionId, accessToken, onStep, signal);
  }

  private async run(
    sessionId: number,
    accessToken: string,
    onStep: (step: ConsultantStep) => void,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const response = await fetch(`${environment.orchestratorApiBase}/api/consultations/${sessionId}/stream`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      });
      const reader = response.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line; each frame's "data:" line is JSON.
        let sepIndex: number;
        while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(5).trim()) as { step: ConsultantStep };
          onStep(payload.step);
        }
      }
    } catch {
      // Aborting on send-completion throws an expected AbortError here —
      // anything else just means the label stays generic, never worth
      // failing the whole send over a cosmetic indicator.
    }
  }
}
