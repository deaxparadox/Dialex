import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { Theme } from './core/theme/theme';

// The test environment (jsdom, via @angular/build:unit-test) doesn't
// implement window.matchMedia at all, but app.html's mode-toggle button
// reads Theme.effectiveMode() on every render, which calls matchMedia
// directly when mode() is null ("follow system"). Stub it so tests can
// control which OS preference the app observes.
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

describe('App', () => {
  beforeEach(async () => {
    mockMatchMedia(false);
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-brand');
    document.documentElement.removeAttribute('data-theme');
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the router outlet', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });

  it('renders theme controls when authenticated', async () => {
    localStorage.clear();
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    app.auth._accessToken.set('fake-token'); // isAuthenticated() becomes true
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const select = compiled.querySelector('select.theme-brand-select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(compiled.querySelector('button.theme-mode-toggle')).toBeTruthy();

    const theme = TestBed.inject(Theme);
    select.value = 'electric';
    select.dispatchEvent(new Event('change'));
    expect(theme.brand()).toBe('electric');
  });

  it('mode-toggle label matches the actually-rendered mode when unset and the system prefers dark', async () => {
    // Regression test for the label/action mismatch: with mode() null and
    // the OS preferring dark, the page is already dark, so the button must
    // read "Switch to light mode" (and clicking it must actually switch to
    // light) — not "Switch to dark mode", which would contradict what's on
    // screen and do nothing visible when clicked.
    mockMatchMedia(true);
    localStorage.clear();
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    app.auth._accessToken.set('fake-token');
    await fixture.whenStable();
    fixture.detectChanges();

    const theme = TestBed.inject(Theme);
    expect(theme.mode()).toBeNull();
    expect(theme.effectiveMode()).toBe('dark');

    const compiled = fixture.nativeElement as HTMLElement;
    const button = compiled.querySelector('button.theme-mode-toggle') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Switch to light mode');
    expect(button.textContent?.trim()).toBe('☾');

    button.click();
    expect(theme.mode()).toBe('light');
  });
});
