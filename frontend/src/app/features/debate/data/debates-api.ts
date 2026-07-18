import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';

export interface ApiPersona {
  id: number;
  name: string;
  /** participant/consultant/judge — not a display label, see role_description. */
  role: string;
  role_description: string;
}

export interface ApiArgument {
  id: number;
  round_number: number;
  agent_persona: ApiPersona;
  content: string;
  position: string | null;
  confidence: number | null;
  responds_to_id: number | null;
  cites_research_finding_id: number | null;
  /** 0=most divergent, 1=most convergent — computed server-side (spec 0008). */
  leaning: number;
  created_at: string;
}

export interface ApiVerdict {
  id: number;
  decision: string;
  confidence: number;
  reasoning: string;
  cited_arguments: number[];
  created_at: string;
}

export interface ApiDebate {
  id: number;
  case_id: number;
  turn_strategy: string;
  status: string;
  current_round: number;
  max_rounds: number;
  opening_statement: string | null;
  closing_summary: string | null;
  judge_persona: ApiPersona;
  verdict: ApiVerdict | null;
  created_at: string;
  judged_at: string | null;
}

export interface StartDebateResponse {
  workflow_id: string;
  run_id: string;
}

export interface ApiCase {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
}

/** Django owns reads (case/debate/argument data); the orchestrator owns
 * starting a workflow (spec 0005) — two different API bases, matching the
 * architecture split, not an inconsistency. */
@Service()
export class DebatesApi {
  private readonly http = inject(HttpClient);

  getDebate(id: number): Promise<ApiDebate> {
    return firstValueFrom(this.http.get<ApiDebate>(`${environment.djangoApiBase}/api/debates/${id}/`));
  }

  getArguments(id: number): Promise<ApiArgument[]> {
    return firstValueFrom(
      this.http.get<ApiArgument[]>(`${environment.djangoApiBase}/api/debates/${id}/arguments/`)
    );
  }

  getCase(id: number): Promise<ApiCase> {
    return firstValueFrom(this.http.get<ApiCase>(`${environment.djangoApiBase}/api/cases/${id}/`));
  }

  startDebate(id: number): Promise<StartDebateResponse> {
    return firstValueFrom(
      this.http.post<StartDebateResponse>(`${environment.orchestratorApiBase}/api/debates/${id}/start`, {})
    );
  }
}
