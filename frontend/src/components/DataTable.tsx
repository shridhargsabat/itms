import { Fragment, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import PaginationFooter from '@/components/PaginationFooter';
import { TABLE_SPEC } from '@/components/tableSpec';
import ScrollX from '@/components/ScrollX';

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
  /** Optional table caption (rendered as <caption>, passed to the scroll region as its label). */
  caption?: string;
  /** Row id to spotlight with an accent ring (wired by parents in views). */
  highlightId?: string;
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
  caption,
  highlightId,
}: DataTableProps<T>) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Spring row motion is desktop delight — hard-off under reduced motion.
  const reduceMotion = useReducedMotion();
  const selectable = selectedIds !== undefined && onSelectionChange !== undefined;
  const headCheckboxRef = useRef<HTMLInputElement>(null);
  const rowSelectable = (r: T) => (isRowSelectable ? isRowSelectable(r) : true);

  // Auto-fill: on desktop (lg+) the table body grows to fill the viewport bottom
  // instead of leaving empty space, scrolling internally when rows are longer
  // than the available height. The SHELL is a flex column: the scroll area takes
  // the flexible middle (flex-1 min-h-0) and the pagination footer sits naturally
  // at the shell bottom, so only the shell's top needs measuring (no footer math).
  const shellRef = useRef<HTMLDivElement>(null);
  const shellMaxH = useRef<number | undefined>(undefined);
  const [, setFillTick] = useState(0);
  useEffect(() => {
    const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches;
    const findScrollParent = (shell: HTMLElement): HTMLElement | null => {
      let el: HTMLElement | null = shell;
      while (el && el !== document.documentElement && el !== document.body) {
        const ov = getComputedStyle(el).overflowY;
        if (/auto|scroll/.test(ov)) return el;
        el = el.parentElement;
      }
      return null;
    };
    const compute = () => {
      const shell = shellRef.current;
      if (!isDesktop() || !shell) {
        if (shellMaxH.current !== undefined) {
          shellMaxH.current = undefined;
          setFillTick((t) => t + 1);
        }
        return;
      }
      // available = scroll-container bottom - where the shell starts - breathing (24).
      // On desktop the app is locked to the viewport (Layout's <main> is a flex
      // column) so the nearest vertical scroll ancestor is the content wrapper,
      // NOT the window — measuring against window.innerHeight there made the shell
      // overshoot the wrapper by its padding, leaving a second (wrapper) scrollbar
      // next to the table's own. Walk up to the real scroll container so the shell
      // caps exactly to its bottom; fall back to the window when no bounded scroll
      // ancestor exists (mobile / unlocked flow).
      const scrollParent = findScrollParent(shell);
      // Target the scroll container's CONTENT-BOX bottom (drop its bottom
      // padding) so the capped shell never spills past the wrapper's content —
      // otherwise the wrapper still scrolls a few px and gives a second bar.
      let targetBottom: number;
      if (scrollParent) {
        const r = scrollParent.getBoundingClientRect();
        const padBottom = parseFloat(getComputedStyle(scrollParent).paddingBottom) || 0;
        targetBottom = r.bottom - padBottom;
      } else {
        targetBottom = window.innerHeight;
      }
      const next = Math.max(targetBottom - shell.getBoundingClientRect().top - 24, 280);
      // only re-render when the measured height actually moved (avoid churn on scroll/resize)
      if (shellMaxH.current === undefined || Math.abs(shellMaxH.current - next) > 2) {
        shellMaxH.current = next;
        setFillTick((t) => t + 1);
      }
    };
    compute();
    // Perf: ResizeObserver on the shell + its scroll parent only. There is
    // deliberately NO scroll listener here — re-measuring (getComputedStyle +
    // getBoundingClientRect per tick) on every scroll event, including the
    // table's own inner scroll via capture, was pure layout churn for a value
    // that only moves on resize/layout shifts.
    const ro = new ResizeObserver(compute);
    if (shellRef.current) {
      ro.observe(shellRef.current);
      const sp = findScrollParent(shellRef.current);
      if (sp) ro.observe(sp);
    }
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, []);

  // Applied to the SHELL only when the measured fill height is active (desktop);
  // the CSS max-h-[55vh]/[62vh] classes still provide the mobile fallback.
  const fillStyle: CSSProperties | undefined =
    shellMaxH.current !== undefined
      ? { maxHeight: `${shellMaxH.current}px` }
      : undefined;
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
          <th scope="col" className={cn('w-10 sticky top-0 z-10 bg-surface', TABLE_SPEC.checkboxCell)}>
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
        {columns.map((c) => {
          const sortKey = c.sortKey ?? c.key;
          return (
            <th
              key={c.key}
              scope="col"
              aria-sort={
                c.sortable
                  ? sort?.key === sortKey
                    ? sort.dir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                  : undefined
              }
              className={cn(TABLE_SPEC.th, c.className)}
            >
              {c.sortable ? (
                <button
                  type="button"
                  onClick={() => cycleSort(c)}
                  className={cn(
                    // Task 18 (UI-17): explicit uppercase — preflight sets
                    // text-transform:none on buttons, which used to leave
                    // sortable headers Title Case next to ALL-CAPS plain ones.
                    'inline-flex min-h-[24px] min-w-[24px] items-center gap-1 rounded uppercase transition-colors hover:text-primary',
                    sort?.key === sortKey && 'text-accent',
                  )}
                >
                  {c.header}
                  {sort?.key === sortKey ? (
                    sort.dir === 'asc' ? (
                      <ArrowUp className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      <ArrowDown className="h-3 w-3" aria-hidden="true" />
                    )
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />
                  )}
                </button>
              ) : (
                c.header
              )}
            </th>
          );
        })}
      </tr>
    </thead>
  );

  if (loading) {
    return (
      <div ref={shellRef} style={fillStyle} className={cn(TABLE_SPEC.shell, 'flex flex-col')}>
        <ScrollX
          aria-label={caption}
          className="min-h-0 flex-1 flex flex-col"
          innerClassName={cn(TABLE_SPEC.tableScroll, 'flex-1 min-h-0')}
        >
          <table className={cn(TABLE_SPEC.table, minWidth)}>
            {caption ? <caption>{caption}</caption> : null}
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
      </div>
    );
  }

  const paginated = onPageChange !== undefined;
  const footer = paginated && (
    <PaginationFooter
      page={page}
      pageSize={pageSize}
      total={total}
      rowsLength={rows.length}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
    />
  );

  if (rows.length === 0) {
    if (!paginated) {
      return <div className={TABLE_SPEC.emptyShell}>{emptyMessage}</div>;
    }
    // Paginated empty state: keep the footer so total=0 shows "0 rows" with
    // both nav buttons disabled, and a stale page (rows gone, total > 0)
    // still offers Prev to navigate back.
    return (
      <div ref={shellRef} style={fillStyle} className={cn(TABLE_SPEC.shell, 'flex flex-col')}>
        <div className="p-10 text-center text-sm text-muted">{emptyMessage}</div>
        {footer}
      </div>
    );
  }

  return (
    <div
      ref={shellRef}
      style={fillStyle}
      className={cn(TABLE_SPEC.shell, 'flex flex-col')}
    >
      <ScrollX
        aria-label={caption}
        className="min-h-0 flex-1 flex flex-col"
        innerClassName={cn(TABLE_SPEC.tableScroll, 'flex-1 min-h-0')}
      >
        <table className={cn(TABLE_SPEC.table, minWidth)}>
          {caption ? <caption>{caption}</caption> : null}
          {head}
          <tbody className={TABLE_SPEC.tbody}>
            <AnimatePresence>
            {rows.map((row, i) => {
              const expanded = expandedId === row.id;
              const clickable = onRowClick !== undefined || renderExpanded !== undefined;
              const activate = renderExpanded
                ? () => setExpandedId(expanded ? null : row.id)
                : onRowClick
                  ? () => onRowClick(row)
                  : undefined;
              const rowRec = row as Record<string, unknown>;
              const rowLabel = String(rowRec.asset_tag ?? rowRec.title ?? rowRec.name ?? row.id);
              // Every body row is a motion.tr so the element type never flips
              // when sorting/filtering moves a row across the motion boundary
              // (a type flip remounts the node, replays the entrance, and
              // drops keyboard focus). Only the first screenful animates.
              const animateRow = !reduceMotion && i < 12;
              return (
                <Fragment key={row.id}>
                  <motion.tr
                    data-motion-row={animateRow ? '' : undefined}
                    initial={animateRow ? { opacity: 0, y: 14, filter: 'blur(4px)' } : false}
                    animate={animateRow ? { opacity: 1, y: 0, filter: 'blur(0px)' } : undefined}
                    exit={animateRow ? { opacity: 0, transition: { duration: 0.15, delay: 0 } } : undefined}
                    transition={{
                      type: 'spring',
                      stiffness: 380,
                      damping: 30,
                      delay: Math.min(i, 8) * 0.035,
                    }}
                    onClick={activate}
                    // TFE-04: keyboard access for clickable rows — focusable + Enter/Space.
                    // Interactive children (checkboxes, links, buttons) keep their own keys.
                    onKeyDown={
                      activate
                        ? (e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            const t = e.target as HTMLElement;
                            if (t.closest('button, a, input, select, textarea, [role="button"], [role="option"], [role="link"]')) return;
                            e.preventDefault();
                            activate();
                          }
                        : undefined
                    }
                    tabIndex={clickable ? 0 : undefined}
                    aria-expanded={renderExpanded ? expanded : undefined}
                    className={cn(
                      'transition-colors',
                      clickable && 'cursor-pointer hover:bg-elevated/60 focus-visible:bg-elevated focus-visible:outline-none',
                      highlightId === row.id && 'ring-2 ring-inset ring-accent',
                    )}
                  >
                    {selectable && (
                      <td
                        className={TABLE_SPEC.checkboxCell}
                        onClick={(e) => {
                          // checkbox click must not open the row detail
                          e.stopPropagation();
                        }}
                        onKeyDown={(e) => {
                          // checkbox keys must not trigger the row's Enter/Space activation
                          e.stopPropagation();
                        }}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select ${rowLabel}`}
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
                  </motion.tr>
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
            </AnimatePresence>
          </tbody>
        </table>
      </ScrollX>
      {footer}
    </div>
  );
}
