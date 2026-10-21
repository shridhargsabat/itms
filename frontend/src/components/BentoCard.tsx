import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { MetricBucket } from '@/api/types';

/**
 * Bento-box card shell: token-based surface with rounded-2xl edges, hover
 * lift and min-w-0 baked in (grid overflow trap). Accepts extra div props
 * (data-testid, style) so callers can keep the grid markup declarative.
 */
export default function BentoCard({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      {...rest}
      className={cn(
        'min-w-0 rounded-2xl glass-card p-4 transition-all duration-150 sm:p-5',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Segment color per bucket key. The RETIRED neutral tint is an approved
 *  exemption (TicketBadge precedent); unknown keys fall back to elevated2. */
const BUCKET_COLORS: Record<string, string> = {
  URGENT: 'bg-red-500',
  HIGH: 'bg-orange-500',
  MEDIUM: 'bg-amber-500',
  LOW: 'bg-sky-500',
  IN_STOCK: 'bg-emerald-500',
  ASSIGNED: 'bg-blue-500',
  MAINTENANCE: 'bg-amber-500',
  RETIRED: 'bg-slate-500',
};

/**
 * Segmented distribution bar + clickable legend rows. Each legend row is a
 * button that drills into the filter for its bucket key. Renders nothing
 * when there is no data (older backend during rollout).
 */
export function BucketBar({
  buckets,
  total,
  onSelect,
}: {
  buckets: MetricBucket[];
  total: number;
  onSelect: (key: string) => void;
}) {
  if (buckets.length === 0 || total <= 0) return null;

  return (
    <div className="space-y-2.5">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-elevated">
        {buckets.map((b) => (
          <div
            key={b.key}
            className={BUCKET_COLORS[b.key] ?? 'bg-elevated2'}
            style={{ width: `${(b.count / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="space-y-0.5">
        {buckets.map((b) => {
          const pct = Math.round((b.count / total) * 1000) / 10;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => onSelect(b.key)}
              data-testid={`bucket-${b.key}`}
              data-count={b.count}
              data-label={b.key}
              className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs text-secondary transition-colors hover:bg-elevated/60 hover:text-primary"
            >
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  BUCKET_COLORS[b.key] ?? 'bg-elevated2',
                )}
              />
              <span className="min-w-0 flex-1 truncate">
                {b.key.toLowerCase().replace(/_/g, ' ')}
              </span>
              <span className="shrink-0 tabular-nums text-muted">{b.count}</span>
              <span className="w-12 shrink-0 text-right tabular-nums text-muted">{pct}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
