import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { PriorityBadge } from '@/components/TicketBadge';
import SlaChip from '@/components/SlaChip';
import BentoCard, { BucketBar } from '@/components/BentoCard';
import {
  Timer,
  Activity,
  Boxes,
  ChevronRight,
  LoaderCircle,
  Play,
  Plus,
  BadgeCheck,
  ClipboardList,
  ShieldCheck,
  Ticket,
  TriangleAlert,
  UserRoundCheck,
  X,
} from 'lucide-react';
import {
  Link } from 'react-router-dom';
import {
  createAsset, createTicket, getAuditLog, getDashboardMetrics, getCachedUser, listOverdueTickets } from '@/api/client';
import {
  ASSET_CATEGORIES, ASSET_STATUSES, PRIORITIES, TICKET_TYPES } from '@/api/types';
import type { CreateAssetInput, CreateTicketInput, DashboardMetrics, MetricBucket } from '@/api/types';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import {
  cn, formatDate, inputCls, labelCls } from '@/lib/utils';

/** Scalar metric keys rendered by the KPI chips (breakdown arrays excluded). */
type ChipMetricKey = Exclude<keyof DashboardMetrics, 'tickets_by_priority' | 'assets_by_status'>;

type Chip = {
  label: string;
  key: ChipMetricKey;
  icon: LucideIcon;
  accent: string;
  to: string;
  admin?: boolean;
  /** Desktop: spans 2 columns (fills the row below the top band). */
  wide?: boolean;
};

const SLA_HOURS: Record<string, number> = { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 };

const CHIPS: Chip[] = [
  { label: 'Open Requests', key: 'open_requests', icon: ClipboardList, accent: 'bg-blue-500/10 text-blue-400', to: '/requests' },
  { label: 'SLA Overdue', key: 'overdue_tickets', icon: Timer, accent: 'bg-red-500/10 text-red-400', to: '/tickets?overdue=true', admin: true },
  { label: 'High Priority', key: 'high_priority_count', icon: TriangleAlert, accent: 'bg-red-500/10 text-red-400', to: '/tickets?priority=HIGH' },
  { label: 'Warranty Alerts', key: 'warranty_alerts_count', icon: ShieldCheck, accent: 'bg-amber-500/10 text-amber-400', to: '/warranty' },
  { label: 'Onboarding Overdue', key: 'onboarding_overdue', icon: UserRoundCheck, accent: 'bg-red-500/10 text-red-400', to: '/onboarding', wide: true },
  { label: 'License Alerts', key: 'license_alerts', icon: BadgeCheck, accent: 'bg-red-500/10 text-red-400', to: '/licenses', admin: true, wide: true },
];

