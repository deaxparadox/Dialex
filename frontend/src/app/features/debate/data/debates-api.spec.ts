import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { DebatesApi } from './debates-api';

describe('DebatesApi', () => {
  let service: DebatesApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DebatesApi);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
