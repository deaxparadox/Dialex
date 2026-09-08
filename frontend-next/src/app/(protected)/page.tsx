'use client';

import { useEffect, useState } from 'react';
import { useDebatesApi } from '@/lib/debates-api';
import { buildRows, type DebateRow } from '@/lib/debate-rows';
import { DebateRowLink } from './_components/debate-row-link';

const NEEDS_REVIEW_STATUSES = new Set(['JUDGED', 'NO_CONSENSUS']);
const IN_PROGRESS_STATUSES = new Set(['ARGUING', 'CONVERGING']);

function oldestFirst(rows: DebateRow[]): DebateRow[] {
  return [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Home dashboard (ADR 0011 decision 1) — designed in spec 0032, never built
// in Angular, built here directly per ADR 0012 decision 4. Replaces Phase
// 1's placeholder. OPEN/FAILED debates intentionally don't appear here —
// they're visible only in the full /debates archive.
export default function HomePage() {
  const { listDebates, listCases } = useDebatesApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DebateRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [debates, cases] = await Promise.all([listDebates(), listCases()]);
        if (!cancelled) setRows(buildRows(debates, cases));
      } catch {
        if (!cancelled) setError('Could not load your debates — please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-ink-muted">Loading…</div>;
  }
  if (error) {
    return <div className="flex h-full items-center justify-center text-divergence">{error}</div>;
  }

  const needsReview = oldestFirst(rows.filter((r) => NEEDS_REVIEW_STATUSES.has(r.status)));
  const inProgress = oldestFirst(rows.filter((r) => IN_PROGRESS_STATUSES.has(r.status)));

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-8 overflow-y-auto p-6">
      <section>
        <h1 className="mb-3 font-[family-name:var(--font-display)] text-xl text-ink">Needs your review</h1>
        {needsReview.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing needs your review right now.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {needsReview.map((row) => (
              <li key={row.id}>
                <DebateRowLink row={row} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-[family-name:var(--font-display)] text-lg text-ink">In progress</h2>
        {inProgress.length === 0 ? (
          <p className="text-sm text-ink-muted">No debates in progress.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {inProgress.map((row) => (
              <li key={row.id}>
                <DebateRowLink row={row} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
