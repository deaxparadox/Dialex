'use client';

import { useAuth } from './auth-context';
import { config } from './config';

export type ConsultantStep = 'draft' | 'critique' | 'revise';

// Ported byte-for-byte from
// frontend/src/app/features/consultation/data/consultation-step-stream.ts —
// fetch + manual SSE-frame parsing (not EventSource, which can't set an
// Authorization header). A live "what's happening" nudge only; the
// sendMessage POST's own resolution remains the sole source of truth.
export function useConsultationStepStream() {
  const { accessToken } = useAuth();

  function connect(sessionId: number, onStep: (step: ConsultantStep) => void, signal: AbortSignal): void {
    void run(sessionId, onStep, signal);
  }

  async function run(sessionId: number, onStep: (step: ConsultantStep) => void, signal: AbortSignal): Promise<void> {
    if (!accessToken) return;
    try {
      const response = await fetch(`${config.orchestratorApiBase}/api/consultations/${sessionId}/stream`, {
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

  return { connect };
}
