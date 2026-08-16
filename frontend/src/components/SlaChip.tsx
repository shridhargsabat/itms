import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

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

export default function SlaChip({ dueAt, policyHours }: { dueAt: string | null; policyHours?: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!dueAt) return <span className="text-[10px] text-muted">SLA —</span>;
  const due = new Date(dueAt).getTime();
  const now = Date.now();
  const left = due - now;
  const overdue = left < 0;
  const total = (policyHours ?? 24) * 3_600_000;
  const frac = total > 0 ? Math.abs(left) / total : 1;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold',
        overdue
          ? 'bg-red-500/15 text-red-400'
          : frac <= 0.5
            ? 'bg-amber-500/15 text-amber-400'
            : 'bg-emerald-500/15 text-emerald-400',
      )}
      title={`SLA due ${due.toLocaleString()}`}
    >
      {overdue ? `OVERDUE ${formatSla(left)}` : `SLA ${formatSla(left)}`}
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
