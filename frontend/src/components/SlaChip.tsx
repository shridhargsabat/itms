import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { TicketStatus } from '@/api/types';

// P1-4: live SLA countdown chip. Colors: green = >50% left, amber = <=50%,
// red = overdue (or <=10 min). Recomputes every 30 s.
export function formatSla(ms: number): string {
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// UX-35 (#209): resolved/closed tickets get one coherent neutral state instead
// of a live countdown (or the old dash chip).
const CLOSED_STATUSES: ReadonlySet<string> = new Set(['RESOLVED', 'CLOSED']);

export default function SlaChip({
  dueAt,
  policyHours,
  status,
}: {
  dueAt: string | null;
  policyHours?: number;
  status?: TicketStatus | string;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // UX-35 (#209): single coherent state for resolved tickets — the SLA no
  // longer ticks once the ticket is resolved/closed.
  if (status && CLOSED_STATUSES.has(status)) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-slate-500/15 px-2.5 py-0.5 font-mono text-xs font-semibold text-secondary"
        title={`Ticket ${String(status).replace('_', ' ')} — SLA no longer applies`}
      >
        SLA closed
      </span>
    );
  }
  // UX-13a (#187): 12px floor (was text-[10px]); UX-35 (#209): the bare dash
  // chip is gone — open tickets without an SLA say so plainly.
  if (!dueAt) return <span className="text-xs text-muted">No SLA</span>;
  const due = new Date(dueAt).getTime();
  const now = Date.now();
  const left = due - now;
  const overdue = left < 0;
  // TFE-37: red when overdue OR within 10 min of breach (matches the header comment).
  const critical = left <= 10 * 60_000;
  // UX-39 (#213): pre-breach red chips name the urgency in words.
  const dueSoon = !overdue && critical;
  const total = (policyHours ?? 24) * 3_600_000;
  const frac = total > 0 ? Math.abs(left) / total : 1;

  return (
    <span
      className={cn(
        // UX-13a (#187): 12px floor (was text-[10px]).
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold',
        critical
          ? 'bg-red-500/15 text-red-700 dark:text-red-400'
          : frac <= 0.5
            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
            : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
      )}
      title={`SLA due ${new Date(dueAt).toLocaleString()}`}
    >
      {overdue ? `OVERDUE ${formatSla(left)}` : dueSoon ? `SLA ${formatSla(left)} · due soon` : `SLA ${formatSla(left)}`}
    </span>
  );
}

export function SlaBar({ dueAt, policyHours }: { dueAt: string | null; policyHours?: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!dueAt) return null;
  const due = new Date(dueAt).getTime();
  const left = due - Date.now();
  const total = (policyHours ?? 24) * 3_600_000;
  const frac = Math.max(0, Math.min(1, left / total));
  const overdue = left < 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-edge/60">
      <div
        className={cn('h-full rounded-full', overdue ? 'bg-red-500' : frac <= 0.5 ? 'bg-amber-500' : 'bg-emerald-500')}
        style={{ width: `${(overdue ? 0 : frac) * 100}%` }}
      />
    </div>
  );
}
