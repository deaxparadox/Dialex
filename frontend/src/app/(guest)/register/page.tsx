'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

// Ported from frontend/src/app/features/auth/register/{register.ts,register.html}.
export default function RegisterPage() {
  const { register, login } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await register(username, email, password);
      // Simpler UX than forcing a second manual login right after registering.
      await login(username, password);
      router.replace('/');
    } catch {
      setError('Could not register with these details.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex h-full items-center justify-center bg-page px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl border border-line bg-ground p-8 shadow-[var(--panel-shadow)]">
        <h1 className="mb-6 font-[family-name:var(--font-display)] text-2xl font-medium text-ink">Register</h1>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-ink-muted">Username</span>
          <input
            className="w-full rounded-lg border border-line bg-page px-3 py-2 text-ink outline-none focus-visible:outline-2 focus-visible:outline-judge"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-ink-muted">Email</span>
          <input
            type="email"
            className="w-full rounded-lg border border-line bg-page px-3 py-2 text-ink outline-none focus-visible:outline-2 focus-visible:outline-judge"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-ink-muted">Password</span>
          <input
            type="password"
            className="w-full rounded-lg border border-line bg-page px-3 py-2 text-ink outline-none focus-visible:outline-2 focus-visible:outline-judge"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <label className="mb-6 block">
          <span className="mb-1 block text-sm text-ink-muted">Confirm password</span>
          <input
            type="password"
            className="w-full rounded-lg border border-line bg-page px-3 py-2 text-ink outline-none focus-visible:outline-2 focus-visible:outline-judge"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="mb-4 text-sm text-divergence">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-convergence px-4 py-2 font-semibold text-page disabled:opacity-50"
        >
          {submitting ? 'Registering…' : 'Register'}
        </button>
        <p className="mt-4 text-center text-sm text-ink-muted">
          Already have an account? <Link href="/login" className="text-judge">Log in</Link>
        </p>
      </form>
    </main>
  );
}
