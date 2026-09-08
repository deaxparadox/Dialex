'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

// Ported from frontend/src/app/core/auth/auth-guard.ts's authGuard. Also
// carries a minimal nav bar (Home/Debates/New case/logout) — this route
// group only ever had one page until Phase 2, so nothing needed one before
// now. Not ADR 0011's full nav shell yet (no theme picker/notification
// bell — those need later phases' pages to exist first).
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
  }, [isAuthenticated, pathname, router]);

  if (!isAuthenticated) return null;

  async function onLogout(): Promise<void> {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <nav className="flex flex-shrink-0 items-center justify-between border-b border-line bg-ground px-6 py-3">
        <div className="flex gap-5">
          <Link href="/" className="font-[family-name:var(--font-display)] text-sm font-semibold text-ink">
            Home
          </Link>
          <Link href="/debates" className="text-sm text-ink-muted hover:text-ink">
            Debates
          </Link>
          <Link href="/consultation" className="text-sm text-ink-muted hover:text-ink">
            New case
          </Link>
        </div>
        <button onClick={onLogout} disabled={loggingOut} className="text-sm text-ink-muted hover:text-ink disabled:opacity-50">
          {loggingOut ? 'Logging out…' : 'Log out'}
        </button>
      </nav>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
