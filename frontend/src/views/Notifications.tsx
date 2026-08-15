import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BellRing, CheckCheck } from 'lucide-react';
import { getNotifications, markAllNotificationsRead, markNotificationRead } from '@/api/client';
import { cn, formatDate } from '@/lib/utils';

const KIND_ICON: Record<string, string> = {
  TICKET_ASSIGNED: '🎫',
  TICKET_STATUS: '🔄',
  TICKET_COMMENT: '💬',
  REQUEST_ASSIGNED: '📨',
  REQUEST_APPROVED: '✅',
  REQUEST_REJECTED: '⛔',
};

export default function Notifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => getNotifications(100),
  });
  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });
  const markOne = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['unread-count'] }),
  });

  const open = (n: { id: string; ref_type: string | null; ref_id: string | null }) => {
    if (!n.ref_id) return;
    markOne.mutate(n.id);
    if (n.ref_type === 'ticket') navigate(`/tickets?open=${n.ref_id}`);
    else if (n.ref_type === 'service_request') navigate(`/requests?open=${n.ref_id}`);
  };

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-primary">Notifications</h1>
          <p className="text-xs text-muted">
            {(data ?? []).filter((n) => !n.read_at).length} unread · in-app + email mirror
          </p>
        </div>
        {(data ?? []).some((n) => !n.read_at) && (
          <button
            type="button"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs text-accent hover:bg-elevated disabled:opacity-50"
          >
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </button>
        )}
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-muted">Loading…</p>}
      {!isLoading && (data ?? []).length === 0 && (
        <div className="flex flex-col items-center gap-2 py-14 text-muted">
          <BellRing className="h-8 w-8" />
          <p className="text-sm">No notifications yet.</p>
          <p className="text-xs">Ticket assignments, status changes and comments will appear here.</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {(data ?? []).map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => open(n)}
            className={cn(
              'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
              n.read_at ? 'border-edge bg-surface/40' : 'border-accent/30 bg-accent/5 hover:bg-accent/10',
            )}
          >
            <span className="mt-0.5 text-lg">{KIND_ICON[n.kind] ?? '🔔'}</span>
            <span className="min-w-0 flex-1">
              <span className={cn('block text-sm font-medium', n.read_at ? 'text-secondary' : 'text-primary')}>
                {n.title}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-secondary">{n.body}</span>
              <span className="mt-1 block font-mono text-[10px] text-muted">{formatDate(n.created_at)}</span>
            </span>
            {!n.read_at && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />}
          </button>
        ))}
      </div>
    </div>
  );
}
