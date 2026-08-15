import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff } from 'lucide-react';
import { getNotifications, getUnreadCount, markAllNotificationsRead, markNotificationRead } from '@/api/client';
import { cn, formatDate } from '@/lib/utils';

const KIND_ICON: Record<string, string> = {
  TICKET_ASSIGNED: '🎫',
  TICKET_STATUS: '🔄',
  TICKET_COMMENT: '💬',
  REQUEST_ASSIGNED: '📨',
  REQUEST_APPROVED: '✅',
  REQUEST_REJECTED: '⛔',
};

export default function NotificationsBell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  // poll unread count every 45s + on visibility regain
  const unread = useQuery({
    queryKey: ['unread-count'],
    queryFn: getUnreadCount,
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
  });
  const items = useQuery({
    queryKey: ['notifications'],
    queryFn: () => getNotifications(15),
    enabled: open,
  });

  useEffect(() => {
    const onFocus = () => {
      qc.invalidateQueries({ queryKey: ['unread-count'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [qc]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const count = visible ? (unread.data?.unread ?? 0) : 0;

  const openItem = (n: { id: string; ref_type: string | null; ref_id: string | null }) => {
    markNotificationRead(n.id).then(() => qc.invalidateQueries({ queryKey: ['unread-count'] }));
    setOpen(false);
    if (n.ref_type === 'ticket') navigate(`/tickets?open=${n.ref_id}`);
    else if (n.ref_type === 'service_request') navigate(`/requests?open=${n.ref_id}`);
  };

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-elevated/60 hover:text-accent"
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-edge bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Notifications</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => markAllNotificationsRead().then(() => {
                  qc.invalidateQueries({ queryKey: ['unread-count'] });
                  qc.invalidateQueries({ queryKey: ['notifications'] });
                })}
                className="rounded px-2 py-0.5 text-[10px] text-accent hover:bg-elevated"
              >
                Mark all read
              </button>
              <button
                type="button"
                onClick={() => {
                  setVisible((v) => !v);
                  if (!visible) qc.invalidateQueries({ queryKey: ['unread-count'] });
                }}
                aria-label="Toggle badge"
                className="rounded px-1.5 py-0.5 text-muted hover:bg-elevated"
              >
                <BellOff className="h-3 w-3" />
              </button>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.data?.length === 0 && (
              <p className="px-4 py-8 text-center text-xs text-muted">No notifications yet.</p>
            )}
            {(items.data ?? []).map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => openItem(n)}
                className={cn(
                  'flex w-full items-start gap-2.5 border-b border-edge/50 px-3 py-2.5 text-left transition-colors hover:bg-elevated/40',
                  !n.read_at && 'bg-accent/5',
                )}
              >
                <span className="mt-0.5 shrink-0 text-sm">{KIND_ICON[n.kind] ?? '🔔'}</span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-xs font-medium', n.read_at ? 'text-secondary' : 'text-primary')}>
                    {n.title}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted">{n.body}</span>
                  <span className="mt-0.5 block font-mono text-[9px] text-muted">{formatDate(n.created_at)}</span>
                </span>
                {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); navigate('/notifications'); }}
            className="block w-full border-t border-edge px-3 py-2 text-center text-[11px] text-accent hover:bg-elevated/40"
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}
