'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';

// Minimal placeholder — just enough to prove the auth loop end to end.
// The real Home dashboard is Phase 2 (ADR 0011's bucketed "My debates" view).
// No username is shown: the access token's JWT claims carry only user_id
// (SessionTaggingTokenObtainPairSerializer adds session_id, nothing else),
// and adding a backend field/endpoint just for this placeholder is out of
// scope for Phase 1.
export default function HomePage() {
  const { logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function onLogout(): Promise<void> {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 bg-page text-ink">
      <p className="font-[family-name:var(--font-display)] text-xl">You&apos;re logged in.</p>
      <button
        onClick={onLogout}
        disabled={loggingOut}
        className="rounded-lg bg-divergence px-4 py-2 font-semibold text-page disabled:opacity-50"
      >
        {loggingOut ? 'Logging out…' : 'Log out'}
      </button>
    </main>
  );
}
