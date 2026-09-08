'use client';

import { useState } from 'react';
import type { ApiHumanReview } from '@/lib/debates-api';

interface Props {
  humanReview: ApiHumanReview | null;
  decisionOptions: string[];
  onSubmit: (body: { final_decision: string | null; comment: string }) => Promise<void>;
}

// Ported from spec 0032 Phase 3's design (ADR 0011 decision 1) — never
// built in Angular, built here directly per ADR 0012 decision 4.
export function HumanReviewPanel({ humanReview, decisionOptions, onSubmit }: Props) {
  const [decision, setDecision] = useState<string | null>(decisionOptions[0] ?? null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (humanReview) {
    return (
      <div className="mt-5 rounded-[14px] border border-line bg-page p-4">
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">Human review</div>
        {humanReview.final_decision && (
          <p className="mb-1.5 font-mono text-[13.5px] font-bold text-ink">{humanReview.final_decision}</p>
        )}
        <p className="text-[13px] leading-[1.55] text-ink">{humanReview.comment}</p>
        <p className="mt-2 text-[11px] text-ink-faint">
          Reviewed {new Date(humanReview.reviewed_at).toLocaleString()}
        </p>
      </div>
    );
  }

  async function submit(): Promise<void> {
    if (!comment.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ final_decision: decision, comment: comment.trim() });
    } catch {
      setError('Could not submit this review — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-5 rounded-[14px] border border-line bg-page p-4">
      <div className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">Human review</div>
      {decisionOptions.length > 0 && (
        <div className="mb-3 flex gap-2">
          {decisionOptions.map((opt) => (
            <button
              key={opt}
              onClick={() => setDecision(opt)}
              className={`rounded-lg border px-3 py-1.5 text-sm capitalize ${
                decision === opt ? 'border-judge bg-judge text-page' : 'border-line text-ink-muted'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comment (required)"
        rows={3}
        className="mb-2 w-full rounded-lg border border-line bg-ground px-3 py-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-judge"
      />
      {error && <p className="mb-2 text-[12.5px] text-divergence">{error}</p>}
      <button
        onClick={submit}
        disabled={!comment.trim() || submitting}
        className="rounded-lg bg-convergence px-4 py-2 text-sm font-semibold text-page disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit review'}
      </button>
    </div>
  );
}
