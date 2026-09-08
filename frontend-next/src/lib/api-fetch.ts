'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from './auth-context';
import { config } from './config';

const CSRF_COOKIE_NAME = 'XSRF-TOKEN';
const CSRF_HEADER_NAME = 'X-XSRF-TOKEN';

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function buildHeaders(init: RequestInit | undefined, csrf: string | null, token: string | null): Headers {
  const headers = new Headers(init?.headers);
  if (csrf) headers.set(CSRF_HEADER_NAME, csrf);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

// Ported from frontend/src/app/core/auth/auth-interceptor.ts: attaches the
// CSRF header and bearer token to every call, retries once on 401 via a
// session refresh, and sends the caller to /login if that refresh itself
// fails. There's no HttpClient-style interceptor pipeline in this stack, so
// every API call other than the auth endpoints themselves goes through
// this hook directly.
//
// Deliberately does NOT default to credentials: 'include' — the real
// Angular interceptor this ports never sends cookies either (only Auth's
// own direct login/register/refresh/logout/csrf calls do, bypassing the
// interceptor entirely). Found the hard way: an earlier version of this
// hook hardcoded credentials: 'include' for every call; it went unnoticed
// against Django (already configured with CORS_ALLOW_CREDENTIALS=True) but
// broke every orchestrator call outright, since FastAPI's Bearer-only auth
// never needed cookies and its CORS config correctly didn't allow them —
// a browser rejects any credentialed cross-origin request whose CORS
// response doesn't explicitly allow credentials, regardless of origin.
// A caller that genuinely needs cookies (a future Django POST needing the
// CSRF cookie round-trip) can still pass credentials: 'include' via init.
//
// base defaults to Django — the orchestrator (spec 0036) is the only other
// caller, and passes config.orchestratorApiBase explicitly.
export function useApiFetch(base: string = config.djangoApiBase) {
  const { accessToken, refresh } = useAuth();
  const router = useRouter();

  return async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const csrf = readCookie(CSRF_COOKIE_NAME);
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: buildHeaders(init, csrf, accessToken),
    });
    if (res.status !== 401) return res;

    let newToken: string;
    try {
      newToken = await refresh();
    } catch (err) {
      router.replace('/login');
      throw err;
    }
    return fetch(`${base}${path}`, {
      ...init,
      headers: buildHeaders(init, csrf, newToken),
    });
  };
}
