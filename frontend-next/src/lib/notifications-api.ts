'use client';

import { useApiFetch } from './api-fetch';

export interface ApiNotification {
  id: number;
  type: string;
  message: string;
  related_case: number | null;
  related_debate: number | null;
  read: boolean;
  created_at: string;
}

export function useNotificationsApi() {
  const apiFetch = useApiFetch();

  async function listNotifications(): Promise<ApiNotification[]> {
    const res = await apiFetch('/api/notifications/');
    if (!res.ok) throw new Error('failed to list notifications');
    return res.json();
  }

  // Django PATCH — needs the CSRF-cookie round-trip explicitly, same as
  // spec 0039's submitReview.
  async function markRead(id: number): Promise<ApiNotification> {
    const res = await apiFetch(`/api/notifications/${id}/`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    });
    if (!res.ok) throw new Error('failed to mark notification read');
    return res.json();
  }

  return { listNotifications, markRead };
}
