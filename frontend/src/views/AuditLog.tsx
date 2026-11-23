import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import { getAuditLog } from '@/api/client';
import DataTable, { type Column, type SortState } from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import PageHeader from '@/components/PageHeader';
import { cn, formatDate } from '@/lib/utils';
import { useServerPagination } from '@/lib/usePagination';
import type { AuditLogEntry } from '@/api/types';

// Backend audit actions are SCREAMING_SNAKE_CASE (e.g. VENDOR_DELETED);
// destructive ones get the red chip treatment.
const DESTRUCTIVE_ACTION = /delete|destroy|revoke|remove/i;

export default function AuditLog() {
  const { page, pageSize, setPage, setPageSize, reset, offset } = useServerPagination(20);
  const [sort, setSort] = useState<SortState | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['audit', { page, pageSize, sort }],
    queryFn: () =>
      getAuditLog({
        limit: pageSize,
        offset,
        sort: sort?.key,
        order: sort?.dir,
      }),
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? rows.length;

  const columns: Column<AuditLogEntry>[] = [
    {
      key: 'created_at',
      header: 'Time',
      sortable: true,
      render: (e) => (
        <span className="whitespace-nowrap text-xs text-secondary">{formatDate(e.created_at)}</span>
      ),
    },
    {
      key: 'actor_name',
      header: 'Actor',
      sortable: true,
      render: (e) =>
        e.actor_name ?? <span className="text-muted">system</span>,
    },
    {
      key: 'action',
      header: 'Action',
      sortable: true,
      render: (e) => (
        <span
          title={e.action}
          className={cn(
            'inline-block max-w-[180px] truncate rounded px-2 py-0.5 font-mono text-xs',
            DESTRUCTIVE_ACTION.test(e.action)
              ? 'bg-red-500/10 text-red-700 dark:text-red-400'
              : 'bg-elevated text-secondary',
          )}
        >
          {e.action}
        </span>
      ),
    },
    {
      key: 'target_type',
      header: 'Target Type',
      sortable: true,
      render: (e) => <span className="text-xs text-secondary">{e.target_type}</span>,
    },
    {
      key: 'target_id',
      header: 'Target ID',
      sortable: true,
      render: (e) => <span className="font-mono text-xs text-accent">{e.target_id}</span>,
    },
    {
      key: 'expand',
      header: '',
      render: (_e, meta) =>
        meta?.expanded ? (
          <ChevronDown className="ml-auto h-4 w-4" />
        ) : (
          <ChevronRight className="ml-auto h-4 w-4" />
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit Log"
        description={`${total} event${total === 1 ? '' : 's'} — click a row to inspect the diff.`}
      />

      {!isLoading && rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No audit entries yet"
          description="Events will appear here as users make changes across the workspace."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          total={data?.total}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          sort={sort}
          onSortChange={(s) => {
            setSort(s);
            reset();
          }}
          loading={isLoading}
          emptyMessage="No audit entries yet."
          renderExpanded={(e) => (
            <pre className="max-h-72 overflow-auto rounded-lg glass-dense p-3 font-mono text-xs leading-relaxed text-secondary">
              {JSON.stringify(e.diff, null, 2)}
            </pre>
          )}
        />
      )}
    </div>
  );
}
