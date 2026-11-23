import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { PriorityBadge } from '@/components/TicketBadge';
import SlaChip from '@/components/SlaChip';
import BentoCard from '@/components/BentoCard';
import { Button } from '@/components/Button';
import {
  Activity,
  AlertTriangle,
  Monitor,
  Play,
  Plus,
  ShieldCheck,
  Ticket,
} from 'lucide-react';
import {
  Link } from 'react-router-dom';
import {
  createTicket, getAuditLog, getDashboardMetrics, getCachedUser, listOverdueTickets } from '@/api/client';
import {
  PRIORITIES, TICKET_TYPES } from '@/api/types';
import type { CreateTicketInput, DashboardMetrics } from '@/api/types';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import AddAssetButton from '@/components/AddAssetButton';
import EmptyState from '@/components/EmptyState';
import VelocityChart from '@/components/VelocityChart';
import ExpiringSoon from '@/components/ExpiringSoon';
import ServiceQueue from '@/components/ServiceQueue';
import { getResolvedTheme, onThemeChanged, setThemeMode } from '@/lib/theme';
import { THEME_REGISTRY } from '@/lib/theme-registry';
import {
  cn, formatDate, inputCls, labelCls } from '@/lib/utils';

/** One KPI lens: whole lens is a Link, visual identical to the reference. */
type KpiLens = {
  label: string;
  to: string;
  /** Solid dot color behind the icon (reference verbatim). */
  dot: string;
  icon: LucideIcon;
  value: (m: DashboardMetrics) => number;
  sub: (m: DashboardMetrics) => string;
};

const KPI_LENSES: KpiLens[] = [
  { label: 'Total Assets', to: '/assets', dot: '#007AFF', icon: Monitor, value: (m) => m.asset_count, sub: (m) => `${m.in_stock_count} in stock` },
  { label: 'Open Tickets', to: '/tickets?status=OPEN', dot: '#AF52DE', icon: Ticket, value: (m) => m.open_tickets, sub: (m) => `${m.high_priority_count} high priority` },
  { label: 'SLA Escalated', to: '/tickets?overdue=true', dot: '#FF3B30', icon: AlertTriangle, value: (m) => m.overdue_tickets, sub: () => 'Breach monitor' },
  { label: 'Warranty & License', to: '/warranty', dot: '#FF9500', icon: ShieldCheck, value: (m) => m.warranty_alerts_count + m.license_alerts, sub: () => 'Expiring ≤ 45d' },
];

const SECONDARY_PILLS: Array<{ label: string; to: string; value: (m: DashboardMetrics) => number }> = [
  { label: 'Onboarding Overdue', to: '/onboarding', value: (m) => m.onboarding_overdue },
  { label: 'Open Requests', to: '/requests', value: (m) => m.open_requests },
];

/**
 * Day / Night Glass quick toggle (reference toolbar). Active state follows
 * the resolved theme (any surface can change it) via getResolvedTheme() +
 * onThemeChanged; clicks push light/dark through setThemeMode (server push
 * included — this is a logged-in surface).
 */
function DayNightToggle() {
  const [resolved, setResolved] = useState(() => getResolvedTheme());

  useEffect(() => onThemeChanged(() => setResolved(getResolvedTheme())), []);

  const isNight = THEME_REGISTRY[resolved]?.dark ?? false;

  return (
    <div className="liquid-glass-pill flex items-center rounded-full p-1">
      <button
        type="button"
        aria-pressed={!isNight}
        onClick={() => setThemeMode('light')}
        className={`rounded-full px-3 py-1 text-xs font-medium transition ${!isNight ? 'bg-white text-slate-900 shadow-xs' : 'text-white/70'}`}
      >
        Day Glass
      </button>
      <button
        type="button"
        aria-pressed={isNight}
        onClick={() => setThemeMode('dark')}
        className={`rounded-full px-3 py-1 text-xs font-medium transition ${isNight ? 'bg-white/25 text-white shadow-xs' : 'text-slate-600'}`}
      >
        Night Glass
      </button>
    </div>
  );
}

function OverdueTickets() {
  const SLA_HOURS: Record<string, number> = { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 };
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
    <section className="rounded-2xl glass-card border-red-500/20 bg-red-500/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-primary">SLA Overdue</h2>
        <Button
          type="button"
          onClick={() => navigate('/tickets?overdue=true')}
          variant="text"
          className="text-xs"
        >
          View all →
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => navigate(`/tickets?open=${t.id}`)}
            className="flex items-center gap-3 rounded-xl glass-card p-2.5 text-left transition-colors"
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
        <Button
          type="button"
          onClick={onDone}
          variant="secondary"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={mutation.isPending}
          loading={mutation.isPending}
          variant="primary"
        >
          Create Ticket
        </Button>
      </div>
    </form>
  );
}

