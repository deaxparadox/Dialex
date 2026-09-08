'use client';

import { useEffect, useState } from 'react';
import { useNotificationsApi, type ApiNotification } from '@/lib/notifications-api';
import { NotificationRow } from '../_components/notification-row';

// Full archive (spec 0040/spec 0032 Phase 4a) — same list data the bell
// drawer shows, rendered as a page instead of a dropdown. No new backend
// shape beyond the list endpoint.
export default function NotificationsPage() {
  const api = useNotificationsApi();
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);

  useEffect(() => {
    (async () => {
      try {
        setNotifications(await api.listNotifications());
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onOpenNotification(n: ApiNotification): Promise<void> {
    if (!n.read) {
      await api.markRead(n.id);
      setNotifications((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    }
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-ink-muted">Loading notifications…</div>;
  }

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto p-6">
      <h1 className="mb-4 font-[family-name:var(--font-display)] text-xl text-ink">Notifications</h1>
      {notifications.length === 0 ? (
        <p className="text-sm text-ink-muted">No notifications.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {notifications.map((n) => (
            <NotificationRow key={n.id} notif={n} onOpen={onOpenNotification} />
          ))}
        </div>
      )}
    </div>
  );
}
