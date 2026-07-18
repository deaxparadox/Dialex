import { TestBed } from '@angular/core/testing';

import { DebateStream } from './debate-stream';

describe('DebateStream', () => {
  let service: DebateStream;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DebateStream);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
