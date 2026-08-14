import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Boxes,
  LoaderCircle,
  PackageCheck,
  Plus,
  Ticket,
  TriangleAlert,
} from 'lucide-react';
import { createAsset, createTicket, getAuditLog, getDashboardMetrics } from '@/api/client';
import { ASSET_CATEGORIES, ASSET_STATUSES, PRIORITIES, TICKET_TYPES } from '@/api/types';
import type { CreateAssetInput, CreateTicketInput, DashboardMetrics } from '@/api/types';
import Modal from '@/components/Modal';
import { cn, formatDate, inputCls, labelCls } from '@/lib/utils';

const METRIC_CARDS: {
  label: string;
  key: keyof DashboardMetrics;
  icon: LucideIcon;
  accent: string;
}[] = [
  { label: 'Total Assets', key: 'asset_count', icon: Boxes, accent: 'bg-indigo-500/10 text-indigo-400' },
  { label: 'Open Tickets', key: 'open_tickets', icon: Ticket, accent: 'bg-blue-500/10 text-blue-400' },
  { label: 'High Priority', key: 'high_priority_count', icon: TriangleAlert, accent: 'bg-red-500/10 text-red-400' },
  { label: 'In Stock', key: 'in_stock_count', icon: PackageCheck, accent: 'bg-emerald-500/10 text-emerald-400' },
];

function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const dur = 650;
    const tick = (t: number) => {
      const p = Math.min((t - t0) / dur, 1);
      setDisplay(Math.round(value * (1 - Math.pow(1 - p, 3)))); // ease-out cubic
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{display}</>;
}

function NewTicketForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateTicketInput>({
    title: '',
    description: '',
    ticket_type: 'INCIDENT',
    priority: 'MEDIUM',
  });
  const mutation = useMutation({
    mutationFn: createTicket,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['metrics'] });
      onDone();
    },
  });
  const set = <K extends keyof CreateTicketInput>(k: K, v: CreateTicketInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <form
      className="space-y-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        mutation.mutate(form);
      }}
    >
      <div>
        <label className={labelCls}>Title</label>
        <input
          required
          className={inputCls}
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="What's the issue?"
        />
      </div>
      <div>
        <label className={labelCls}>Description</label>
        <textarea
          className={inputCls}
          rows={3}
          value={form.description ?? ''}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Details (optional)"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Type</label>
          <select
            className={inputCls}
            value={form.ticket_type}
            onChange={(e) => set('ticket_type', e.target.value as CreateTicketInput['ticket_type'])}
          >
            {TICKET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Priority</label>
          <select
            className={inputCls}
            value={form.priority}
            onChange={(e) => set('priority', e.target.value as CreateTicketInput['priority'])}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className={labelCls}>Requester ID</label>
        <input
          className={inputCls}
          value={form.requester_id ?? ''}
          onChange={(e) => set('requester_id', e.target.value)}
          placeholder="User ID (optional)"
        />
      </div>
      {mutation.isError && (
        <p className="text-xs text-red-400">
          {mutation.error instanceof Error ? mutation.error.message : 'Failed to create ticket.'}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
        >
          {mutation.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
          Create Ticket
        </button>
      </div>
    </form>
  );
}

function AddAssetForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateAssetInput>({
    name: '',
    asset_tag: '',
    serial_number: '',
    category: 'LAPTOP',
    status: 'IN_STOCK',
  });
  const mutation = useMutation({
    mutationFn: createAsset,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['metrics'] });
      onDone();
    },
  });
  const set = <K extends keyof CreateAssetInput>(k: K, v: CreateAssetInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <form
      className="space-y-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        mutation.mutate(form);
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Name</label>
          <input
            required
            className={inputCls}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Dell XPS 15"
          />
        </div>
        <div>
          <label className={labelCls}>Asset Tag</label>
          <input
            className={inputCls}
            value={form.asset_tag ?? ''}
            onChange={(e) => set('asset_tag', e.target.value)}
            placeholder="e.g. IT-0001"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Serial Number</label>
          <input
            className={inputCls}
            value={form.serial_number ?? ''}
            onChange={(e) => set('serial_number', e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div>
          <label className={labelCls}>Category</label>
          <select
            className={inputCls}
            value={form.category}
            onChange={(e) => set('category', e.target.value as CreateAssetInput['category'])}
          >
            {ASSET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className={labelCls}>Status</label>
        <select
          className={inputCls}
          value={form.status}
          onChange={(e) => set('status', e.target.value as CreateAssetInput['status'])}
        >
          {ASSET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>
      {mutation.isError && (
        <p className="text-xs text-red-400">
          {mutation.error instanceof Error ? mutation.error.message : 'Failed to create asset.'}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-60"
        >
          {mutation.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
          Add Asset
        </button>
      </div>
    </form>
  );
}

export default function Dashboard() {
  const [newOpen, setNewOpen] = useState(false);
  const [assetOpen, setAssetOpen] = useState(false);

  const metrics = useQuery({ queryKey: ['metrics'], queryFn: getDashboardMetrics });
  const audit = useQuery({
    queryKey: ['audit'],
    queryFn: () => getAuditLog(10),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Inventory, tickets and recent activity at a glance.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-all duration-150 hover:bg-blue-500 active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" /> New Ticket
          </button>
          <button
            type="button"
            onClick={() => setAssetOpen(true)}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-700 px-4 text-sm font-medium text-slate-200 transition-all duration-150 hover:bg-slate-800 active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" /> Add Asset
          </button>
        </div>
      </div>

      {metrics.isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Failed to load metrics:{' '}
          {metrics.error instanceof Error ? metrics.error.message : 'unknown error'}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {METRIC_CARDS.map(({ label, key, icon: Icon, accent }, i) => (
          <div
            key={key}
            className="animate-fade-up rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-400 lg:text-xs">
                {label}
              </p>
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-9 sm:w-9',
                  accent,
                )}
              >
                <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
              </span>
            </div>
            {metrics.isLoading ? (
              <div className="mt-3 h-8 w-16 animate-pulse rounded bg-slate-800" />
            ) : (
              <p className="mt-2 text-3xl font-semibold text-slate-100">
                <CountUp value={metrics.data?.[key] ?? 0} />
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60">
        <div className="flex items-center gap-2 border-b border-slate-800 px-5 py-4">
          <Activity className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-200">Recent Activity</h2>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            auto-refresh 30s
          </span>
        </div>
        <div className="divide-y divide-slate-800/60">
          {audit.isLoading &&
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <div className="h-3 w-36 animate-pulse rounded bg-slate-800" />
                <div className="h-3 w-24 animate-pulse rounded bg-slate-800" />
                <div className="h-3 w-32 animate-pulse rounded bg-slate-800" />
              </div>
            ))}
          {(audit.data ?? []).map((e) => (
            <div
              key={e.id}
              className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:gap-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="shrink-0 text-xs text-slate-500">{formatDate(e.created_at)}</span>
                <span className="min-w-0 truncate text-slate-300">
                  {e.actor_name ?? 'system'}
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-3">
                <span className="shrink-0 rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-300">
                  {e.action}
                </span>
                <span className="min-w-0 truncate text-xs text-slate-500">
                  {e.target_type} ·{' '}
                  <span className="font-mono text-indigo-400">{e.target_id}</span>
                </span>
              </div>
            </div>
          ))}
          {!audit.isLoading && (audit.data ?? []).length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-slate-500">No audit entries yet.</p>
          )}
        </div>
      </div>

      {newOpen && (
        <Modal title="New Ticket" onClose={() => setNewOpen(false)}>
          <NewTicketForm onDone={() => setNewOpen(false)} />
        </Modal>
      )}
      {assetOpen && (
        <Modal title="Add Asset" onClose={() => setAssetOpen(false)}>
          <AddAssetForm onDone={() => setAssetOpen(false)} />
        </Modal>
      )}
    </div>
  );
}
