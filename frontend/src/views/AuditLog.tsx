import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, Copy, ScrollText } from 'lucide-react';
import { getAuditLog } from '@/api/client';
import DataTable, { type Column, type SortState } from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import FilterBar from '@/components/FilterBar';
import PageHeader from '@/components/PageHeader';
import Select from '@/components/Select';
import { cn, formatDate, inputCls, labelCls } from '@/lib/utils';
import { useServerPagination } from '@/lib/usePagination';
import type { AuditLogEntry } from '@/api/types';

// Backend audit actions are SCREAMING_SNAKE_CASE (e.g. VENDOR_DELETED);
// destructive ones get the red chip treatment.
const DESTRUCTIVE_ACTION = /delete|destroy|revoke|remove/i;

// getAuditLog has no server-side filter params, so filters run client-side.
// When any filter is active we pull a wider window (500 recent events) and
// paginate the matches locally instead of filtering a single server page.
const FILTER_WINDOW = 500;

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      // Fallback for non-secure contexts (plain http, older browsers).
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    return true;
  } catch {
    return false;
  }
}

function TargetIdCell({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const short = id.length > 8 ? `${id.slice(0, 8)}…` : id;
  return (
    <span className="inline-flex items-center gap-1">
      <span data-testid="target-id" title={id} className="whitespace-nowrap font-mono text-xs text-accent">
        {short}
      </span>
      <button
        type="button"
        aria-label="Copy target ID"
        title="Copy full target ID"
        onClick={(ev) => {
          ev.stopPropagation();
          void copyText(id).then((ok) => {
            if (ok) {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }
          });
        }}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-primary"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </span>
  );
}

function DiffBlock({ diff }: { diff: Record<string, unknown> }) {
  const lines = JSON.stringify(diff, null, 2).split('\n');
  return (
    <pre className="max-h-72 overflow-auto rounded-lg glass-dense p-3 font-mono text-xs leading-relaxed text-secondary">
      {lines.map((line, i) => {
        const m = line.match(/^(\s*)("[^"]*")(:?)(.*)$/);
        return (
          <span key={i}>
            {m ? (
              <>
                {m[1]}
                <span className="text-accent">{m[2]}</span>
                {m[3]}
                {m[4]}
              </>
            ) : (
              line
            )}
            {i < lines.length - 1 ? '\n' : ''}
          </span>
        );
      })}
    </pre>
  );
}

export default function AuditLog() {
  const { page, pageSize, setPage, setPageSize, reset, offset } = useServerPagination(20);
  const [sort, setSort] = useState<SortState | null>(null);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const hasFilters = Boolean(actor || action || targetType || from || to);

  const { data, isLoading } = useQuery({
    queryKey: [
      'audit',
      { page: hasFilters ? 1 : page, pageSize: hasFilters ? FILTER_WINDOW : pageSize, sort, filtered: hasFilters },
    ],
    queryFn: () =>
      getAuditLog({
        limit: hasFilters ? FILTER_WINDOW : pageSize,
        offset: hasFilters ? 0 : offset,
        sort: sort?.key,
        order: sort?.dir,
      }),
    // Filter keystrokes swap the query key (page window <-> 500-event
    // window) — hold the previous rows so the table never flashes empty.
    placeholderData: (prev) => prev,
  });

  // Any filter change resets to page 1.
  useEffect(() => {
    reset();
  }, [actor, action, targetType, from, to]);

  const filtered = useMemo(() => {
    const q = actor.trim().toLowerCase();
    return (data?.items ?? []).filter((e) => {
      if (q && !(e.actor_name ?? 'system').toLowerCase().includes(q)) return false;
      if (action && e.action !== action) return false;
      if (targetType && e.target_type !== targetType) return false;
      const day = e.created_at.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
  }, [data, actor, action, targetType, from, to]);

  const rows = hasFilters ? filtered.slice((page - 1) * pageSize, page * pageSize) : filtered;
  const total = hasFilters ? filtered.length : (data?.total ?? filtered.length);

  const actionOptions = useMemo(
    () => [...new Set((data?.items ?? []).map((e) => e.action))].sort(),
    [data],
  );
  const targetTypeOptions = useMemo(
    () => [...new Set((data?.items ?? []).map((e) => e.target_type))].sort(),
    [data],
  );

  const clearFilters = () => {
    setActor('');
    setAction('');
    setTargetType('');
    setFrom('');
    setTo('');
  };

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
      render: (e) => <span className="whitespace-nowrap text-xs text-secondary">{e.target_type}</span>,
    },
    {
      key: 'target_id',
      header: 'Target ID',
      sortable: true,
      render: (e) => <TargetIdCell id={e.target_id} />,
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

      <FilterBar className="items-end">
        <label htmlFor="audit-actor" className="flex min-w-[140px] flex-1 flex-col gap-1 sm:max-w-[200px] sm:flex-none">
          <span className={labelCls}>Actor</span>
          <input
            id="audit-actor"
            type="text"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="Filter by actor…"
            className={inputCls}
          />
        </label>
        <label htmlFor="audit-action" className="flex flex-col gap-1">
          <span className={labelCls}>Action</span>
          <Select
            id="audit-action"
            value={action}
            onChange={setAction}
            className="w-auto min-w-[150px]"
            options={[{ value: '', label: 'All actions' }, ...actionOptions.map((a) => ({ value: a, label: a }))]}
          />
        </label>
        <label htmlFor="audit-target-type" className="flex flex-col gap-1">
          <span className={labelCls}>Target type</span>
          <Select
            id="audit-target-type"
            value={targetType}
            onChange={setTargetType}
            className="w-auto min-w-[140px]"
            options={[
              { value: '', label: 'All types' },
              ...targetTypeOptions.map((t) => ({ value: t, label: t })),
            ]}
          />
        </label>
        <label htmlFor="audit-from" className="flex flex-col gap-1">
          <span className={labelCls}>From date</span>
          <input
            id="audit-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={inputCls}
          />
        </label>
        <label htmlFor="audit-to" className="flex flex-col gap-1">
          <span className={labelCls}>To date</span>
          <input
            id="audit-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={inputCls}
          />
        </label>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-secondary transition-colors hover:bg-elevated hover:text-primary"
          >
            Clear
          </button>
        )}
      </FilterBar>

      {!isLoading && rows.length === 0 && !hasFilters ? (
        <EmptyState
          icon={ScrollText}
          title="No audit entries yet"
          description="Events will appear here as users make changes across the workspace."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          total={total}
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
          emptyMessage={hasFilters ? 'No audit entries match the current filters.' : 'No audit entries yet.'}
          renderExpanded={(e) => <DiffBlock diff={e.diff} />}
        />
      )}
    </div>
  );
}
