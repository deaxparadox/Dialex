'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { config } from './config';

const CSRF_COOKIE_NAME = 'XSRF-TOKEN';
const CSRF_HEADER_NAME = 'X-XSRF-TOKEN';

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

interface TokenResponse {
  access: string;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  accessToken: string | null;
  register(username: string, email: string, password: string): Promise<void>;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Ported from frontend/src/app/core/auth/auth.ts (decision 13): the access
// token lives in memory only (useState, never localStorage/a cookie) — the
// refresh token is an HttpOnly cookie this code never reads directly.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const refreshInFlight = useRef<Promise<string> | null>(null);

  async function authFetch(path: string, body?: unknown): Promise<Response> {
    const csrf = readCookie(CSRF_COOKIE_NAME);
    return fetch(`${config.djangoApiBase}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { [CSRF_HEADER_NAME]: csrf } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async function doRefresh(): Promise<string> {
    const res = await authFetch('/api/auth/refresh/');
    if (!res.ok) {
      setAccessToken(null);
      throw new Error('refresh failed');
    }
    const data: TokenResponse = await res.json();
    setAccessToken(data.access);
    return data.access;
  }

  // De-duplicates concurrent 401s: callers await this same in-flight
  // refresh instead of firing one request per failed call.
  function refresh(): Promise<string> {
    if (refreshInFlight.current) {
      return refreshInFlight.current;
    }
    const promise = doRefresh().finally(() => {
      refreshInFlight.current = null;
    });
    refreshInFlight.current = promise;
    return promise;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await fetch(`${config.djangoApiBase}/api/auth/csrf/`, { credentials: 'include' });
      } catch {
        // CSRF bootstrap failing (network blip, backend down) shouldn't
        // strand the whole app in a permanent blank "not ready" state —
        // fall through and still attempt restore below.
      }
      try {
        await refresh();
      } catch {
        // No valid refresh cookie — starting logged out is the correct state.
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on mount only, mirroring Angular's provideAppInitializer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function register(username: string, email: string, password: string): Promise<void> {
    const res = await authFetch('/api/auth/register/', { username, email, password });
    if (!res.ok) throw new Error('register failed');
  }

  async function login(username: string, password: string): Promise<void> {
    const res = await authFetch('/api/auth/login/', { username, password });
    if (!res.ok) throw new Error('login failed');
    const data: TokenResponse = await res.json();
    setAccessToken(data.access);
  }

  async function logout(): Promise<void> {
    try {
      await authFetch('/api/auth/logout/');
    } finally {
      setAccessToken(null);
    }
  }

  // Blocks render until CSRF bootstrap + session restore resolve — the
  // direct port of provideAppInitializer's blocking behavior, so no route
  // ever flashes a logged-out UI while a valid refresh cookie is still
  // being checked.
  if (!ready) return null;

  return (
    <AuthContext.Provider value={{ isAuthenticated: accessToken !== null, accessToken, register, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
