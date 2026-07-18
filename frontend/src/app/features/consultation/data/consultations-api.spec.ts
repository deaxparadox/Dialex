import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { ConsultationsApi } from './consultations-api';

describe('ConsultationsApi', () => {
  let service: ConsultationsApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ConsultationsApi);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
