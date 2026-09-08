'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useNotificationsApi, type ApiNotification } from '@/lib/notifications-api';
import { NotificationRow } from './notification-row';

// Bell + drawer (spec 0040/spec 0032 Phase 4a) — read path only, no live
// badge: populated on load/navigation only, not claiming real-time.
export function NotificationBell() {
  const api = useNotificationsApi();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);

  async function refresh(): Promise<void> {
    try {
      const list = await api.listNotifications();
      setNotifications([...list].sort((a, b) => Number(a.read) - Number(b.read)));
    } catch {
      // Non-critical UI — leave the previous list showing rather than error.
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function onOpenNotification(n: ApiNotification): Promise<void> {
    setOpen(false);
    if (!n.read) {
      await api.markRead(n.id);
      setNotifications((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void refresh();
        }}
        className="relative text-sm text-ink-muted hover:text-ink"
      >
        Notifications
        {unreadCount > 0 && (
          <span className="ml-1 rounded-full bg-divergence px-1.5 py-0.5 text-[10px] font-semibold text-page">
            {unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-80 rounded-[14px] border border-line bg-ground p-3 shadow-[var(--panel-shadow)]">
          {notifications.length === 0 ? (
            <p className="p-2 text-sm text-ink-muted">No notifications.</p>
          ) : (
            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
              {notifications.slice(0, 10).map((n) => (
                <NotificationRow key={n.id} notif={n} onOpen={onOpenNotification} />
              ))}
            </div>
          )}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="mt-2 block text-center text-xs text-judge"
          >
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
