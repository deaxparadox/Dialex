import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { DebatesList } from './debates-list';
import { ApiCase, ApiDebate } from '../data/debates-api';
import { environment } from '../../../../environments/environment';

const MOCK_CASE: ApiCase = {
  id: 7,
  type: 'loan_approval',
  payload: {},
  status: 'OPEN',
  created_at: '2026-07-18T00:00:00Z',
};

const MOCK_DEBATE: ApiDebate = {
  id: 3,
  case_id: 7,
  turn_strategy: 'sequential',
  status: 'NO_CONSENSUS',
  status_display: 'No consensus',
  current_round: 2,
  max_rounds: 2,
  opening_statement: null,
  closing_summary: null,
  judge_persona: { id: 1, name: 'Moderator', role: 'judge', role_description: '' },
  verdict: null,
  created_at: '2026-08-01T00:00:00Z',
  judged_at: null,
};

function configure(): { fixture: ComponentFixture<DebatesList>; httpMock: HttpTestingController } {
  TestBed.configureTestingModule({
    imports: [DebatesList],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  const fixture = TestBed.createComponent(DebatesList);
  const httpMock = TestBed.inject(HttpTestingController);
  return { fixture, httpMock };
}

describe('DebatesList', () => {
  it('shows a loading state before the requests resolve', () => {
    const { fixture } = configure();
    expect(fixture.componentInstance.loading()).toBe(true);
  });

  it('joins debates with their case type and renders humanized rows', async () => {
    const { fixture, httpMock } = configure();

    httpMock.expectOne(`${environment.djangoApiBase}/api/debates/`).flush([MOCK_DEBATE]);
    httpMock.expectOne(`${environment.djangoApiBase}/api/cases/`).flush([MOCK_CASE]);
    await fixture.whenStable();

    expect(fixture.componentInstance.loading()).toBe(false);
    const rows = fixture.componentInstance.rows();
    expect(rows.length).toBe(1);
    expect(rows[0].caseType).toBe('loan_approval');
    expect(rows[0].statusDisplay).toBe('No consensus');

    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Loan approval');
    expect(text).toContain('No consensus');
  });

  it('shows an empty state with a link to start a new case when there are no debates', async () => {
    const { fixture, httpMock } = configure();

    httpMock.expectOne(`${environment.djangoApiBase}/api/debates/`).flush([]);
    httpMock.expectOne(`${environment.djangoApiBase}/api/cases/`).flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.rows().length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('No debates yet');
  });

  it('shows an error message if the requests fail', async () => {
    const { fixture, httpMock } = configure();

    httpMock.expectOne(`${environment.djangoApiBase}/api/debates/`).flush(
      { detail: 'error' },
      { status: 500, statusText: 'Server Error' }
    );
    httpMock.expectOne(`${environment.djangoApiBase}/api/cases/`).flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.error()).toContain('Could not load');
  });
});
