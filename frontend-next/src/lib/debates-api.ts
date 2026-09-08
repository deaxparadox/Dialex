'use client';

import { useApiFetch } from './api-fetch';
import { config } from './config';

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

export interface ApiHumanReview {
  id: number;
  final_decision: string | null;
  comment: string;
  reviewer: number;
  reviewed_at: string;
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
  human_review: ApiHumanReview | null;
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

export interface StartDebateResponse {
  workflow_id: string;
  run_id: string;
}

// Django owns reads (case/debate/argument data); the orchestrator owns
// starting a workflow (spec 0005) — two different bases, same split
// DebatesApi already established, not an inconsistency.
export function useDebatesApi() {
  const apiFetch = useApiFetch();
  const orchestratorFetch = useApiFetch(config.orchestratorApiBase);

  async function getDebate(id: number): Promise<ApiDebate> {
    const res = await apiFetch(`/api/debates/${id}/`);
    if (!res.ok) throw new Error('failed to get debate');
    return res.json();
  }

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

  async function getCase(id: number): Promise<ApiCase> {
    const res = await apiFetch(`/api/cases/${id}/`);
    if (!res.ok) throw new Error('failed to get case');
    return res.json();
  }

  async function getArguments(id: number): Promise<ApiArgument[]> {
    const res = await apiFetch(`/api/debates/${id}/arguments/`);
    if (!res.ok) throw new Error('failed to get arguments');
    return res.json();
  }

  async function startDebate(id: number): Promise<StartDebateResponse> {
    const res = await orchestratorFetch(`/api/debates/${id}/start`, { method: 'POST' });
    if (!res.ok) throw new Error('failed to start debate');
    return res.json();
  }

  // The first real Django POST through this hook — needs the CSRF-cookie
  // round-trip explicitly (spec 0036 stopped defaulting credentials:
  // 'include' on every call, since the orchestrator never needs it; this
  // one, hitting Django's CSRF-protected write path, does).
  async function submitReview(
    id: number,
    body: { final_decision: string | null; comment: string }
  ): Promise<ApiHumanReview> {
    const res = await apiFetch(`/api/debates/${id}/review/`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.status === 409 ? 'already reviewed' : 'failed to submit review');
    return res.json();
  }

  return { getDebate, listDebates, listCases, getCase, getArguments, startDebate, submitReview };
}
