import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import Select from '@/components/Select';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  /** Tailwind min-width class for the table (scrolls horizontally under it on mobile). */
  minWidth?: string;
  /** Pagination — rendered when onPageChange is provided. */
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}

export default function DataTable<T extends { id: string }>({
  columns,
  rows,
  loading = false,
  emptyMessage = 'No records found.',
  onRowClick,
  minWidth = 'min-w-[640px]',
  page = 1,
  pageSize = 20,
  total,
  onPageChange,
  onPageSizeChange,
}: DataTableProps<T>) {
  const head = (
    <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
      <tr>
        {columns.map((c) => (
          <th key={c.key} className={cn('px-4 py-3 font-medium', c.className)}>
            {c.header}
          </th>
        ))}
      </tr>
    </thead>
  );

  if (loading) {
    return (
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className={cn('w-full text-left text-sm', minWidth)}>
          {head}
          <tbody className="divide-y divide-slate-800 bg-slate-950">
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-3">
                    <div className="h-4 w-full max-w-[140px] animate-pulse rounded bg-slate-800" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const paginated = onPageChange !== undefined;
  const pages = total !== undefined && total > 0 ? Math.ceil(total / pageSize) : 0;
  // Clamp `from` to total so a stale page (data shrank while sitting on a
  // page past the last one) never renders a range like "Showing 81–45 of 45".
  const from = total !== undefined && total > 0 ? Math.min((page - 1) * pageSize + 1, total) : 0;
  const to = total !== undefined ? Math.min(page * pageSize, total) : rows.length;
  const navBtn =
    'flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-300 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent';

  const footer = paginated && (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-xl border-t border-slate-800 bg-slate-900/70 px-3 py-2.5 text-xs text-slate-400">
      <span>
        {total !== undefined && total > 0 && rows.length > 0
          ? `Showing ${from}–${to} of ${total}`
          : `${rows.length} row${rows.length === 1 ? '' : 's'}`}
      </span>
      <div className="flex items-center gap-2">
        <Select
          className="w-auto"
          value={String(pageSize)}
          onChange={(v) => onPageSizeChange?.(Number(v))}
          options={[
            { value: '10', label: '10 / page' },
            { value: '20', label: '20 / page' },
            { value: '50', label: '50 / page' },
          ]}
        />
        <button
          type="button"
          aria-label="Previous page"
          className={navBtn}
          disabled={page <= 1}
          onClick={() => onPageChange?.(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[76px] text-center tabular-nums">
          {pages > 0 ? `Page ${page} of ${pages}` : ''}
        </span>
        <button
          type="button"
          aria-label="Next page"
          className={navBtn}
          disabled={pages === 0 || page >= pages}
          onClick={() => onPageChange?.(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  if (rows.length === 0) {
    if (!paginated) {
      return (
        <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">
          {emptyMessage}
        </div>
      );
    }
    // Paginated empty state: keep the footer so total=0 shows "0 rows" with
    // both nav buttons disabled, and a stale page (rows gone, total > 0)
    // still offers Prev to navigate back.
    return (
      <div className="rounded-xl border border-slate-800">
        <div className="p-10 text-center text-sm text-slate-500">{emptyMessage}</div>
        {footer}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800">
      <div className="overflow-x-auto">
        <table className={cn('w-full text-left text-sm', minWidth)}>
          {head}
          <tbody className="divide-y divide-slate-800 bg-slate-950">
            {rows.map((row, i) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'animate-list-in transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-slate-900',
                )}
                style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3', c.className)}>
                    {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  );
}
