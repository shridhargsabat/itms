import { Fragment, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import Select from '@/components/Select';
import ScrollX from '@/components/ScrollX';

/** Canonical table geometry — the ONE spec every ITMS table renders with.
 *  Header text-xs uppercase on bg-surface, cells py-3/px-4 text-sm, shell
 *  rounded-xl border, min-w-[640px] + ScrollX for consistent mobile behavior. */
export const TABLE_SPEC = {
  shell: 'rounded-xl border border-edge',
  emptyShell: 'rounded-xl border border-dashed border-edge p-10 text-center text-sm text-muted',
  head: 'bg-surface text-xs uppercase tracking-wide text-secondary',
  th: 'px-4 py-3 font-medium',
  td: 'px-4 py-3',
  table: 'w-full text-left text-sm',
  tbody: 'divide-y divide-edge bg-base',
  checkboxCell: 'px-3 py-3',
  footer:
    'sticky bottom-[3.5rem] z-10 flex flex-wrap items-center justify-between gap-2 rounded-b-xl border-t border-edge bg-surface/95 px-3 py-2.5 text-xs text-secondary backdrop-blur lg:bottom-0',
  minWidth: 'min-w-[640px]',
} as const;

export interface Column<T> {
  key: string;
  header: string;
  /** meta.expanded tells the cell whether its row is expanded (for chevrons). */
  render?: (row: T, meta?: { expanded: boolean }) => ReactNode;
  className?: string;
  /** Renders a clickable sort header; server sorts by sortKey (defaults to key). */
  sortable?: boolean;
  sortKey?: string;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
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
  /** Server-side sorting — rendered on sortable columns when provided. */
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  /** Optional accordion row rendered under a row when clicked (toggles per row). */
  renderExpanded?: (row: T) => ReactNode;
  /** Row multi-select (bulk actions). Selection is controlled by the parent. */
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** Rows whose checkbox must be disabled (excluded from select-all). */
  isRowSelectable?: (row: T) => boolean;
}

export default function DataTable<T extends { id: string }>({
  columns,
  rows,
  loading = false,
  emptyMessage = 'No records found.',
  onRowClick,
  minWidth = TABLE_SPEC.minWidth,
  page = 1,
  pageSize = 20,
  total,
  onPageChange,
  onPageSizeChange,
  sort,
  onSortChange,
  renderExpanded,
  selectedIds,
  onSelectionChange,
  isRowSelectable,
}: DataTableProps<T>) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const selectable = selectedIds !== undefined && onSelectionChange !== undefined;
  const headCheckboxRef = useRef<HTMLInputElement>(null);
  const rowSelectable = (r: T) => (isRowSelectable ? isRowSelectable(r) : true);
  const selectableRows = rows.filter(rowSelectable);
  const allPageSelected = selectable && selectableRows.length > 0 && selectableRows.every((r) => selectedIds!.has(r.id));
  const somePageSelected = selectable && selectableRows.some((r) => selectedIds!.has(r.id));
  const cycleSort = (c: Column<T>) => {
    if (!onSortChange) return;
    const key = c.sortKey ?? c.key;
    if (sort?.key === key) {
      if (sort.dir === 'asc') onSortChange({ key, dir: 'desc' });
      else onSortChange(null);
    } else {
      onSortChange({ key, dir: 'asc' });
    }
  };
  const toggleAll = () => {
    if (!selectable) return;
    const next = new Set(selectedIds!);
    if (allPageSelected) {
      selectableRows.forEach((r) => next.delete(r.id));
    } else {
      selectableRows.forEach((r) => next.add(r.id));
    }
    onSelectionChange!(next);
  };
  const toggleRow = (id: string) => {
    if (!selectable) return;
    const row = rows.find((r) => r.id === id);
    if (row && !rowSelectable(row)) return;
    const next = new Set(selectedIds!);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange!(next);
  };
  const head = (
    <thead className={TABLE_SPEC.head}>
      <tr>
        {selectable && (
          <th className={cn('w-10', TABLE_SPEC.checkboxCell)}>
            <input
              type="checkbox"
              aria-label="Select all on page"
              checked={allPageSelected}
              ref={(el) => {
                headCheckboxRef.current = el;
                if (el) el.indeterminate = somePageSelected && !allPageSelected;
              }}
              onChange={toggleAll}
              className="h-4 w-4 cursor-pointer rounded border-edge2 accent-accent"
            />
          </th>
        )}
        {columns.map((c) => (
          <th key={c.key} className={cn(TABLE_SPEC.th, c.className)}>
            {c.sortable ? (
              <button
                type="button"
                onClick={() => cycleSort(c)}
                className={cn(
                  'inline-flex items-center gap-1 rounded transition-colors hover:text-primary',
                  sort?.key === (c.sortKey ?? c.key) && 'text-accent',
                )}
              >
                {c.header}
                {sort?.key === (c.sortKey ?? c.key) ? (
                  sort.dir === 'asc' ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )
                ) : (
                  <ArrowUpDown className="h-3 w-3 opacity-40" />
                )}
              </button>
            ) : (
              c.header
            )}
          </th>
        ))}
      </tr>
    </thead>
  );

  if (loading) {
    return (
      <ScrollX className={TABLE_SPEC.shell}>
        <table className={cn(TABLE_SPEC.table, minWidth)}>
          {head}
          <tbody className={TABLE_SPEC.tbody}>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-3">
                    <div className="h-4 w-full max-w-[140px] animate-pulse rounded bg-elevated" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
    );
  }

  const paginated = onPageChange !== undefined;
  const pages = total !== undefined && total > 0 ? Math.ceil(total / pageSize) : 0;
  // Clamp `from` to total so a stale page (data shrank while sitting on a
  // page past the last one) never renders a range like "Showing 81–45 of 45".
  const from = total !== undefined && total > 0 ? Math.min((page - 1) * pageSize + 1, total) : 0;
  const to = total !== undefined ? Math.min(page * pageSize, total) : rows.length;
  const navBtn =
    'flex h-8 w-8 items-center justify-center rounded-lg border border-edge2 text-secondary transition-colors hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent';

  const footer = paginated && (
    <div className={TABLE_SPEC.footer}>
      <span>
        {total !== undefined && total > 0 && rows.length > 0
          ? `Showing ${from}–${to} of ${total}`
          : `${rows.length} row${rows.length === 1 ? '' : 's'}`}
      </span>
      <div className="flex items-center gap-2">
        <Select
          className="w-auto"
          triggerClassName="h-8 px-2.5 py-0 text-xs"
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
      return <div className={TABLE_SPEC.emptyShell}>{emptyMessage}</div>;
    }
    // Paginated empty state: keep the footer so total=0 shows "0 rows" with
    // both nav buttons disabled, and a stale page (rows gone, total > 0)
    // still offers Prev to navigate back.
    return (
      <div className={TABLE_SPEC.shell}>
        <div className="p-10 text-center text-sm text-muted">{emptyMessage}</div>
        {footer}
      </div>
    );
  }

  return (
    <div className={TABLE_SPEC.shell}>
      <ScrollX>
        <table className={cn(TABLE_SPEC.table, minWidth)}>
          {head}
          <tbody className={TABLE_SPEC.tbody}>
            {rows.map((row, i) => {
              const expanded = expandedId === row.id;
              const clickable = onRowClick !== undefined || renderExpanded !== undefined;
              return (
                <Fragment key={row.id}>
                  <tr
                    onClick={
                      renderExpanded
                        ? () => setExpandedId(expanded ? null : row.id)
                        : onRowClick
                          ? () => onRowClick(row)
                          : undefined
                    }
                    aria-expanded={renderExpanded ? expanded : undefined}
                    className={cn(
                      'animate-list-in transition-colors',
                      clickable && 'cursor-pointer hover:bg-surface',
                    )}
                    style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
                  >
                    {selectable && (
                      <td className={TABLE_SPEC.checkboxCell} onClick={(e) => {
                        // checkbox click must not open the row detail
                        e.stopPropagation();
                      }}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${String((row as Record<string, unknown>).asset_tag ?? row.id)}`}
                          checked={selectedIds!.has(row.id)}
                          onChange={() => toggleRow(row.id)}
                          disabled={!rowSelectable(row)}
                          className="h-4 w-4 cursor-pointer rounded border-edge2 accent-accent disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={cn(TABLE_SPEC.td, c.className)}>
                        {c.render
                          ? c.render(row, { expanded })
                          : String((row as Record<string, unknown>)[c.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                  {expanded && renderExpanded && (
                    <tr className="bg-surface/60">
                      <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-3">
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </ScrollX>
      {footer}
    </div>
  );
}
