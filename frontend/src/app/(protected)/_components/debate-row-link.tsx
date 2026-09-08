import Link from 'next/link';
import { humanizeSlug } from '@/lib/humanize-slug';
import { formatDate, type DebateRow } from '@/lib/debate-rows';

// Shared row markup for both the Home dashboard's buckets and the full
// /debates archive — same visual shape debates-list.css used.
export function DebateRowLink({ row }: { row: DebateRow }) {
  return (
    <Link
      href={`/debates/${row.id}`}
      className="flex items-center justify-between gap-3 rounded-lg bg-ground px-4 py-3 text-ink shadow-[var(--panel-shadow)] transition-colors hover:bg-line"
    >
      <span className="flex-1 font-semibold">{row.caseType ? humanizeSlug(row.caseType) : `Case #${row.id}`}</span>
      <span className="text-sm text-ink-muted">{row.statusDisplay}</span>
      <span className="text-xs text-ink-faint">{formatDate(row.createdAt)}</span>
    </Link>
  );
}
