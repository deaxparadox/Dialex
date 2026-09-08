'use client';

import { useApiFetch } from './api-fetch';

// Ported field-for-field from frontend/src/app/features/debate/data/debates-api.ts.
export interface ApiPersona {
  id: number;
  name: string;
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
  status_display: string;
  current_round: number;
  max_rounds: number;
  opening_statement: string | null;
  closing_summary: string | null;
  judge_persona: ApiPersona;
  verdict: ApiVerdict | null;
  created_at: string;
  judged_at: string | null;
}

export interface ApiCase {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
}

export function useDebatesApi() {
  const apiFetch = useApiFetch();

  async function listDebates(): Promise<ApiDebate[]> {
    const res = await apiFetch('/api/debates/');
    if (!res.ok) throw new Error('failed to list debates');
    return res.json();
  }

  async function listCases(): Promise<ApiCase[]> {
    const res = await apiFetch('/api/cases/');
    if (!res.ok) throw new Error('failed to list cases');
    return res.json();
  }

  return { listDebates, listCases };
}
