import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { DebateThread } from './debate-thread';

async function createComponent(params: Record<string, string> = {}): Promise<ComponentFixture<DebateThread>> {
  TestBed.configureTestingModule({
    imports: [DebateThread],
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(params) } } },
    ],
  });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(DebateThread);
  await fixture.whenStable();
  return fixture;
}

describe('DebateThread', () => {
  it('should create', async () => {
    const fixture = await createComponent();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('defaults mode/selected when no query params are present (spec 0007)', async () => {
    const fixture = await createComponent();
    // Defaults to the streaming argument (c3 in the mock data) when present.
    expect(fixture.componentInstance.mode()).toBe('detail');
    expect(fixture.componentInstance.selectedId()).toBe('c3');
  });

  it('reads valid mode/selected query params on init', async () => {
    const fixture = await createComponent({ mode: 'minimal', selected: 'g2' });
    expect(fixture.componentInstance.mode()).toBe('minimal');
    expect(fixture.componentInstance.selectedId()).toBe('g2');
  });

  it('falls back to defaults when query params are invalid', async () => {
    const fixture = await createComponent({ mode: 'bogus', selected: 'does-not-exist' });
    expect(fixture.componentInstance.mode()).toBe('detail');
    expect(fixture.componentInstance.selectedId()).toBe('c3');
  });
});
