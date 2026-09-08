import type { ApiCase, ApiDebate } from './debates-api';

// Ported from frontend/src/app/features/debate/debates-list/debates-list.ts —
// shared by both the full archive (/debates) and the Home dashboard's
// buckets, which is why it lives here rather than in one page.
export interface DebateRow {
  id: number;
  caseType: string | null;
  status: string;
  statusDisplay: string;
  createdAt: string;
}

export function buildRows(debates: ApiDebate[], cases: ApiCase[]): DebateRow[] {
  const caseById = new Map(cases.map((c) => [c.id, c]));
  return debates.map((d) => ({
    id: d.id,
    caseType: caseById.get(d.case_id)?.type ?? null,
    status: d.status,
    statusDisplay: d.status_display,
    createdAt: d.created_at,
  }));
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}
