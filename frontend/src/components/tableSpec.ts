/** Canonical table geometry — the ONE spec every ITMS table renders with.
 *  Header text-xs uppercase on bg-surface, cells py-3/px-4 text-sm, shell
 *  rounded-xl border, min-w-[640px] + ScrollX for consistent mobile behavior. */
export const TABLE_SPEC = {
  shell: 'rounded-xl border border-edge',
  /* Vertical scroll lives on the shell so the sticky header pins to this box's top
     (top:0 always — no dependency on the mobile top bar / per-view sticky action rows).
     NOTE: do NOT add transform/filter/will-change here — they create a containing block
     that breaks position:sticky on th (see react-spa-ui-pitfalls §1). */
  tableScroll: 'max-h-[55vh] overflow-y-auto lg:max-h-[62vh]',
  emptyShell: 'rounded-xl border border-dashed border-edge p-10 text-center text-sm text-muted',
  head: 'bg-surface text-xs uppercase tracking-wide text-secondary',
  /* sticky top-0 pins the header inside the shell's vertical scroll box; opaque bg so
     body rows never show through; z-10 above body cells + the ScrollX right-edge fade
     (fade stays z-[5]) but below modals/menus/top-bar (z-[40,60,70]). */
  th: 'sticky top-0 z-10 bg-surface px-4 py-3 font-medium',
  td: 'px-4 py-3',
  table: 'w-full text-left text-sm',
  tbody: 'divide-y divide-edge bg-base',
  checkboxCell: 'px-3 py-3',
  footer:
    'sticky bottom-[3.5rem] z-10 flex flex-wrap items-center justify-between gap-2 rounded-b-xl border-t border-edge bg-surface/95 px-3 py-2.5 text-xs text-secondary backdrop-blur lg:bottom-0',
  minWidth: 'min-w-[640px]',
} as const;
