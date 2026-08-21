import { ChevronLeft, ChevronRight } from 'lucide-react';
import Select from '@/components/Select';
import { TABLE_SPEC } from '@/components/tableSpec';
import { Button, BUTTON } from '@/components/Button';

/**
 * Shared pagination footer — the SAME UI every ITMS list renders:
 * "Showing X–Y of Z", 10/20/50 per page, prev/next. DataTable uses it
 * internally; card-based lists (Requests, Onboarding, Notifications,
 * Knowledge Base, Licenses) render it under their cards.
 */
export interface PaginationFooterProps {
  page: number;
  pageSize: number;
  total?: number;
  rowsLength: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}

export default function PaginationFooter({
  page,
  pageSize,
  total,
  rowsLength,
  onPageChange,
  onPageSizeChange,
}: PaginationFooterProps) {
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
  const nextBtn = canNext
    ? BUTTON.primary + ' h-8 rounded-lg px-2'
    : `${navBtn} px-2`;

  return (
    <div className={TABLE_SPEC.footer}>
      <span>
        {total !== undefined && total > 0 && rowsLength > 0
          ? `Showing ${from}–${to} of ${total}`
          : `${rowsLength} row${rowsLength === 1 ? '' : 's'}`}
      </span>
      <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5 min-w-0">
        <Select
          className="w-auto shrink-0"
          triggerClassName="h-8 px-1.5 py-0 text-xs"
          value={String(pageSize)}
          onChange={(v) => onPageSizeChange?.(Number(v))}
          options={[
            { value: '10', label: '10 / page' },
            { value: '20', label: '20 / page' },
            { value: '50', label: '50 / page' },
          ]}
        />
        <Button
          type="button"
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
        <Button
          type="button"
          aria-label="Next page"
          className={nextBtn}
          disabled={!canNext}
          onClick={() => onPageChange?.(page + 1)}
        >
          <span className="leading-none">Next</span>
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
