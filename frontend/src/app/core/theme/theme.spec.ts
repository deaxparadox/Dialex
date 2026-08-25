import { TestBed } from '@angular/core/testing';
import { Theme } from './theme';

// The test environment (jsdom, via @angular/build:unit-test) doesn't
// implement window.matchMedia at all, but Theme.effectiveMode() calls it
// directly (per its spec) to resolve "follow system". Stub it so tests can
// control which OS preference Theme observes.
function mockMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

describe('Theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-brand');
    document.documentElement.removeAttribute('data-theme');
    mockMatchMedia(false);
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-brand');
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to citrus brand and no explicit mode', () => {
    const service = TestBed.inject(Theme);
    expect(service.brand()).toBe('citrus');
    expect(service.mode()).toBeNull();
  });

  it('applies the default brand to the document on construction', () => {
    TestBed.inject(Theme);
    expect(document.documentElement.getAttribute('data-brand')).toBe('citrus');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('setBrand updates the signal, the DOM, and persists to localStorage', () => {
    const service = TestBed.inject(Theme);
    service.setBrand('electric');
    expect(service.brand()).toBe('electric');
    expect(document.documentElement.getAttribute('data-brand')).toBe('electric');
    expect(localStorage.getItem('dialex-theme-brand')).toBe('electric');
  });

  it('setMode updates the signal, the DOM, and persists to localStorage', () => {
    const service = TestBed.inject(Theme);
    service.setMode('dark');
    expect(service.mode()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('dialex-theme-mode')).toBe('dark');
  });

  it('setMode(null) clears the explicit override', () => {
    const service = TestBed.inject(Theme);
    service.setMode('dark');
    service.setMode(null);
    expect(service.mode()).toBeNull();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('dialex-theme-mode')).toBeNull();
  });

  it('reads a persisted brand/mode back on construction', () => {
    localStorage.setItem('dialex-theme-brand', 'electric');
    localStorage.setItem('dialex-theme-mode', 'dark');
    const service = TestBed.inject(Theme);
    expect(service.brand()).toBe('electric');
    expect(service.mode()).toBe('dark');
    expect(document.documentElement.getAttribute('data-brand')).toBe('electric');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('effectiveMode() resolves an explicit mode without consulting matchMedia', () => {
    const service = TestBed.inject(Theme);
    service.setMode('dark');
    expect(service.effectiveMode()).toBe('dark');
    service.setMode('light');
    expect(service.effectiveMode()).toBe('light');
  });

  it('effectiveMode() falls back to the system preference when mode is unset', () => {
    mockMatchMedia(true); // OS prefers dark
    const service = TestBed.inject(Theme);
    expect(service.mode()).toBeNull();
    expect(service.effectiveMode()).toBe('dark');
  });

  it('effectiveMode() resolves to light when mode is unset and the system prefers light', () => {
    mockMatchMedia(false);
    const service = TestBed.inject(Theme);
    expect(service.mode()).toBeNull();
    expect(service.effectiveMode()).toBe('light');
  });
});
