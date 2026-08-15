import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getAuditLog } from '@/api/client';
import DataTable, { type Column } from '@/components/DataTable';
import { formatDate } from '@/lib/utils';
import type { AuditLogEntry } from '@/api/types';

export default function AuditLog() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['audit', { page, pageSize }],
    queryFn: () => getAuditLog({ limit: pageSize, offset: (page - 1) * pageSize }),
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? rows.length;

  const columns: Column<AuditLogEntry>[] = [
    {
      key: 'created_at',
      header: 'Time',
      render: (e) => (
        <span className="whitespace-nowrap text-xs text-secondary">{formatDate(e.created_at)}</span>
      ),
    },
    {
      key: 'actor_name',
      header: 'Actor',
      render: (e) =>
        e.actor_name ?? <span className="text-muted">system</span>,
    },
    {
      key: 'action',
      header: 'Action',
      render: (e) => (
        <span
          title={e.action}
          className="max-w-[180px] truncate rounded bg-elevated px-2 py-0.5 font-mono text-xs text-secondary"
        >
          {e.action}
        </span>
      ),
    },
    {
      key: 'target_type',
      header: 'Target Type',
      render: (e) => <span className="text-xs text-secondary">{e.target_type}</span>,
    },
    {
      key: 'target_id',
      header: 'Target ID',
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
      <div>
        <h1 className="text-xl font-semibold text-primary">Audit Log</h1>
        <p className="mt-0.5 text-sm text-secondary">
          {total} event{total === 1 ? '' : 's'} — click a row to inspect the diff.
        </p>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        total={data?.total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        loading={isLoading}
        emptyMessage="No audit entries yet."
        minWidth="min-w-[680px]"
        renderExpanded={(e) => (
          <pre className="max-h-72 overflow-auto rounded-lg bg-base p-3 font-mono text-xs leading-relaxed text-secondary">
            {JSON.stringify(e.diff, null, 2)}
          </pre>
        )}
      />
    </div>
  );
}
