import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ConsultationChat } from './consultation-chat';
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