export default function Dashboard() {
  const [newOpen, setNewOpen] = useState(false);
  const [paused, setPaused] = useState(false);

  const metrics = useQuery({ queryKey: ['metrics'], queryFn: getDashboardMetrics });
  const audit = useQuery({
    queryKey: ['audit'],
    queryFn: () => getAuditLog({ limit: 10 }),
    refetchInterval: paused ? false : 30_000,
  });

  return (
    <div className="space-y-6">
      {/* Sticky floating toolbar: Day/Night toggle + actions stay visible
          while scrolling (phones resumed mid-page reported them as 'missing'
          when they were scrolled above the fold). Sticky offsets preserved
          from the previous PageHeader row. */}
      <header
        data-testid="dashboard-toolbar"
        className="liquid-glass-panel rounded-[26px] sticky top-[calc(2.8125rem+env(safe-area-inset-top))] z-30 flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5 lg:top-0"
      >
        <div>
          <div className="text-[11px] font-medium text-muted">
            Inventory, tickets and recent activity at a glance.
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-primary sm:text-xl">
            Dashboard
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DayNightToggle />
          <AddAssetButton />
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="liquid-glass-btn-primary flex items-center gap-1 px-4 py-2 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" /> New Ticket
          </button>
        </div>
      </header>

      {metrics.isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Failed to load metrics:{' '}
          {metrics.error instanceof Error ? metrics.error.message : 'unknown error'}
        </div>
      )}

      {/* KPI lenses: whole lens is a Link (drill-down nav preserved),
          visual identical to the reference. */}
      <section data-testid="kpi-lenses" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {KPI_LENSES.map((k) => (
          <Link
            key={k.label}
            to={k.to}
            className="liquid-glass-panel min-w-0 rounded-[26px] p-5 transition-transform hover:-translate-y-0.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-secondary">{k.label}</span>
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
                style={{ backgroundColor: k.dot }}
              >
                <k.icon className="h-4 w-4" />
              </div>
            </div>
            {metrics.isLoading ? (
              <div className="mt-3 h-9 w-20 animate-pulse rounded bg-elevated" />
            ) : (
              <div className="mt-3 text-3xl font-bold tracking-tight text-primary">
                <CountUp value={metrics.data ? k.value(metrics.data) : 0} />
              </div>
            )}
            <div className="mt-1 truncate text-xs text-muted">
              {metrics.data ? k.sub(metrics.data) : '—'}
            </div>
          </Link>
        ))}
      </section>

      {/* Secondary metric pills. */}
      <section data-testid="secondary-pills" className="flex flex-wrap gap-2">
        {SECONDARY_PILLS.map((pill) => (
          <Link
            key={pill.to}
            to={pill.to}
            className="liquid-glass-pill flex min-w-0 items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-secondary"
          >
            <span className="truncate">{pill.label}</span>
            <span className="shrink-0 font-semibold tabular-nums text-primary">
              {metrics.isLoading ? (
                '…'
              ) : (
                <CountUp value={metrics.data ? pill.value(metrics.data) : 0} />
              )}
            </span>
          </Link>
        ))}
      </section>

      {/* Analytics row: velocity chart (8) + Expiring Soon stack (4),
          both live. Panels are direct grid children so they stretch to
          equal height. */}
      <section data-testid="analytics-row" className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <VelocityChart className="xl:col-span-8" />
        <ExpiringSoon className="xl:col-span-4" />
      </section>

      {/* Live service queue (Task 9): below analytics, above activity. */}
      <ServiceQueue />

      {/* Recent Activity: EXACT existing header + feed, unchanged
          behavior (30s refetch, pause). p-0 keeps the inner px-5 rows at
          their original edge-to-edge rhythm inside the bento shell. */}
      <BentoCard
        className="animate-fade-up p-0 sm:p-0"
        data-testid="bento-activity"
        style={{ animationDelay: `${Math.min(8, 8) * 70}ms` }}
      >
        <div className="flex items-center gap-2 border-b border-edge px-5 py-4">
          <Activity className="h-4 w-4 text-secondary" />
          <h2 className="text-sm font-semibold text-primary">Recent Activity</h2>
          <Button
            type="button"
            onClick={() => setPaused((p) => !p)}
            title={paused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
            variant="ghost"
            className="ml-auto rounded-full border border-edge px-2 py-0.5 text-xs text-muted hover:border-edge2 hover:text-primary"
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
          </Button>
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
            <div className="px-5 py-4">
              <EmptyState
                icon={Activity}
                title="No recent activity"
                description="No audit entries yet. Asset updates and ticket changes will show up here automatically."
              />
            </div>
          )}
        </div>
      </BentoCard>

      {/* SLA Overdue list (admin): unchanged section, moved below the new rows. */}
      <div className="min-w-0">
        <OverdueTickets />
      </div>

      {newOpen && (
        <Modal title="New Ticket" onClose={() => setNewOpen(false)}>
          <NewTicketForm onDone={() => setNewOpen(false)} />
        </Modal>
      )}
    </div>
  );
}
