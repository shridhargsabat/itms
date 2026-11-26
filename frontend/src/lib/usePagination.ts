import { useState } from 'react';

/**
 * Clamp a 1-based page number into range (UX-09 #183: shared by the
 * PaginationFooter go-to-page input and the useServerPagination jumper so
 * both clamp identically). NaN / non-finite → 1, fractions floor, below 1 →
 * 1, above pageCount → pageCount (when the count is known).
 */
export function clampPage(page: number, pageCount?: number): number {
  if (!Number.isFinite(page)) return 1;
  const p = Math.floor(page);
  if (pageCount !== undefined && Number.isFinite(pageCount) && Math.floor(pageCount) >= 1) {
    return Math.min(Math.max(p, 1), Math.floor(pageCount));
  }
  return Math.max(p, 1);
}

/**
 * Shared pagination state for server-paginated lists (the ITMS standard:
 * limit/offset + X-Total-Count). Every paginated view uses this so the
 * reset-on-filter-change and reset-on-page-size-change rules are identical.
 */
export function useServerPagination(pageSize = 20) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);

  /** Changing page size always snaps back to page 1 (standard behavior). */
  const setPageSize = (s: number) => {
    setSize(s);
    setPage(1);
  };

  /** Call from the same effect that resets filters/search/sort. */
  const reset = () => setPage(1);

  /**
   * Clamped jump for First/Last/go-to controls (UX-09 #183): out-of-range
   * targets snap into [1, pageCount] instead of landing on an empty page.
   */
  const goToPage = (p: number, pageCount?: number) => setPage(clampPage(p, pageCount));

  return {
    page,
    pageSize: size,
    setPage,
    setPageSize,
    reset,
    goToPage,
    /** Offset for the API call: (page - 1) * pageSize. */
    offset: (page - 1) * size,
  };
}

/**
 * Client-side pagination for lists already fetched whole (small master
 * data, or batch-selection pages like Labels). Slices the in-memory rows;
 * total is derived from the array length.
 */
export function useClientPagination<T>(rows: T[], pageSize = 20) {
  const p = useServerPagination(pageSize);
  const total = rows.length;
  const pageRows = rows.slice((p.page - 1) * p.pageSize, p.page * p.pageSize);
  return { ...p, total, pageRows };
}
