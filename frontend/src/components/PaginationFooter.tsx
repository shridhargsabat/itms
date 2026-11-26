import { useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import Select from '@/components/Select';
import { TABLE_SPEC } from '@/components/tableSpec';
import { Button, BUTTON } from '@/components/Button';
import { clampPage } from '@/lib/usePagination';

/**
 * Shared pagination footer — the SAME UI every ITMS list renders:
 * "Showing X–Y of Z", 10/20/50 per page, prev/next. DataTable uses it
 * internally; card-based lists (Requests, Onboarding, Notifications,
 * Knowledge Base, Licenses) render it under their cards.
 *
 * UX-09 (#183): First/Last jump buttons + a compact go-to-page input, driven
 * by the same page/total/onPageChange props (no new required props). The
 * jump cluster only renders when the page count is known (total provided);
 * the rowsLength-only mode keeps exactly the old UI.
 */
export interface PaginationFooterProps {
  page: number;
  pageSize: number;
  total?: number;
  rowsLength: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  variant?: 'sticky' | 'static';
}

export default function PaginationFooter({
  page,
  pageSize,
  total,
  rowsLength,
  onPageChange,
  onPageSizeChange,
  variant = 'sticky',
}: PaginationFooterProps) {
  // Draft for the go-to-page box: null = untouched, mirrors the live page.
  const [draft, setDraft] = useState<string | null>(null);
  if (total === 0) return null;
  const pages = total !== undefined && total > 0 ? Math.ceil(total / pageSize) : 0;
  // Clamp `from` to total so a stale page (data shrank while sitting on a
  // page past the last one) never renders a range like "Showing 81–45 of 45".
  const from = total !== undefined && total > 0 ? Math.min((page - 1) * pageSize + 1, total) : 0;
  const to = total !== undefined ? Math.min(page * pageSize, total) : rowsLength;
  // Ghost (bordered, transparent) nav buttons with an EXPLICIT text label +
  // chevron so they can never read as a blank icon-only square — the arrow is
  // a hint, the word is the affordance. `BUTTON.ghost` + semantic tokens keep
  // them theme-aware (no fixed accent fill, so no filled-empty-button glitch).
  const navBtn =
    BUTTON.ghost +
    ' h-8 rounded-lg border border-edge2 text-secondary hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent';

  // Next is the forward CTA: accent-filled (`primary`) when there's a next
  // page, ghost/disabled on the last page. Prev stays ghost (disabled on p1).
  const canPrev = page > 1;
  const canNext = pages > 0 && page < pages;
  // UX-09: First/Last mirror Prev/Next exactly (ghost, never the CTA fill).
  const canFirst = page > 1;
  const canLast = pages > 0 && page < pages;
  const nextBtn = canNext
    ? BUTTON.primary + ' h-8 rounded-lg px-2'
    : `${navBtn} px-2`;

  // Commit the go-to draft: leading-integer parse, clamped into [1, pages];
  // garbage/empty reverts to the live page (no navigation); navigating to
  // the page we're already on is a silent no-op.
  const commitDraft = () => {
    const raw = (draft ?? String(page)).trim();
    const n = Number.parseInt(raw, 10);
    const target = clampPage(Number.isNaN(n) ? page : n, pages);
    setDraft(null);
    if (target !== page) onPageChange?.(target);
  };

  return (
    <div className={variant === 'static' ? 'mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-edge/60 bg-surface px-3 py-2.5 text-xs text-secondary' : TABLE_SPEC.footer}>
      <span>
        {total !== undefined && total > 0 && rowsLength > 0
          ? `Showing ${from}–${to} of ${total}`
          : `${rowsLength} row${rowsLength === 1 ? '' : 's'}`}
      </span>
      <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5 min-w-0">
        <Select
          className="w-auto shrink-0"
          triggerClassName="h-8 px-1.5 py-0 text-xs"
          aria-label="Rows per page"
          value={String(pageSize)}
          onChange={(v) => onPageSizeChange?.(Number(v))}
          options={[
            { value: '10', label: '10 / page' },
            { value: '20', label: '20 / page' },
            { value: '50', label: '50 / page' },
          ]}
        />
        {pages > 0 && (
          <Button
            type="button"
            variant="ghost"
            aria-label="First page"
            className={`${navBtn} px-2`}
            disabled={!canFirst}
            onClick={() => onPageChange?.(1)}
          >
            <ChevronsLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="leading-none">First</span>
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          aria-label="Previous page"
          className={`${navBtn} px-2`}
          disabled={!canPrev}
          onClick={() => onPageChange?.(page - 1)}
        >
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="leading-none">Prev</span>
        </Button>
        <span className="order-last basis-full text-center tabular-nums sm:order-none sm:basis-auto">
          {pages > 0 ? `Page ${page} of ${pages}` : ''}
        </span>
        {pages > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            <input
              aria-label="Go to page"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              maxLength={7}
              className="h-8 w-12 rounded-lg border border-edge2 bg-transparent px-1.5 text-center text-xs tabular-nums text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              value={draft ?? String(page)}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => setDraft(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitDraft();
                } else if (e.key === 'Escape') {
                  setDraft(null);
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              aria-label="Go"
              className={`${navBtn} px-2`}
              // Keep focus in the input through the click: without this, the
              // input's blur-revert fires first and eats the draft.
              onMouseDown={(e) => e.preventDefault()}
              onClick={commitDraft}
            >
              <span className="leading-none">Go</span>
            </Button>
          </span>
        )}
        <Button
          type="button"
          variant={canNext ? 'primary' : 'ghost'}
          aria-label="Next page"
          className={nextBtn}
          disabled={!canNext}
          onClick={() => onPageChange?.(page + 1)}
        >
          <span className="leading-none">Next</span>
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Button>
        {pages > 0 && (
          <Button
            type="button"
            variant="ghost"
            aria-label="Last page"
            className={`${navBtn} px-2`}
            disabled={!canLast}
            onClick={() => onPageChange?.(pages)}
          >
            <span className="leading-none">Last</span>
            <ChevronsRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
