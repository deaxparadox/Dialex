'use client';

import { useApiFetch } from './api-fetch';
import { config } from './config';

// Ported field-for-field from
// frontend/src/app/features/consultation/data/consultations-api.ts.
// decision_options added (spec 0039) — the Human Review panel needs it.
export interface ApiCaseType {
  type: string;
  decision_options: string[];
}

export interface StartConsultationResponse {
  session_id: number;
}

export interface SubmitMessageResponse {
  message: string;
  ready_to_finalize: boolean;
}

export interface ApproveConsultationResponse {
  case_id: number;
  debate_id: number;
}

export class ApiError extends Error {
  constructor(public status: number) {
    super(`request failed with status ${status}`);
  }
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(res.status);
  return res.json();
}

// getCaseTypes hits Django (shared config); the other three hit the
// orchestrator (Temporal-backed) — same split DebatesApi already
// established, not an inconsistency.
export function useConsultationsApi() {
  const djangoFetch = useApiFetch();
  const orchestratorFetch = useApiFetch(config.orchestratorApiBase);

  async function getCaseTypes(): Promise<ApiCaseType[]> {
    return parseOrThrow(await djangoFetch('/api/case-type-configs/'));
  }

  async function startConsultation(caseType: string): Promise<StartConsultationResponse> {
    return parseOrThrow(
      await orchestratorFetch('/api/consultations/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_type: caseType }),
      })
    );
  }

  async function sendMessage(sessionId: number, text: string): Promise<SubmitMessageResponse> {
    return parseOrThrow(
      await orchestratorFetch(`/api/consultations/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
    );
  }

  async function approve(sessionId: number): Promise<ApproveConsultationResponse> {
    return parseOrThrow(await orchestratorFetch(`/api/consultations/${sessionId}/approve`, { method: 'POST' }));
  }

  return { getCaseTypes, startConsultation, sendMessage, approve };
}
