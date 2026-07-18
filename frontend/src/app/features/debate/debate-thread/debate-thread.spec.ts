import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { DebateThread } from './debate-thread';
import { ApiArgument, ApiCase, ApiDebate } from '../data/debates-api';
import { environment } from '../../../../environments/environment';

const MOCK_CASE: ApiCase = {
  id: 7,
  type: 'loan_approval',
  payload: { applicant: 'Maria Chen' },
  status: 'OPEN',
  created_at: '2026-07-18T00:00:00Z',
};

const MOCK_DEBATE: ApiDebate = {
  id: 3,
  case_id: 7,
  turn_strategy: 'sequential',
  status: 'JUDGED',
  current_round: 2,
  max_rounds: 2,
  opening_statement: 'Opening.',
  closing_summary: 'Closing.',
  judge_persona: { id: 1, name: 'Moderator', role: 'judge', role_description: '' },
  verdict: {
    id: 1,
    decision: 'approve',
    confidence: 0.85,
    reasoning: 'Solid case.',
    cited_arguments: [2],
    created_at: '2026-07-18T00:00:00Z',
  },
  created_at: '2026-07-18T00:00:00Z',
  judged_at: '2026-07-18T00:05:00Z',
};

const MOCK_ARGUMENTS: ApiArgument[] = [
  {
    id: 1,
    round_number: 0,
    agent_persona: { id: 2, name: 'Agent R', role: 'participant', role_description: 'Risk' },
    content: 'DTI too high.',
    position: 'reject',
    confidence: 0.8,
    responds_to_id: null,
    cites_research_finding_id: null,
    leaning: 0,
    created_at: '2026-07-18T00:00:00Z',
  },
  {
    id: 2,
    round_number: 1,
    agent_persona: { id: 3, name: 'Agent G', role: 'participant', role_description: 'Growth' },
    content: 'Co-signer covers it.',
    position: 'approve',
    confidence: 0.9,
    responds_to_id: 1,
    cites_research_finding_id: null,
    leaning: 1,
    created_at: '2026-07-18T00:00:00Z',
  },
];

function configureWithRoute(routeParams: Record<string, string>, queryParams: Record<string, string> = {}): void {
  TestBed.configureTestingModule({
    imports: [DebateThread],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap(routeParams),
            queryParamMap: convertToParamMap(queryParams),
          },
        },
      },
    ],
  });
}

describe('DebateThread', () => {
  it('shows the empty state when no :id route param is present', async () => {
    configureWithRoute({});
    const fixture = TestBed.createComponent(DebateThread);
    await fixture.whenStable();

    expect(fixture.componentInstance.noDebateSelected()).toBe(true);
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('fetches and renders real data for a given :id, defaulting selection to the latest argument', async () => {
    configureWithRoute({ id: '3' });
    const fixture = TestBed.createComponent(DebateThread);
    const httpMock = TestBed.inject(HttpTestingController);

    await fixture.whenStable();

    httpMock.expectOne(`${environment.djangoApiBase}/api/debates/3/`).flush(MOCK_DEBATE);
    httpMock.expectOne(`${environment.djangoApiBase}/api/debates/3/arguments/`).flush(MOCK_ARGUMENTS);
    // Let the `Promise.all` continuation run (which is what fires the case
    // request) before expecting it — a plain microtask tick, not a real delay.
    await Promise.resolve();
    await Promise.resolve();
    httpMock.expectOne(`${environment.djangoApiBase}/api/cases/7/`).flush(MOCK_CASE);
    await fixture.whenStable();

    const component = fixture.componentInstance;
    expect(component.loading()).toBe(false);
    expect(component.notFound()).toBe(false);
    expect(component.arguments().length).toBe(2);
    // Defaults to the last argument (round order) when no ?selected= param — no
    // "streaming" concept exists for real data (spec 0008).
    expect(component.selectedId()).toBe('2');
    expect(component.arguments()[1].respondsToLabel).toBe('Responds to Agent R, round 1');

    httpMock.verify();
  });

  it('shows the not-found state on a 404', async () => {
    configureWithRoute({ id: '999' });
    const fixture = TestBed.createComponent(DebateThread);
    const httpMock = TestBed.inject(HttpTestingController);

    await fixture.whenStable();
    httpMock.expectOne(`${environment.djangoApiBase}/api/debates/999/`).flush(
      { detail: 'Not found' },
      { status: 404, statusText: 'Not Found' },
    );
    httpMock.expectOne(`${environment.djangoApiBase}/api/debates/999/arguments/`).flush([]);
    // Promise.all rejects as soon as the first request errors, but that
    // rejection still needs a microtask tick to propagate into the
    // component's catch block — whenStable() alone isn't enough to
    // guarantee that in a zoneless app (ADR 0001).
    await Promise.resolve();
    await Promise.resolve();
    await fixture.whenStable();

    expect(fixture.componentInstance.notFound()).toBe(true);
    expect(fixture.componentInstance.loading()).toBe(false);

    httpMock.verify();
  });
});
