'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

// The `redirect` query param is attacker-controllable (a crafted login
// link) — only a same-origin relative path is safe to navigate to;
// anything else (an absolute or protocol-relative URL) falls back to '/'
// rather than becoming an open redirect.
function safeRedirect(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')) return raw;
  return '/';
}

// Ported from frontend/src/app/features/auth/login/{login.ts,login.html}.
export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      router.replace(safeRedirect(searchParams.get('redirect')));
    } catch {
      setError('Incorrect username or password.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex h-full items-center justify-center bg-page px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl border border-line bg-ground p-8 shadow-[var(--panel-shadow)]">
        <h1 className="mb-6 font-[family-name:var(--font-display)] text-2xl font-medium text-ink">Log in</h1>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-ink-muted">Username</span>
          <input
            className="w-full rounded-lg border border-line bg-page px-3 py-2 text-ink outline-none focus-visible:outline-2 focus-visible:outline-judge"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="mb-6 block">
          <span className="mb-1 block text-sm text-ink-muted">Password</span>
          <input
            type="password"
            className="w-full rounded-lg border border-line bg-page px-3 py-2 text-ink outline-none focus-visible:outline-2 focus-visible:outline-judge"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="mb-4 text-sm text-divergence">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-convergence px-4 py-2 font-semibold text-page disabled:opacity-50"
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
        <p className="mt-4 text-center text-sm text-ink-muted">
          No account? <Link href="/register" className="text-judge">Register</Link>
        </p>
      </form>
    </main>
  );
}
