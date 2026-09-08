'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { humanizeSlug } from '@/lib/humanize-slug';
import { ApiError, useConsultationsApi } from '@/lib/consultations-api';
import { useConsultationStepStream, type ConsultantStep } from '@/lib/consultation-step-stream';

interface ChatMessage {
  speaker: 'user' | 'consultant';
  content: string;
}

const STEP_LABELS: Record<ConsultantStep, string> = {
  draft: 'Thinking…',
  critique: 'Double-checking…',
  revise: 'Revising…',
};

function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 409) {
    return 'This consultation is already approved or failed — it can no longer accept messages.';
  }
  return fallback;
}

// Ported from frontend/src/app/features/consultation/consultation-chat.
// The thinking-indicator's exact JS-measured pixel-width transition (spec
// 0024) is simplified here to a plain fit-content bubble with a keyed fade
// on the step label — same observable behavior (spinner + changing label),
// not the same implementation mechanism (see spec 0036).
export default function ConsultationPage() {
  const api = useConsultationsApi();
  const stepStream = useConsultationStepStream();
  const router = useRouter();

  const [caseTypes, setCaseTypes] = useState<string[]>([]);
  const [selectedCaseType, setSelectedCaseType] = useState<string | null>(null);
  const [loadingCaseTypes, setLoadingCaseTypes] = useState(true);

  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftText, setDraftText] = useState('');
  const [readyToFinalize, setReadyToFinalize] = useState(false);
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<ConsultantStep | null>(null);

  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const types = await api.getCaseTypes();
        setCaseTypes(types.map((t) => t.type));
        setSelectedCaseType(types[0]?.type ?? null);
      } catch {
        setError('Could not load case types — try reloading the page.');
      } finally {
        setLoadingCaseTypes(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, currentStep]);

  async function startConsultation(): Promise<void> {
    if (!selectedCaseType) return;
    setError(null);
    try {
      const { session_id } = await api.startConsultation(selectedCaseType);
      setSessionId(session_id);
    } catch {
      setError('Could not start a consultation — try again.');
    }
  }

  async function sendMessage(): Promise<void> {
    const text = draftText.trim();
    if (sessionId === null || !text || sending) return;

    setMessages((msgs) => [...msgs, { speaker: 'user', content: text }]);
    setDraftText('');
    setSending(true);
    setError(null);
    setCurrentStep('draft'); // seeded optimistically — draft always starts immediately

    // Opened before the send below, deliberately (ADR 0008 decision 5) —
    // Redis pub/sub has no replay.
    const stepAbort = new AbortController();
    stepStream.connect(sessionId, (step) => setCurrentStep(step), stepAbort.signal);

    try {
      const result = await api.sendMessage(sessionId, text);
      setMessages((msgs) => [...msgs, { speaker: 'consultant', content: result.message }]);
      setReadyToFinalize(result.ready_to_finalize);
    } catch (err) {
      setError(describeError(err, 'Could not send that message — try again.'));
    } finally {
      stepAbort.abort();
      setCurrentStep(null);
      setSending(false);
    }
  }

  async function approve(): Promise<void> {
    if (sessionId === null || !readyToFinalize || approving) return;
    setApproving(true);
    setError(null);
    try {
      const result = await api.approve(sessionId);
      router.replace(`/debates/${result.debate_id}`);
    } catch (err) {
      setError(describeError(err, 'Could not approve this case — try again.'));
      setApproving(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      {sessionId !== null ? (
        <div className="flex w-full max-w-lg flex-col gap-3.5 rounded-2xl border border-line bg-ground p-8 shadow-[var(--panel-shadow)]">
          <h1 className="mb-1 font-[family-name:var(--font-display)] text-xl text-ink">Consultation #{sessionId}</h1>

          <div ref={messagesRef} className="flex max-h-[360px] flex-col gap-2.5 overflow-y-auto pr-1">
            {messages.map((msg, i) => (
              <div key={i} className={`flex max-w-[85%] flex-col gap-0.5 ${msg.speaker === 'user' ? 'self-end items-end' : ''}`}>
                <span className="text-[11px] uppercase tracking-wide text-ink-muted">
                  {msg.speaker === 'user' ? 'You' : 'Consultant'}
                </span>
                <p
                  className={`m-0 rounded-[10px] px-3 py-2 text-sm leading-snug ${
                    msg.speaker === 'user' ? 'bg-convergence text-page' : 'bg-page text-ink'
                  }`}
                >
                  {msg.content}
                </p>
              </div>
            ))}
            {sending && (
              <div className="flex max-w-[85%] flex-col gap-0.5">
                <span className="text-[11px] uppercase tracking-wide text-ink-muted">Consultant</span>
                <p className="m-0 flex w-fit items-center gap-1.5 rounded-[10px] bg-page px-3 py-2 text-sm text-ink">
                  <span className="h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full border-2 border-ink-muted border-t-transparent" />
                  <span key={currentStep ?? 'default'} className="animate-[fade-in_0.2s_ease] text-[0.85em] font-semibold text-ink-muted">
                    {STEP_LABELS[currentStep ?? 'draft']}
                  </span>
                </p>
              </div>
            )}
          </div>

          {error && <p className="m-0 text-sm text-divergence">{error}</p>}

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Type your message…"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void sendMessage();
              }}
              disabled={sending || approving}
              className="flex-1 rounded-lg border border-line bg-page px-3 py-2.5 text-ink outline-none focus-visible:outline-2 focus-visible:outline-convergence"
            />
            <button
              onClick={sendMessage}
              disabled={sending || approving || !draftText.trim()}
              className="rounded-lg bg-convergence px-4 py-2.5 font-semibold text-page disabled:opacity-50"
            >
              Send
            </button>
          </div>

          <button
            onClick={approve}
            disabled={!readyToFinalize || approving}
            className="mt-1 rounded-lg bg-convergence px-4 py-2.5 font-semibold text-page disabled:opacity-50"
          >
            {approving ? 'Approving…' : 'Approve and start debate'}
          </button>
        </div>
      ) : (
        <div className="flex w-full max-w-lg flex-col gap-3.5 rounded-2xl border border-line bg-ground p-8 shadow-[var(--panel-shadow)]">
          <h1 className="mb-1 font-[family-name:var(--font-display)] text-xl text-ink">Start a new case</h1>
          {loadingCaseTypes ? (
            <p className="text-sm text-ink-muted">Loading case types…</p>
          ) : (
            <>
              <label className="flex flex-col gap-1.5 text-[13px] text-ink-muted">
                <span>Case type</span>
                <select
                  value={selectedCaseType ?? ''}
                  onChange={(e) => setSelectedCaseType(e.target.value)}
                  className="rounded-lg border border-line bg-page px-3 py-2.5 text-ink outline-none focus-visible:outline-2 focus-visible:outline-convergence"
                >
                  {caseTypes.map((type) => (
                    <option key={type} value={type}>
                      {humanizeSlug(type)}
                    </option>
                  ))}
                </select>
              </label>
              {error && <p className="m-0 text-sm text-divergence">{error}</p>}
              <button
                onClick={startConsultation}
                disabled={!selectedCaseType}
                className="rounded-lg bg-convergence px-4 py-2.5 font-semibold text-page disabled:opacity-50"
              >
                Start consultation
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
