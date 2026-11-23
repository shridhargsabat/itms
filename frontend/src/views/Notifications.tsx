import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BellRing, CheckCheck } from 'lucide-react';
import { getNotifications, getUnreadCount, markAllNotificationsRead, markNotificationRead } from '@/api/client';
import { cn, formatDate } from '@/lib/utils';
import { Button } from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import PageHeader from '@/components/PageHeader';
import { useServerPagination } from '@/lib/usePagination';
import PaginationFooter from '@/components/PaginationFooter';

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
  const { page, pageSize, setPage, setPageSize, offset } = useServerPagination(20);
  const { data, isLoading } = useQuery({
    queryKey: ['notifications', page, pageSize],
    queryFn: () => getNotifications({ limit: pageSize, offset }),
  });
  // Unread badge must not depend on the current page.
  const unread = useQuery({ queryKey: ['unread-count'], queryFn: getUnreadCount });
  const items = data?.items ?? [];
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
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Notifications"
        description={`${unread.data?.unread ?? 0} unread · in-app + email mirror`}
        actions={
          !!unread.data?.unread ? (
            <Button
              type="button"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              loading={markAll.isPending}
              variant="secondary"
              size="sm"
              className="border-edge px-3 py-1.5 text-xs text-accent"
              leftIcon={!markAll.isPending ? <CheckCheck className="h-3.5 w-3.5" /> : undefined}
            >
              Mark all read
            </Button>
          ) : undefined
        }
      />

      {isLoading && <p className="py-10 text-center text-sm text-muted">Loading…</p>}
      {!isLoading && items.length === 0 && (
        <EmptyState
          icon={BellRing}
          title="No notifications yet"
          description="Ticket assignments, status changes, and comments will appear here."
        />
      )}

      <div className="flex flex-col gap-2">
        {items.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => open(n)}
            className={cn(
              'flex items-start gap-3 rounded-xl p-3 text-left transition-colors',
              n.read_at ? 'glass-card opacity-75' : 'glass-card border-accent/40 bg-accent/10 hover:bg-accent/15',
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

      <PaginationFooter
        page={page}
        pageSize={pageSize}
        total={data?.total}
        rowsLength={items.length}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  );
}
