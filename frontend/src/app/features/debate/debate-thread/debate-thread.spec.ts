import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DebateThread } from './debate-thread';

describe('DebateThread', () => {
  let component: DebateThread;
  let fixture: ComponentFixture<DebateThread>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DebateThread],
    }).compileComponents();

    fixture = TestBed.createComponent(DebateThread);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
