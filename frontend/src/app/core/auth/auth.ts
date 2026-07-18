import { Service, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';

interface TokenResponse {
  access: string;
}

/** Access token lives in memory only, never `localStorage` (decision 13) —
 * the refresh token is an HttpOnly cookie the frontend never touches
 * directly. `@Service()` (Angular 22) over `@Injectable`: root-scoped by
 * default, `inject()`-only, no constructor DI needed here. */
@Service()
export class Auth {
  private readonly http = inject(HttpClient);

  private readonly _accessToken = signal<string | null>(null);
  readonly isAuthenticated = computed(() => this._accessToken() !== null);

  /** De-duplicates concurrent 401s: the interceptor awaits this same
   * in-flight refresh instead of firing one per failed request. */
  private refreshInFlight: Promise<string> | null = null;

  getAccessToken(): string | null {
    return this._accessToken();
  }

  clearSession(): void {
    this._accessToken.set(null);
  }

  async bootstrapCsrf(): Promise<void> {
    await firstValueFrom(
      this.http.get(`${environment.djangoApiBase}/api/auth/csrf/`, { withCredentials: true })
    );
  }

  /** Called once at app startup, after `bootstrapCsrf`. The access token
   * only ever lives in memory (decision 13), so it's gone after any hard
   * navigation/reload — without this, a valid `refresh_token` cookie would
   * be silently wasted and every reload would force a fresh login. Failure
   * here just means "no valid session," not an error — swallowed on
   * purpose, there's nothing to log in as yet. */
  async restoreSession(): Promise<void> {
    try {
      await this.refresh();
    } catch {
      // No valid refresh cookie — starting logged out is the correct state.
    }
  }

  async register(username: string, email: string, password: string): Promise<void> {
    await firstValueFrom(
      this.http.post(
        `${environment.djangoApiBase}/api/auth/register/`,
        { username, email, password },
        { withCredentials: true }
      )
    );
  }

  async login(username: string, password: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<TokenResponse>(
        `${environment.djangoApiBase}/api/auth/login/`,
        { username, password },
        { withCredentials: true }
      )
    );
    this._accessToken.set(response.access);
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`${environment.djangoApiBase}/api/auth/logout/`, {}, { withCredentials: true })
      );
    } finally {
      this.clearSession();
    }
  }

  /** Called by the interceptor on a 401 — never call directly from a
   * component. Clears the session (rather than leaving stale state) if
   * the refresh cookie itself is missing/invalid. */
  refresh(): Promise<string> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.doRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async doRefresh(): Promise<string> {
    try {
      const response = await firstValueFrom(
        this.http.post<TokenResponse>(
          `${environment.djangoApiBase}/api/auth/refresh/`,
          {},
          { withCredentials: true }
        )
      );
      this._accessToken.set(response.access);
      return response.access;
    } catch (err) {
      this.clearSession();
      throw err;
    }
  }
}
