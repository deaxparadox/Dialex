import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { Theme } from './core/theme/theme';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
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
});
