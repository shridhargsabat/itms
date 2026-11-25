/** Canonical table geometry — the ONE spec every ITMS table renders with.
 *  Header text-xs uppercase on bg-surface, cells py-3/px-4 text-sm, shell
 *  overflow-hidden rounded-2xl glass-card table-shell, min-w-[640px] + ScrollX
 *  for consistent mobile behavior. table-shell lets glass themes drop the SVG
 *  refraction filter on table shells (paint perf) while keeping frosted blur. */
export const TABLE_SPEC = {
  shell: 'overflow-hidden rounded-2xl glass-card table-shell',
  /* Vertical scroll lives on the ScrollX INNER container (the same element that does
     overflow-x) so the sticky header pins to that box's top (top:0 always). It MUST
     be on the single scrolling element — if the vertical scroll sat on an outer shell
     while an inner overflow-x div sat between it and thead, that inner div becomes the
     nearest scroll container and captures (breaks) the sticky pinning (react-spa-ui-pitfalls §1).
     On desktop the shell is a bounded flex column and this box becomes `flex-1 min-h-0`
     (DataTable classes) so the body auto-fills the viewport bottom, scrolling internally;
     `lg:max-h-none` removes the old 62vh ceiling (the fill max-height now comes from the
     shell's measured inline max-height). Mobile keeps the capped fallback.
     NOTE: do NOT add transform/filter/will-change here — they create a containing block
     that breaks position:sticky on th. */
  tableScroll: 'max-h-[55vh] overflow-y-auto lg:max-h-none',
  emptyShell: 'rounded-2xl border border-dashed border-edge p-10 text-center text-sm text-muted',
  head: 'bg-surface text-xs uppercase tracking-wider text-secondary',
  /* sticky top-0 pins the header inside the shell's vertical scroll box; opaque-enough bg so
     body rows never show through; z-10 above body cells + the ScrollX right-edge fade
     (fade stays z-[5]) but below modals/menus/top-bar (z-[40,60,70]).
     Task 18 (UI-17): casing lives ON the th (not inherited from thead) so
     every header — sortable, plain, and custom tables — renders identical. */
  th: 'sticky top-0 z-10 border-b border-edge/60 bg-surface px-4 py-3 text-xs font-medium uppercase tracking-wider',
  td: 'px-4 py-3',
  table: 'w-full text-left text-sm',
  tbody: 'divide-y divide-edge/60 bg-surface',
  checkboxCell: 'px-3 py-3',
  /* Static (not sticky): the footer sits OUTSIDE the scroll container at the
     shell bottom, so sticky positioning here was dead — it never stuck to
     anything and only cost a needless stacking context. */
  footer:
    'flex flex-wrap items-center justify-between gap-2 rounded-b-2xl border-t border-edge/60 bg-surface/95 px-3 py-2.5 text-xs text-secondary backdrop-blur',
  minWidth: 'min-w-[640px]',
} as const;
