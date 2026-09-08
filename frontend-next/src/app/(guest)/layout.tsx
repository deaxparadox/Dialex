'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

// Ported from frontend/src/app/core/auth/auth-guard.ts's guestGuard: keeps
// an already-authenticated user off /login and /register.
export default function GuestLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated) router.replace('/');
  }, [isAuthenticated, router]);

  if (isAuthenticated) return null;
  return <>{children}</>;
}
