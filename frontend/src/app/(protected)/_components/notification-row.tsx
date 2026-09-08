import Link from 'next/link';
import type { ApiNotification } from '@/lib/notifications-api';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function NotificationRow({ notif, onOpen }: { notif: ApiNotification; onOpen: (n: ApiNotification) => void }) {
  const body = (
    <div className={`rounded-lg border border-line p-3 ${notif.read ? 'bg-page' : 'bg-status-action-bg'}`}>
      <p className="text-sm text-ink">{notif.message}</p>
      <p className="mt-1 text-[11px] text-ink-faint">{formatDate(notif.created_at)}</p>
    </div>
  );

  if (notif.related_debate) {
    return (
      <Link href={`/debates/${notif.related_debate}`} onClick={() => onOpen(notif)}>
        {body}
      </Link>
    );
  }
  return (
    <button className="w-full text-left" onClick={() => onOpen(notif)}>
      {body}
    </button>
  );
}
