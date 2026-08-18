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
