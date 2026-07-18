import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { Router } from '@angular/router';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';

import { Auth } from './auth';
import { environment } from '../../../environments/environment';

const AUTH_ENDPOINT = '/api/auth/';
const CSRF_COOKIE_NAME = 'XSRF-TOKEN';
const CSRF_HEADER_NAME = 'X-XSRF-TOKEN';

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Angular's built-in XSRF interceptor deliberately skips cross-origin
 * requests (verified against its source) — it compares the request's
 * origin to the page's own and no-ops if they differ, as a security
 * default. That's exactly our case (:4200 → :8000), so the header has to
 * be attached explicitly here for the one origin we actually trust. */
function withCsrfHeader(req: HttpRequest<unknown>): HttpRequest<unknown> {
  if (!req.url.startsWith(environment.djangoApiBase) || req.headers.has(CSRF_HEADER_NAME)) {
    return req;
  }
  const token = readCookie(CSRF_COOKIE_NAME);
  return token ? req.clone({ setHeaders: { [CSRF_HEADER_NAME]: token } }) : req;
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const router = inject(Router);

  const withCsrf = withCsrfHeader(req);

  // Login/register/refresh/logout/csrf are unauthenticated by nature (or
  // use the refresh cookie directly) — never attach a bearer token, and
  // never attempt a refresh-retry loop against them.
  if (req.url.includes(AUTH_ENDPOINT)) {
    return next(withCsrf);
  }

  const token = auth.getAccessToken();
  const authedReq = token ? withCsrf.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : withCsrf;

  return next(authedReq).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }
      return from(auth.refresh()).pipe(
        switchMap((newToken) =>
          next(withCsrf.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } }))
        ),
        catchError((refreshError: unknown) => {
          router.navigate(['/login']);
          return throwError(() => refreshError);
        })
      );
    })
  );
};
