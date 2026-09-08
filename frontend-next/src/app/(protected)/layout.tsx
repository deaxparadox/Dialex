'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

// Ported from frontend/src/app/core/auth/auth-guard.ts's authGuard.
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isAuthenticated) router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
  }, [isAuthenticated, pathname, router]);

  if (!isAuthenticated) return null;
  return <>{children}</>;
}
