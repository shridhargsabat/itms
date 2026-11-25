import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, Search, Ticket, X } from 'lucide-react';
import { listTickets, patchTicketStatus, getSlaPolicy } from '@/api/client';
import { ALLOWED_TICKET_TRANSITIONS } from '@/api/types';
import type { Ticket as TicketRecord, TicketStatus } from '@/api/types';
import { PriorityBadge, StatusBadge } from '@/components/TicketBadge';
import SlaChip from '@/components/SlaChip';
import Select from '@/components/Select';
import EmptyState from '@/components/EmptyState';

// TFE-28: fallback only — live values come from GET /sla/policy (slaHours below).
const FALLBACK_SLA_HOURS: Record<string, number> = { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 };

/** Server-side live statuses for the queue query (C2 multi-status). */
const QUEUE_STATUS = 'OPEN,IN_PROGRESS';

/**
 * Live service queue (Task 9): OPEN/IN_PROGRESS tickets with client-side
 * filter, PriorityBadge + SlaChip rows, and an inspect slide-over with an
 * inline status Select. No admin gate — every signed-in user sees it.
 */
export default function ServiceQueue() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<TicketStatus | null>(null);
  // TFE-30: last-selected snapshot so the drawer survives refetches that drop
  // the ticket from the live window.
  const [snapshot, setSnapshot] = useState<TicketRecord | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['service-queue'],
    // TFE-02: server-side live-status filter (C2) — no more newest-25 window.
    queryFn: () => listTickets({ status: QUEUE_STATUS, limit: 50 }),
    refetchInterval: 60_000,
  });

  // TFE-28: live SLA policy with const fallback (policy rarely changes).
  const slaPolicy = useQuery({ queryKey: ['sla-policy'], queryFn: getSlaPolicy, staleTime: 5 * 60_000 });
  const slaHours = useMemo<Record<string, number>>(() => {
    if (!slaPolicy.data) return FALLBACK_SLA_HOURS;
    const hours = { ...FALLBACK_SLA_HOURS };
    for (const [k, v] of Object.entries(slaPolicy.data)) {
      if (v && typeof v.hours === 'number') hours[k] = v.hours;
    }
    return hours;
  }, [slaPolicy.data]);

  const rows = useMemo(() => {
    const items = data?.items ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.ticket_number.toLowerCase().includes(q) ||
        (t.asset_tag ?? '').toLowerCase().includes(q),
    );
  }, [data, filter]);

  const liveSelected = (data?.items ?? []).find((t) => t.id === selectedId) ?? null;
  const selected = liveSelected ?? (selectedId && snapshot?.id === selectedId ? snapshot : null);
  const selectionStale = selected !== null && liveSelected === null;
  // TFE-19: badges/Select render the post-mutation status (cache lags behind).
  const displayStatus: TicketStatus = confirmed ?? selected?.status ?? 'OPEN';

  const close = () => {
    setSelectedId(null);
    setConfirmed(null);
    setSnapshot(null);
  };

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.defaultPrevented || document.querySelector('[role="listbox"]')) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected]);

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TicketStatus }) =>
      patchTicketStatus(id, status),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['service-queue'] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['metrics'] });
      setConfirmed(t.status);
    },
  });

  return (
    <>
      <section
        data-testid="service-queue"
        className="liquid-glass-panel min-w-0 space-y-3 rounded-[28px] p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-primary">Live Service Queue</h2>
          <div className="relative">
            <Search className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter tickets..."
              aria-label="Filter service queue"
              className="liquid-glass-pill rounded-full py-1.5 pr-4 pl-8 text-xs text-primary focus:outline-none"
            />
          </div>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-[20px] bg-elevated" />
            ))}
          </div>
        ) : isError ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
            Failed to load the service queue.
          </p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Ticket}
            title="Queue is clear"
            description="No open tickets match. New incidents and requests will show up here automatically."
          />
        ) : (
          <div className="space-y-2">
            {rows.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setSelectedId(t.id);
                  setSnapshot(t);
                  setConfirmed(null);
                }}
                className="liquid-glass-subcard w-full cursor-pointer rounded-[20px] p-3.5 transition"
              >
                <span className="flex flex-wrap items-center justify-between gap-3 text-left">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-[#007AFF]">
                        {t.ticket_number}
                      </span>
                      <span className="truncate text-xs font-medium text-primary sm:text-sm">
                        {t.title}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted">
                      CI: {t.asset_tag ?? '—'} · Assignee: {t.assignee_name ?? 'Unassigned'}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <PriorityBadge priority={t.priority} />
                    <SlaChip dueAt={t.sla_due_at} policyHours={slaHours[t.priority]} />
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {selected &&
        createPortal(
          <>
            <div
              data-testid="service-queue-scrim"
              className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
              onClick={close}
            />
            <div
              data-testid="service-queue-drawer"
              role="dialog"
              aria-label={`Inspect ${selected.ticket_number}`}
              className="liquid-glass-panel fixed inset-y-0 right-0 z-[60] w-full max-w-md overflow-y-auto p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
            >
            <div className="flex flex-col justify-between gap-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-[#007AFF]">
                    {selected.ticket_number}
                  </span>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="Close ticket details"
                    className="liquid-glass-subcard rounded-full p-1.5"
                  >
                    <X className="h-4 w-4 text-secondary" />
                  </button>
                </div>
                <h3 className="text-base font-semibold text-primary">{selected.title}</h3>
                {selectionStale && (
                  <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400">
                    This ticket is no longer in the queue — showing its last-known details.
                  </p>
                )}
                <p className="text-xs leading-relaxed text-secondary">
                  {selected.description || 'No description provided.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={displayStatus} />
                  <PriorityBadge priority={selected.priority} />
                  <SlaChip dueAt={selected.sla_due_at} policyHours={slaHours[selected.priority]} />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted">Update Status</label>
                  <Select
                    className="w-full"
                    value={displayStatus}
                    ariaLabel="Update Status"
                    onChange={(v) => {
                      // TFE-20: selecting the current status is a no-op (no pointless PATCH).
                      if (v === displayStatus) return;
                      setConfirmed(null);
                      updateStatus.mutate({ id: selected.id, status: v as TicketStatus });
                    }}
                    options={[displayStatus, ...(ALLOWED_TICKET_TRANSITIONS[displayStatus] ?? [])].map((s) => ({ value: s, label: s }))}
                  />
                  {confirmed && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Status updated to {confirmed}
                    </p>
                  )}
                  {updateStatus.isError && (
                    <p className="mt-2 text-xs text-red-700 dark:text-red-400">
                      {updateStatus.error instanceof Error
                        ? updateStatus.error.message
                        : 'Failed to update status.'}
                    </p>
                  )}
                </div>
              </div>
              <Link
                to={`/tickets?open=${selected.id}`}
                className="text-xs font-semibold text-[#007AFF] hover:underline"
              >
                Open in Service Desk →
              </Link>
            </div>
          </div>
          </>,
          document.body,
        )}
    </>
  );
}
