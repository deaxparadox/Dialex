'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useDebatesApi } from '@/lib/debates-api';
import { buildRows, type DebateRow } from '@/lib/debate-rows';
import { DebateRowLink } from '../_components/debate-row-link';

// Ported from frontend/src/app/features/debate/debates-list — the full,
// unbucketed archive (a superset of Home's curated excerpt, ADR 0011
// decision 1).
export default function DebatesPage() {
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
    // Runs once on mount, matching debates-list.ts's constructor-triggered load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-ink-muted">Loading your debates…</div>;
  }
  if (error) {
    return <div className="flex h-full items-center justify-center text-divergence">{error}</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-muted">
        <p>
          No debates yet. <Link href="/consultation" className="text-judge">Start your first case</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto p-6">
      <h1 className="mb-4 font-[family-name:var(--font-display)] text-xl text-ink">My debates</h1>
      <ul className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <li key={row.id}>
            <DebateRowLink row={row} />
          </li>
        ))}
      </ul>
    </div>
  );
}
