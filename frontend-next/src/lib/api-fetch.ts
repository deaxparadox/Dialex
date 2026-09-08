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
export function useApiFetch() {
  const { accessToken, refresh } = useAuth();
  const router = useRouter();

  return async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const csrf = readCookie(CSRF_COOKIE_NAME);
    const res = await fetch(`${config.djangoApiBase}${path}`, {
      ...init,
      credentials: 'include',
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
    return fetch(`${config.djangoApiBase}${path}`, {
      ...init,
      credentials: 'include',
      headers: buildHeaders(init, csrf, newToken),
    });
  };
}
