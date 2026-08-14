import type { AssetStatus, Priority, TicketStatus } from '@/api/types';
import { cn } from '@/lib/utils';

const PRIORITY_STYLES: Record<Priority, string> = {
  URGENT: 'bg-red-500/15 text-red-400 ring-red-500/30',
  HIGH: 'bg-orange-500/15 text-orange-400 ring-orange-500/30',
  MEDIUM: 'bg-yellow-500/15 text-yellow-400 ring-yellow-500/30',
  LOW: 'bg-slate-500/15 text-slate-400 ring-slate-500/30',
};

const STATUS_STYLES: Record<TicketStatus, string> = {
  OPEN: 'bg-blue-500/15 text-blue-400 ring-blue-500/30',
  IN_PROGRESS: 'bg-amber-500/15 text-amber-400 ring-amber-500/30',
  RESOLVED: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30',
  CLOSED: 'bg-slate-500/15 text-slate-400 ring-slate-500/30',
};

const ASSET_STATUS_STYLES: Record<AssetStatus, string> = {
  IN_STOCK: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30',
  ASSIGNED: 'bg-blue-500/15 text-blue-400 ring-blue-500/30',
  MAINTENANCE: 'bg-amber-500/15 text-amber-400 ring-amber-500/30',
  RETIRED: 'bg-slate-500/15 text-slate-400 ring-slate-500/30',
};

function badge(styles: string, label: string) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        styles,
      )}
    >
      {label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return badge(PRIORITY_STYLES[priority], priority);
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  return badge(STATUS_STYLES[status], status.replace('_', ' '));
}

export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  return badge(ASSET_STATUS_STYLES[status], status.replace('_', ' '));
}

export function TicketBadge({
  kind,
  value,
}: {
  kind: 'priority' | 'status';
  value: Priority | TicketStatus;
}) {
  if (kind === 'priority') {
    return <PriorityBadge priority={value as Priority} />;
  }
  return <StatusBadge status={value as TicketStatus} />;
}
