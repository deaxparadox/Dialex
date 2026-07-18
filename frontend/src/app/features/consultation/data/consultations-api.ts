import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';

export interface ApiCaseType {
  type: string;
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

/** Django owns the case-type list (shared config); the orchestrator owns
 * the actual consultation (Temporal-backed, spec 0009) — same split as
 * `DebatesApi`, not an inconsistency. */
@Service()
export class ConsultationsApi {
  private readonly http = inject(HttpClient);

  getCaseTypes(): Promise<ApiCaseType[]> {
    return firstValueFrom(
      this.http.get<ApiCaseType[]>(`${environment.djangoApiBase}/api/case-type-configs/`)
    );
  }

  startConsultation(caseType: string): Promise<StartConsultationResponse> {
    return firstValueFrom(
      this.http.post<StartConsultationResponse>(
        `${environment.orchestratorApiBase}/api/consultations/`,
        { case_type: caseType }
      )
    );
  }

  sendMessage(sessionId: number, text: string): Promise<SubmitMessageResponse> {
    return firstValueFrom(
      this.http.post<SubmitMessageResponse>(
        `${environment.orchestratorApiBase}/api/consultations/${sessionId}/messages`,
        { text }
      )
    );
  }

  approve(sessionId: number): Promise<ApproveConsultationResponse> {
    return firstValueFrom(
      this.http.post<ApproveConsultationResponse>(
        `${environment.orchestratorApiBase}/api/consultations/${sessionId}/approve`,
        {}
      )
    );
  }
}
