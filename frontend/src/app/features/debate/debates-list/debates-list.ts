import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { HumanizeSlugPipe } from '../../../shared/pipes/humanize-slug-pipe';
import { ApiCase, ApiDebate, DebatesApi } from '../data/debates-api';

export interface DebateRow {
  id: number;
  caseType: string | null;
  statusDisplay: string;
  createdAt: string;
}

function buildRows(debates: ApiDebate[], cases: ApiCase[]): DebateRow[] {
  const caseById = new Map(cases.map((c) => [c.id, c]));
  return debates.map((d) => ({
    id: d.id,
    caseType: caseById.get(d.case_id)?.type ?? null,
    statusDisplay: d.status_display,
    createdAt: d.created_at,
  }));
}

@Component({
  selector: 'app-debates-list',
  imports: [RouterLink, HumanizeSlugPipe],
  templateUrl: './debates-list.html',
  styleUrl: './debates-list.css',
})
export class DebatesList {
  private readonly api = inject(DebatesApi);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<DebateRow[]>([]);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [debates, cases] = await Promise.all([this.api.listDebates(), this.api.listCases()]);
      this.rows.set(buildRows(debates, cases));
    } catch {
      this.error.set('Could not load your debates — please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  dateFor(iso: string): string {
    return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
