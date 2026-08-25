import { TestBed } from '@angular/core/testing';
import { Theme } from './theme';

describe('Theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-brand');
    document.documentElement.removeAttribute('data-theme');
    TestBed.configureTestingModule({});
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
});
