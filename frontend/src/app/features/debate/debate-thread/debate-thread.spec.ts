import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { DebateThread } from './debate-thread';
import { ApiArgument, ApiCase, ApiDebate } from '../data/debates-api';
import { environment } from '../../../../environments/environment';
import { Auth } from '../../../core/auth/auth';
import { DebateStream } from '../data/debate-stream';

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

const MOCK_ACTIVE_DEBATE: ApiDebate = { ...MOCK_DEBATE, status: 'ARGUING', verdict: null };

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

function configureWithRoute(
  routeParams: Record<string, string>,
  queryParams: Record<string, string> = {},
  extraProviders: unknown[] = [],
): void {
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
      ...extraProviders,
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

  it('fetches and renders real data for a given :id, grouping by round and left/right by agent (spec 0016)', async () => {
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
    expect(component.roundNumbers()).toEqual([1, 2]);
    expect(component.argumentsInRound(1).map((a) => a.id)).toEqual(['1']);
    expect(component.argumentsInRound(2).map((a) => a.id)).toEqual(['2']);
    // First-seen agent (Agent R, round 1) renders left; the second (Agent G) right.
    expect(component.isLeft(component.arguments()[0].agentId)).toBe(true);
    expect(component.isLeft(component.arguments()[1].agentId)).toBe(false);
    expect(component.arguments()[1].respondsToLabel).toBe('Responds to Agent R, round 1');

    httpMock.verify();
  });

  it('opens a WebSocket stream (not polling) once an active debate loads (spec 0014)', async () => {
    const fakeStream = { connect: vi.fn(), disconnect: vi.fn() };
    configureWithRoute({ id: '3' }, {}, [
      { provide: DebateStream, useValue: fakeStream },
      { provide: Auth, useValue: { getAccessToken: () => 'test-token' } },
    ]);
    const fixture = TestBed.createComponent(DebateThread);
    const httpMock = TestBed.inject(HttpTestingController);

    await fixture.whenStable();
    httpMock.expectOne(`${environment.djangoApiBase}/api/debates/3/`).flush(MOCK_ACTIVE_DEBATE);
    httpMock.expectOne(`${environment.djangoApiBase}/api/debates/3/arguments/`).flush(MOCK_ARGUMENTS);
    await Promise.resolve();
    await Promise.resolve();
    httpMock.expectOne(`${environment.djangoApiBase}/api/cases/7/`).flush(MOCK_CASE);
    await fixture.whenStable();

    expect(fakeStream.connect).toHaveBeenCalledTimes(1);
    expect(fakeStream.connect).toHaveBeenCalledWith(3, 'test-token', expect.any(Function), expect.any(Function));

    httpMock.verify();
  });

  it('re-fetches on a stream message, and falls back to polling with a visible warning on an unexpected drop', async () => {
    const fakeStream = { connect: vi.fn(), disconnect: vi.fn() };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    configureWithRoute({ id: '3' }, {}, [
      { provide: DebateStream, useValue: fakeStream },
      { provide: Auth, useValue: { getAccessToken: () => 'test-token' } },
    ]);
    const fixture = TestBed.createComponent(DebateThread);
    const httpMock = TestBed.inject(HttpTestingController);

    await fixture.whenStable();
    httpMock.expectOne(`${environment.djangoApiBase}/api/debates/3/`).flush(MOCK_ACTIVE_DEBATE);
    httpMock.expectOne(`${environment.djangoApiBase}/api/debates/3/arguments/`).flush(MOCK_ARGUMENTS);
    await Promise.resolve();
    await Promise.resolve();
    httpMock.expectOne(`${environment.djangoApiBase}/api/cases/7/`).flush(MOCK_CASE);
    await fixture.whenStable();

    const [, , onMessage, onUnexpectedClose] = fakeStream.connect.mock.calls[0];

    onMessage({ type: 'status_change', status: 'ARGUING' });
    httpMock.expectOne(`${environment.djangoApiBase}/api/debates/3/`).flush(MOCK_ACTIVE_DEBATE);
    httpMock.expectOne(`${environment.djangoApiBase}/api/debates/3/arguments/`).flush(MOCK_ARGUMENTS);
    await fixture.whenStable();

    onUnexpectedClose();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('falling back to polling'));

    fixture.destroy(); // clears the polling interval the fallback just started
    httpMock.verify();
    warnSpy.mockRestore();
  });

  it('sets generatingTurn on turn_started without re-fetching, and clears it once the turn completes (spec 0018/0019)', async () => {
    const fakeStream = { connect: vi.fn(), disconnect: vi.fn() };
    configureWithRoute({ id: '3' }, {}, [
      { provide: DebateStream, useValue: fakeStream },
      { provide: Auth, useValue: { getAccessToken: () => 'test-token' } },
    ]);
    const fixture = TestBed.createComponent(DebateThread);
    const httpMock = TestBed.inject(HttpTestingController);

    await fixture.whenStable();
    httpMock.expectOne(`${environment.djangoApiBase}/api/debates/3/`).flush(MOCK_ACTIVE_DEBATE);
    httpMock.expectOne(`${environment.djangoApiBase}/api/debates/3/arguments/`).flush(MOCK_ARGUMENTS);
    await Promise.resolve();
    await Promise.resolve();
    httpMock.expectOne(`${environment.djangoApiBase}/api/cases/7/`).flush(MOCK_CASE);
    await fixture.whenStable();

    const [, , onMessage] = fakeStream.connect.mock.calls[0];
    const component = fixture.componentInstance;

    onMessage({
      type: 'turn_started',
      agent_persona_id: 4,
      agent_name: 'New Agent',
      stage: 'argument',
      round_number: 2,
    });
    await fixture.whenStable();

    expect(component.generatingTurn()).toEqual({
      agentPersonaId: 4,
      agentName: 'New Agent',
      stage: 'argument',
      roundNumber: 2,
    });
    // A brand-new agent never seen in arguments() still gets a side to render on.
    expect(component.isLeft(4)).toBe(false);
    // Its round (backend round_number 2 -> display round 3) is included even
    // though no real argument for it exists yet.
    expect(component.roundsToRender()).toEqual([1, 2, 3]);
    httpMock.expectNone(`${environment.djangoApiBase}/api/debates/3/`); // no re-fetch for a transient event

    onMessage({ type: 'argument_complete', argument_id: 99 });
    httpMock.expectOne(`${environment.djangoApiBase}/api/debates/3/`).flush(MOCK_ACTIVE_DEBATE);
    httpMock.expectOne(`${environment.djangoApiBase}/api/debates/3/arguments/`).flush(MOCK_ARGUMENTS);
    await fixture.whenStable();

    expect(component.generatingTurn()).toBeNull();

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
