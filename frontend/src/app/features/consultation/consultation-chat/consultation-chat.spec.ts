import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ConsultationChat } from './consultation-chat';
import { Auth } from '../../../core/auth/auth';
import { ConsultationStepStream } from '../data/consultation-step-stream';
import { environment } from '../../../../environments/environment';

describe('ConsultationChat', () => {
  let component: ConsultationChat;
  let fixture: ComponentFixture<ConsultationChat>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConsultationChat],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ConsultationChat);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();

    httpMock.expectOne(`${environment.djangoApiBase}/api/case-type-configs/`).flush([
      { type: 'loan_approval' },
      { type: 'research_debate' },
    ]);
    await fixture.whenStable();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads case types and pre-selects the first one', () => {
    expect(component.caseTypes()).toEqual(['loan_approval', 'research_debate']);
    expect(component.selectedCaseType()).toBe('loan_approval');
  });
});

describe('ConsultationChat step indicator (spec 0023/ADR 0008)', () => {
  let component: ConsultationChat;
  let fixture: ComponentFixture<ConsultationChat>;
  let httpMock: HttpTestingController;
  let fakeStepStream: { connect: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    fakeStepStream = { connect: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [ConsultationChat],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: Auth, useValue: { getAccessToken: () => 'test-token' } },
        { provide: ConsultationStepStream, useValue: fakeStepStream },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConsultationChat);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();

    httpMock.expectOne(`${environment.djangoApiBase}/api/case-type-configs/`).flush([{ type: 'loan_approval' }]);
    await fixture.whenStable();

    const startPromise = component.startConsultation();
    httpMock.expectOne(`${environment.orchestratorApiBase}/api/consultations/`).flush({ session_id: 5 });
    await startPromise;
    await fixture.whenStable();
  });

  it('connects the step stream before the message POST, updates currentStep as steps arrive, and resets it once the POST resolves', async () => {
    component.onDraftInput('What happens next?');
    const sendPromise = component.sendMessage();

    // The step stream must already be connected before the POST is even
    // awaited — verifies the ordering requirement from ADR 0008 decision 5.
    expect(fakeStepStream.connect).toHaveBeenCalledTimes(1);
    const [sessionIdArg, tokenArg, onStep] = fakeStepStream.connect.mock.calls[0];
    expect(sessionIdArg).toBe(5);
    expect(tokenArg).toBe('test-token');
    expect(component.currentStep()).toBe('draft');

    onStep('critique');
    expect(component.currentStep()).toBe('critique');
    onStep('revise');
    expect(component.currentStep()).toBe('revise');

    httpMock
      .expectOne(`${environment.orchestratorApiBase}/api/consultations/5/messages`)
      .flush({ message: 'Understood.', ready_to_finalize: false });
    await sendPromise;

    expect(component.currentStep()).toBeNull();
    expect(component.sending()).toBe(false);
  });
});