function OverdueTickets() {
  const isAdmin = getCachedUser()?.role === 'ADMIN';
  const { data, isLoading } = useQuery({
    queryKey: ['overdue-tickets'],
    queryFn: () => listOverdueTickets(5),
    refetchInterval: 60_000,
    enabled: isAdmin,
  });
  const navigate = useNavigate();
  if (!isAdmin) return null;
  const rows = data?.items ?? [];
  if (isLoading || rows.length === 0) return null;
  return (
    <section className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-primary">SLA Overdue</h2>
        <button
          type="button"
          onClick={() => navigate('/tickets?overdue=true')}
          className="text-xs text-accent hover:underline"
        >
          View all →
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => navigate(`/tickets?open=${t.id}`)}
            className="flex items-center gap-3 rounded-xl border border-edge bg-surface/70 p-2.5 text-left transition-colors hover:bg-elevated/40"
          >
            <span className="font-mono text-xs text-red-400">{t.ticket_number}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-secondary">{t.title}</span>
            <PriorityBadge priority={t.priority} />
            <SlaChip dueAt={t.sla_due_at} policyHours={SLA_HOURS[t.priority]} />
          </button>
        ))}
      </div>
    </section>
  );
}

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
        <label className={labelCls}>Title *</label>
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
          <Select
            className="w-full"
            value={form.ticket_type}
            onChange={(v) => set('ticket_type', v as CreateTicketInput['ticket_type'])}
            options={TICKET_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ') }))}
          />
        </div>
        <div>
          <label className={labelCls}>Priority</label>
          <Select
            className="w-full"
            value={form.priority}
            onChange={(v) => set('priority', v as CreateTicketInput['priority'])}
            options={PRIORITIES.map((p) => ({ value: p, label: p }))}
          />
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
          className="rounded-lg border border-edge2 px-3 py-2 text-sm text-secondary transition-colors hover:bg-elevated"
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
  const [specRows, setSpecRows] = useState<Array<[string, string]>>([]);
  const [purchaseDate, setPurchaseDate] = useState('');
  const [warrantyExpiry, setWarrantyExpiry] = useState('');
  const mutation = useMutation({
    mutationFn: () => {
      const specs: Record<string, string> = {};
      for (const [k, v] of specRows) {
        const key = k.trim();
        if (key) specs[key] = v.trim();
      }
      return createAsset({
        ...form,
        purchase_date: purchaseDate || undefined,
        warranty_expiry: warrantyExpiry || undefined,
        specs: Object.keys(specs).length ? specs : undefined,
      });
    },
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
        mutation.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="asset-name">Name *</label>
          <input
            id="asset-name"
            required
            className={inputCls}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Dell XPS 15"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="asset-tag">Asset Tag</label>
          <input
            id="asset-tag"
            className={inputCls}
            value={form.asset_tag ?? ''}
            onChange={(e) => set('asset_tag', e.target.value)}
            placeholder="e.g. IT-0001"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="asset-serial">Serial Number</label>
          <input
            id="asset-serial"
            className={inputCls}
            value={form.serial_number ?? ''}
            onChange={(e) => set('serial_number', e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div>
          <label className={labelCls}>Category</label>
          <Select
            className="w-full"
            value={form.category}
            onChange={(v) => set('category', v as CreateAssetInput['category'])}
            options={ASSET_CATEGORIES.map((c) => ({ value: c, label: c.replace('_', ' ') }))}
          />
        </div>
      </div>
      <div>
        <label className={labelCls}>Status</label>
        <Select
          className="w-full"
          value={form.status ?? ''}
          onChange={(v) => set('status', v as CreateAssetInput['status'])}
          options={ASSET_STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') }))}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="asset-purchase-date">Purchase Date</label>
          <input
            id="asset-purchase-date"
            type="date"
            className={inputCls}
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="asset-warranty-expiry">Warranty Expiry</label>
          <input
            id="asset-warranty-expiry"
            type="date"
            className={inputCls}
            value={warrantyExpiry}
            onChange={(e) => setWarrantyExpiry(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className={labelCls}>Specifications</label>
        <div className="space-y-2">
          {specRows.map(([k, v], i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={cn(inputCls, 'w-2/5')}
                placeholder="Key (e.g. processor)"
                value={k}
                onChange={(e) =>
                  setSpecRows((rows) => rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))
                }
              />
              <input
                className={cn(inputCls, 'flex-1')}
                placeholder="Value (e.g. Intel i7-13700H)"
                value={v}
                onChange={(e) =>
                  setSpecRows((rows) => rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))
                }
              />
              <button
                type="button"
                aria-label={`Remove spec ${k || i + 1}`}
                onClick={() => setSpecRows((rows) => rows.filter((_, j) => j !== i))}
                className="shrink-0 rounded-lg border border-edge p-2 text-secondary transition-colors hover:bg-elevated hover:text-red-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setSpecRows((rows) => [...rows, ['', '']])}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-edge2 px-3 py-1.5 text-xs text-secondary transition-colors hover:bg-elevated hover:text-primary"
          >
            <Plus className="h-3.5 w-3.5" /> Add specification
          </button>
        </div>
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
          className="rounded-lg border border-edge2 px-3 py-2 text-sm text-secondary transition-colors hover:bg-elevated"
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
  const [paused, setPaused] = useState(false);

  const metrics = useQuery({ queryKey: ['metrics'], queryFn: getDashboardMetrics });
  const audit = useQuery({
    queryKey: ['audit'],
    queryFn: () => getAuditLog({ limit: 10 }),
    refetchInterval: paused ? false : 30_000,
  });

  // Admin-only mutations (backend gated since PR #96) — hide the controls for other roles.
  const isAdmin = getCachedUser()?.role === 'ADMIN';
  const navigate = useNavigate();

  // Breakdown buckets (absent on older backends — BucketBar renders nothing then).
  const priorityBuckets: MetricBucket[] = metrics.data?.tickets_by_priority ?? [];
  const statusBuckets: MetricBucket[] = metrics.data?.assets_by_status ?? [];

  return (
    <div className="space-y-6">
      {/* Sticky actions row: the + New Ticket / + Add Asset buttons must stay
          visible while scrolling (phones resumed mid-page reported them as
          'missing' when they were scrolled above the fold). */}
      <div className="sticky top-[calc(2.8125rem+env(safe-area-inset-top))] z-30 -mx-6 -mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-edge2/80 bg-base/60 px-6 py-2 backdrop-blur-xl backdrop-saturate-150 lg:top-0 lg:mx-0 lg:mt-0 lg:px-0">
        {/* Enhanced header divider: subtle accent gradient line atop the base
            border, giving the Dashboard header section a more defined edge. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-accent/40 via-accent/10 to-transparent"
        />
        <div>
          <h1 className="text-xl font-semibold text-primary">Dashboard</h1>
          <p className="mt-0.5 text-sm text-secondary">
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
          {isAdmin && (
            <button
              type="button"
              onClick={() => setAssetOpen(true)}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-edge2 px-4 text-sm font-medium text-primary transition-all duration-150 hover:bg-elevated active:scale-[0.97]"
            >
              <Plus className="h-4 w-4" /> Add Asset
            </button>
          )}
        </div>
      </div>

      {metrics.isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Failed to load metrics:{' '}
          {metrics.error instanceof Error ? metrics.error.message : 'unknown error'}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {/* Hero: Open Tickets (2×2). BentoCard, NOT a link — the BucketBar
            segments drill into different filters, so the card body has no
            single click target. */}
        <BentoCard
          className="animate-fade-up col-span-2 lg:row-span-2"
          style={{ animationDelay: '0ms' }}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-secondary lg:text-xs">
              Open Tickets
            </p>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 sm:h-9 sm:w-9">
              <Ticket className="h-4 w-4 sm:h-5 sm:w-5" />
            </span>
          </div>
          {metrics.isLoading ? (
            <div className="mt-4 h-10 w-28 animate-pulse rounded bg-elevated" />
          ) : (
            <p className="mt-2 text-3xl font-semibold text-primary" data-testid="hero-open-count">
              <CountUp value={metrics.data?.open_tickets ?? 0} />
            </p>
          )}
          <div className="mt-4">
            <BucketBar
              buckets={priorityBuckets}
              total={metrics.data?.open_tickets ?? 0}
              onSelect={(k) => navigate(`/tickets?status=OPEN&priority=${k}`)}
            />
          </div>
          <Link
            to="/tickets?priority=HIGH"
            className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-secondary transition-colors hover:text-primary"
          >
            {metrics.data?.high_priority_count ?? 0} high priority
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </BentoCard>

        {/* Assets (tall 2×2 — same size as the hero so the status breakdown
            legend is readable): CountUp + status BucketBar. The IN_STOCK row
            doubles as the former In Stock KPI. */}
        <BentoCard
          className="animate-fade-up col-span-2 lg:row-span-2"
          data-testid="bento-assets"
          style={{ animationDelay: '70ms' }}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-secondary lg:text-xs">
              Total Assets
            </p>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent sm:h-9 sm:w-9">
              <Boxes className="h-4 w-4 sm:h-5 sm:w-5" />
            </span>
          </div>
          {metrics.isLoading ? (
            <div className="mt-4 h-10 w-24 animate-pulse rounded bg-elevated" />
          ) : (
            <p className="mt-2 text-3xl font-semibold text-primary" data-testid="asset-total-count">
              <CountUp value={metrics.data?.asset_count ?? 0} />
            </p>
          )}
          <div className="mt-4">
            <BucketBar
              buckets={statusBuckets}
              total={metrics.data?.asset_count ?? 0}
              onSelect={(k) => navigate(`/assets?status=${k}`)}
            />
          </div>
        </BentoCard>

        {/* KPI chips: unchanged card markup, whole-card links. The last two
            chips go 2-col wide on desktop (admin) to fill the row below the
            hero+assets band without dead cells. */}
        {CHIPS.filter((c) => !c.admin || isAdmin).map(({ label, key, icon: Icon, accent, to, wide }, i) => (
          <Link
            key={key}
            to={to}
            className={cn(
              'group animate-fade-up min-w-0 rounded-xl border border-edge bg-surface/60 p-4 transition-all duration-150 hover:border-edge2/80 hover:bg-surface active:scale-[0.98] sm:p-5',
              wide && isAdmin && 'lg:col-span-2',
            )}
            style={{ animationDelay: `${Math.min(i + 2, 8) * 70}ms` }}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[11px] font-medium uppercase tracking-wide text-secondary lg:text-xs">
                {label}
              </p>
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-150 group-hover:scale-110 sm:h-9 sm:w-9',
                  accent,
                )}
              >
                <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
              </span>
            </div>
            {metrics.isLoading ? (
              <div className="mt-3 h-8 w-16 animate-pulse rounded bg-elevated" />
            ) : (
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <p className="text-3xl font-semibold text-primary">
                  <CountUp value={metrics.data?.[key] ?? 0} />
                </p>
                <ChevronRight className="h-4 w-4 shrink-0 translate-x-[-4px] text-muted opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:text-secondary group-hover:opacity-100" />
              </div>
            )}
          </Link>
        ))}

        {/* Recent Activity (2×2): EXACT existing header + feed, unchanged
            behavior (30s refetch, pause). p-0 keeps the inner px-5 rows at
            their original edge-to-edge rhythm inside the bento shell. */}
        <BentoCard
          className="animate-fade-up col-span-2 p-0 sm:p-0 lg:col-span-4"
          data-testid="bento-activity"
          style={{ animationDelay: `${Math.min(8, 8) * 70}ms` }}
        >
          <div className="flex items-center gap-2 border-b border-edge px-5 py-4">
            <Activity className="h-4 w-4 text-secondary" />
            <h2 className="text-sm font-semibold text-primary">Recent Activity</h2>
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              title={paused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-edge px-2 py-0.5 text-xs text-muted transition-colors hover:border-edge2 hover:text-primary"
            >
              {paused ? (
                <Play className="h-3 w-3" />
              ) : (
                <>
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                  auto-refresh 30s
                </>
              )}
              {paused && <span className="text-amber-400">paused</span>}
            </button>
          </div>
          <div className="divide-y divide-edge/60">
            {audit.isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <div className="h-3 w-36 animate-pulse rounded bg-elevated" />
                  <div className="h-3 w-24 animate-pulse rounded bg-elevated" />
                  <div className="h-3 w-32 animate-pulse rounded bg-elevated" />
                </div>
              ))}
            {(audit.data?.items ?? []).map((e, i) => (
              <div
                key={e.id}
                className="animate-list-in flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:gap-3"
                style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="shrink-0 text-xs text-muted">{formatDate(e.created_at)}</span>
                  <span className="min-w-0 truncate text-secondary">
                    {e.actor_name ?? 'system'}
                  </span>
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    title={e.action}
                    className={cn(
                      'shrink-0 rounded px-2 py-0.5 font-mono text-xs',
                      e.action.includes('DELETE') || e.action.includes('DISABLE')
                        ? 'bg-red-500/15 text-red-400'
                        : 'bg-elevated text-secondary',
                    )}
                  >
                    {e.action}
                  </span>
                  <span className="min-w-0 truncate text-xs text-muted">
                    {e.target_type} ·{' '}
                    <span className="font-mono text-accent" title={e.target_id}>{e.target_id}</span>
                  </span>
                </div>
              </div>
            ))}
            {!audit.isLoading && (audit.data?.items ?? []).length === 0 && (
              <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
                <Activity className="h-8 w-8 text-muted" />
                <p className="text-sm text-muted">No audit entries yet.</p>
                <p className="max-w-xs text-xs text-muted">
                  Asset updates and ticket changes will show up here automatically.
                </p>
              </div>
            )}
          </div>
        </BentoCard>

        {/* SLA Overdue list (admin): unchanged section, full-width grid cell. */}
        <div className="col-span-2 min-w-0 lg:col-span-4">
          <OverdueTickets />
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
