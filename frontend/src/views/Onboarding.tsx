import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  ClipboardList,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { cn, formatDateOnly, inputCls, labelCls } from '@/lib/utils';
import EmptyState from '@/components/EmptyState';
import FilterBar from '@/components/FilterBar';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { useServerPagination } from '@/lib/usePagination';
import Modal from '@/components/Modal';
import PaginationFooter from '@/components/PaginationFooter';
import Select from '@/components/Select';
import { FieldError, errProps } from '@/components/FieldError';
import { getCachedUser } from '@/api/client';
import {
  addOnboardingTask,
  createOnboardingEvent,
  deleteOnboardingEvent,
  deleteOnboardingTask,
  getOnboardingDetail,
  getOnboardingEvents,
  updateOnboardingEvent,
  updateOnboardingTask,
} from '@/api/client';
import type {
  CreateTaskInput,
  OnboardingEvent,
  OnboardingEventType,
  OnboardingTask,
  OnboardingTaskCategory,
} from '@/api/types';

const TYPE_STYLE: Record<OnboardingEventType, string> = {
  ONBOARDING: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  OFFBOARDING: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
};

const CAT_STYLE: Record<OnboardingTaskCategory, string> = {
  ASSET: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  LICENSE: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  ACCESS: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  RETURN: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  DATA_WIPE: 'bg-red-500/10 text-red-400 border-red-500/30',
  OTHER: 'bg-elevated/10 text-secondary border-edge2/30',
};

const CATS: OnboardingTaskCategory[] = ['ASSET', 'LICENSE', 'ACCESS', 'RETURN', 'DATA_WIPE', 'OTHER'];

const DEFAULT_ONBOARDING: CreateTaskInput[] = [
  { title: 'Assign laptop/desktop from stock', category: 'ASSET' },
  { title: 'Create / verify email account', category: 'ACCESS' },
  { title: 'Grant shared drive & app access', category: 'ACCESS' },
  { title: 'Issue ID card & desk setup', category: 'OTHER' },
];

const DEFAULT_OFFBOARDING: CreateTaskInput[] = [
  { title: 'Collect company assets', category: 'RETURN' },
  { title: 'Revoke email & app access', category: 'ACCESS' },
  { title: 'Data wipe on returned devices', category: 'DATA_WIPE' },
  { title: 'Exit clearance sign-off', category: 'OTHER' },
];

function Progress({ ev }: { ev: OnboardingEvent }) {
  const pct = ev.total_tasks > 0 ? Math.round((ev.done_tasks / ev.total_tasks) * 100) : 0;
  // Backend allows closing with tasks outstanding (no completion gate in
  // PATCH /onboarding/{id}), so CLOSED + incomplete means "closed early".
  const closedEarly = ev.status === 'CLOSED' && ev.done_tasks < ev.total_tasks;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-elevated">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            pct === 100 ? 'bg-emerald-500' : 'bg-accent',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-secondary">
        {closedEarly ? `Closed early · ${ev.done_tasks}/${ev.total_tasks} tasks done` : `${ev.done_tasks}/${ev.total_tasks}`}
      </span>
    </div>
  );
}

export default function Onboarding() {
  const me = getCachedUser();
  const isAdmin = me?.role === 'ADMIN';
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as OnboardingEventType | null) ?? 'ONBOARDING';
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const qc = useQueryClient();

  const { page, pageSize, setPage, setPageSize, reset, offset } = useServerPagination(20);

  // One query per tab (same pagination): each tab badge counts the same
  // filtered array its list renders — never the raw server total.
  const eventsOn = useQuery({
    queryKey: ['onboarding', 'ONBOARDING', page, pageSize],
    queryFn: () => getOnboardingEvents({ type: 'ONBOARDING', limit: pageSize, offset }),
  });
  const eventsOff = useQuery({
    queryKey: ['onboarding', 'OFFBOARDING', page, pageSize],
    queryFn: () => getOnboardingEvents({ type: 'OFFBOARDING', limit: pageSize, offset }),
  });
  const events = tab === 'OFFBOARDING' ? eventsOff : eventsOn;

  const detail = useQuery({
    queryKey: ['onboarding-detail', selectedId],
    queryFn: () => getOnboardingDetail(selectedId!),
    enabled: !!selectedId,
  });

  const setTab = (t: OnboardingEventType) => {
    const p = new URLSearchParams(params);
    p.set('tab', t);
    setParams(p, { replace: true });
    reset();
  };

  const doneMutation = useMutation({
    mutationFn: ({ task, done }: { task: OnboardingTask; done: boolean }) =>
      updateOnboardingTask(task.id, { status: done ? 'DONE' : 'PENDING' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['onboarding-detail'] });
      qc.invalidateQueries({ queryKey: ['onboarding'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const closeEvent = useMutation({
    mutationFn: (ev: OnboardingEvent) =>
      updateOnboardingEvent(ev.id, { status: ev.status === 'OPEN' ? 'CLOSED' : 'OPEN' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['onboarding'] });
      qc.invalidateQueries({ queryKey: ['onboarding-detail'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const removeEvent = useMutation({
    mutationFn: deleteOnboardingEvent,
    onSuccess: () => {
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });

  const removeTask = useMutation({
    mutationFn: deleteOnboardingTask,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding-detail'] }),
  });

  const list = useMemo(() => events.data?.items ?? [], [events.data]);
  const onCount = eventsOn.data?.items.length ?? 0;
  const offCount = eventsOff.data?.items.length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Onboarding / Offboarding"
        description={
          tab === 'ONBOARDING' ? 'Joiner checklist — assign assets, create access.' : 'Leaver checklist — recover assets, revoke access, flag data wipe.'
        }
        actions={
          isAdmin ? (
            <Button
              onClick={() => setCreating(true)}
              variant="primary"
              leftIcon={<Plus className="h-4 w-4" />}
            >
              New {tab === 'ONBOARDING' ? 'Joiner' : 'Leaver'} Event
            </Button>
          ) : undefined
        }
      />

      {/* Type tabs */}
      <FilterBar>
        <div role="tablist" aria-label="Onboarding views" className="flex flex-1 flex-wrap items-center gap-2">
          {(['ONBOARDING', 'OFFBOARDING'] as const).map((t) => {
            const active = tab === t;
            const count = t === 'ONBOARDING' ? onCount : offCount;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'bg-elevated text-primary' : 'text-secondary hover:text-primary',
                )}
              >
                {t === 'ONBOARDING' ? <ArrowUpCircle className="h-4 w-4" /> : <ArrowDownCircle className="h-4 w-4" />}
                {t === 'ONBOARDING' ? 'Onboarding' : 'Offboarding'}
                <span
                  data-testid="tab-badge"
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                    active ? 'bg-accent/20 text-accent' : 'bg-elevated text-secondary opacity-70',
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </FilterBar>

      {/* Event cards */}
      <div className="flex flex-col gap-3">
        {events.isLoading && (
          <div data-testid="onboarding-skeleton" className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-xl glass-card p-4">
                <div className="h-4 w-full max-w-[140px] animate-pulse rounded bg-elevated" />
                <div className="h-4 w-full max-w-[220px] animate-pulse rounded bg-elevated" />
              </div>
            ))}
          </div>
        )}
        {!events.isLoading && list.length === 0 && (
          <EmptyState
            icon={ClipboardList}
            title={tab === 'ONBOARDING' ? 'No joiner events yet' : 'No leaver events yet'}
            description={
              tab === 'ONBOARDING'
                ? 'Create a joiner event to start tracking assets and access for a new hire.'
                : 'Create a leaver event to track asset recovery, access revocation, and data wipe.'
            }
            action={
              isAdmin ? (
                <Button
                  onClick={() => setCreating(true)}
                  variant="primary"
                  leftIcon={<Plus className="h-4 w-4" />}
                >
                  New {tab === 'ONBOARDING' ? 'Joiner' : 'Leaver'} Event
                </Button>
              ) : undefined
            }
          />
        )}
        {list.map((ev) => (
          <button
            key={ev.id}
            data-testid="onboarding-card"
            onClick={() => setSelectedId(ev.id)}
            className="flex flex-col gap-2 rounded-xl glass-card p-4 text-left transition hover:border-edge2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={cn('rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', TYPE_STYLE[ev.event_type])}>
                  {ev.event_type}
                </span>
                <span className="font-medium text-primary">{ev.person_name}</span>
                <span className="hidden text-xs text-secondary sm:inline">{ev.person_email}</span>
              </div>
              <div className="flex items-center gap-2">
                {ev.overdue_tasks > 0 && ev.status === 'OPEN' && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                    <AlertTriangle className="h-3 w-3" /> {ev.overdue_tasks} overdue
                  </span>
                )}
                <span
                  className={cn(
                    'rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                    ev.status === 'OPEN'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-elevated/10 text-secondary border-edge2/30',
                  )}
                >
                  {ev.status}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Progress ev={ev} />
              <span className="text-xs text-muted">
                {ev.event_type === 'OFFBOARDING'
                  ? (ev.start_date ? `Last day ${formatDateOnly(ev.start_date)}` : 'No last day set')
                  : (ev.start_date ? `Start date ${formatDateOnly(ev.start_date)}` : 'No start date')}
              </span>
            </div>
          </button>
        ))}
      </div>

      {!events.isLoading && (events.data?.total ?? 0) > 0 && (
        <PaginationFooter
          variant="static"
          page={page}
          pageSize={pageSize}
          total={events.data?.total}
          rowsLength={list.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}

      {/* Create modal */}
      {creating && (
        <CreateEventModal
          type={tab}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            qc.invalidateQueries({ queryKey: ['onboarding'] });
            qc.invalidateQueries({ queryKey: ['dashboard'] });
          }}
        />
      )}

      {/* Detail modal */}
      {selectedId && detail.data && (
        <EventDetailModal
          detail={detail.data}
          isAdmin={isAdmin}
          onClose={() => setSelectedId(null)}
          onToggle={doneMutation.mutate}
          onToggleEvent={closeEvent.mutate}
          onDeleteEvent={() => removeEvent.mutate(selectedId)}
          onDeleteTask={removeTask.mutate}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ['onboarding-detail'] });
            qc.invalidateQueries({ queryKey: ['onboarding'] });
            qc.invalidateQueries({ queryKey: ['dashboard'] });
          }}
          onEdit={() => setEditingEventId(selectedId)}
        />
      )}

      {editingEventId && detail.data && (
        <EditEventModal
          event={detail.data.event}
          onClose={() => setEditingEventId(null)}
          onSaved={() => {
            setEditingEventId(null);
            qc.invalidateQueries({ queryKey: ['onboarding-detail'] });
            qc.invalidateQueries({ queryKey: ['onboarding'] });
          }}
        />
      )}
    </div>
  );
}

// ── Create modal ────────────────────────────────────────────────────────────

function CreateEventModal({
  type,
  onClose,
  onCreated,
}: {
  type: OnboardingEventType;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [startDate, setStartDate] = useState('');
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [tasks, setTasks] = useState<CreateTaskInput[]>(
    type === 'ONBOARDING' ? [...DEFAULT_ONBOARDING] : [...DEFAULT_OFFBOARDING],
  );

  const create = useMutation({
    mutationFn: () =>
      createOnboardingEvent({
        event_type: type,
        person_name: name,
        person_email: email,
        start_date: startDate || null,
        tasks: tasks.filter((t) => t.title.trim()),
      }),
    onSuccess: onCreated,
  });

  const setTask = (i: number, patch: Partial<CreateTaskInput>) =>
    setTasks((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

  // FORM-02: submit-time inline validation — an empty/invalid submit shows
  // FieldError messages and focuses the first invalid field, never silent.
  const submit = () => {
    const e: { name?: string; email?: string } = {};
    if (!name.trim()) e.name = 'Full name is required';
    if (!email.trim()) {
      e.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      e.email = 'Enter a valid email address';
    }
    setErrors(e);
    if (e.name) {
      document.getElementById('onboard-name')?.focus();
      return;
    }
    if (e.email) {
      document.getElementById('onboard-email')?.focus();
      return;
    }
    create.mutate();
  };

  return (
    <Modal onClose={onClose} title={`New ${type === 'ONBOARDING' ? 'Joiner' : 'Leaver'} Event`}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1" htmlFor="onboard-name">
            <span className={labelCls}>
              Full name <span aria-hidden="true" className="text-red-400">*</span>
            </span>
            <input
              id="onboard-name"
              className={inputCls}
              value={name}
              aria-required="true"
              {...errProps('onboard-name', errors.name)}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors((er) => ({ ...er, name: undefined }));
              }}
              placeholder="e.g. Priya Sharma"
            />
            <FieldError id="onboard-name-error" error={errors.name} />
          </label>
          <label className="flex flex-col gap-1" htmlFor="onboard-email">
            <span className={labelCls}>
              Email <span aria-hidden="true" className="text-red-400">*</span>
            </span>
            <input
              id="onboard-email"
              className={inputCls}
              value={email}
              aria-required="true"
              {...errProps('onboard-email', errors.email)}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) setErrors((er) => ({ ...er, email: undefined }));
              }}
              placeholder="e.g. priya@company.com"
            />
            <FieldError id="onboard-email-error" error={errors.email} />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Start date</span>
          <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className={labelCls}>Checklist</span>
            <Button
              type="button"
              onClick={() => setTasks((ts) => [...ts, { title: '', category: 'OTHER' }])}
              variant="ghost"
              className="gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10"
              leftIcon={<Plus className="h-3 w-3" />}
            >
              Add row
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {tasks.map((t, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                <input
                  className={cn(inputCls, 'min-w-0 flex-1')}
                  value={t.title}
                  onChange={(e) => setTask(i, { title: e.target.value })}
                  placeholder="Task title"
                  aria-label={`Task ${i + 1} title`}
                />
                <Select
                  value={t.category ?? 'OTHER'}
                  onChange={(v) => setTask(i, { category: v as OnboardingTaskCategory })}
                  options={CATS.map((c) => ({ value: c, label: c.replace('_', ' ') }))}
                  className="w-32 sm:w-36"
                />
                <Button
                  type="button"
                  onClick={() => setTasks((ts) => ts.filter((_, idx) => idx !== i))}
                  variant="ghost"
                  size="icon"
                  className="p-1.5 text-muted hover:text-red-400"
                  aria-label={`Delete task ${i + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        {create.isError && (
          <p role="alert" className="text-xs text-red-400">Failed to create event. Please try again.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="secondary">Cancel</Button>
          <Button
            onClick={submit}
            disabled={create.isPending}
            loading={create.isPending}
            variant="primary"
          >
            Create Event
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Detail modal ────────────────────────────────────────────────────────────

function EventDetailModal({
  detail,
  isAdmin,
  onClose,
  onToggle,
  onToggleEvent,
  onDeleteEvent,
  onDeleteTask,
  onChanged,
  onEdit,
}: {
  detail: { event: OnboardingEvent; tasks: OnboardingTask[] };
  isAdmin: boolean;
  onClose: () => void;
  onToggle: (a: { task: OnboardingTask; done: boolean }) => void;
  onToggleEvent: (ev: OnboardingEvent) => void;
  onDeleteEvent: () => void;
  onDeleteTask: (taskId: string) => void;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const { event: ev, tasks } = detail;
  const [deleting, setDeleting] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCat, setNewCat] = useState<OnboardingTaskCategory>('OTHER');

  const addTask = useMutation({
    mutationFn: () => addOnboardingTask(ev.id, { title: newTitle, category: newCat }),
    onSuccess: () => {
      setNewTitle('');
      onChanged();
    },
  });

  return (
    <Modal onClose={onClose} title={ev.person_name}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', TYPE_STYLE[ev.event_type])}>
            {ev.event_type}
          </span>
          <span className="text-sm text-secondary">{ev.person_email}</span>
          <span
            className={cn(
              'rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              ev.status === 'OPEN' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-elevated/10 text-secondary border-edge2/30',
            )}
          >
            {ev.status}
          </span>
          {ev.overdue_tasks > 0 && ev.status === 'OPEN' && (
            <span className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400">
              <AlertTriangle className="h-3 w-3" /> {ev.overdue_tasks} overdue
            </span>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {tasks.length === 0 && (
            <p className="rounded-lg glass-dense border-dashed p-4 text-center text-xs text-secondary">No checklist tasks yet.</p>
          )}
          {tasks.map((t) => {
            const overdue = t.status === 'PENDING' && t.due_date && t.due_date < new Date().toISOString().slice(0, 10);
            return (
              <div key={t.id} className={cn('rounded-xl glass-dense p-3 transition', t.status === 'DONE' && 'opacity-80', overdue && 'border-red-500/40')}>
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => onToggle({ task: t, done: t.status !== 'DONE' })}
                    className={cn(
                      'mt-0.5 rounded-full p-1 transition',
                      t.status === 'DONE' ? 'bg-emerald-500/15 text-emerald-400' : 'text-muted hover:bg-elevated hover:text-accent',
                    )}
                    title={t.status === 'DONE' ? 'Mark pending' : 'Mark done'}
                  >
                    {t.status === 'DONE' ? <CheckCircle2 className="h-5 w-5" /> : <span className="block h-5 w-5 rounded-full border-2 border-current" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('text-sm font-medium', t.status === 'DONE' && 'line-through')}>{t.title}</span>
                      <span className={cn('rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', CAT_STYLE[t.category])}>{t.category}</span>
                      {t.asset_tag && (
                        <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">{t.asset_tag}</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
                      {t.due_date && (
                        <span className={cn(overdue && 'font-semibold text-red-400')}>
                          Due {formatDateOnly(t.due_date)}
                          {overdue && ' · OVERDUE'}
                        </span>
                      )}
                      {t.completed_at && <span>Done {new Date(t.completed_at).toLocaleDateString()}</span>}
                      {t.note && <span>{t.note}</span>}
                    </div>
                  </div>
                  <Button
                    onClick={() => onDeleteTask(t.id)}
                    variant="ghost"
                    size="icon"
                    className="p-1 text-muted hover:text-red-400"
                    title="Delete task"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* add task */}
        <div className="flex items-center gap-2">
          <input
            className={cn(inputCls, 'flex-1')}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Add checklist item…"
            onKeyDown={(e) => e.key === 'Enter' && newTitle.trim() && addTask.mutate()}
          />
          <Select
            value={newCat}
            onChange={(v) => setNewCat(v as OnboardingTaskCategory)}
            options={CATS.map((c) => ({ value: c, label: c.replace('_', ' ') }))}
            className="w-32"
          />
          <Button
            onClick={() => newTitle.trim() && addTask.mutate()}
            disabled={!newTitle.trim()}
            loading={addTask.isPending}
            variant="primary"
            size="sm"
          >
            Add
          </Button>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-edge pt-3">
          {isAdmin && (
            <>
              <Button onClick={onEdit} variant="secondary" size="sm" className="border-edge" leftIcon={<Pencil className="h-3.5 w-3.5" />}>
                Edit
              </Button>
              <Button onClick={() => onToggleEvent(ev)} variant="secondary" size="sm" className="border-edge">
                {ev.status === 'OPEN' ? 'Close event' : 'Reopen event'}
              </Button>
              {deleting ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-secondary">Delete {ev.person_name.split(' ')[0]}'s event + all tasks?</span>
                  <Button
                    onClick={() => {
                      onDeleteEvent();
                      setDeleting(false);
                    }}
                    variant="danger"
                    size="sm"
                    className="px-2.5 py-1.5 text-[11px]"
                  >
                    Yes, delete
                  </Button>
                  <Button onClick={() => setDeleting(false)} variant="secondary" size="sm" className="border-edge px-2.5 py-1.5 text-[11px]">
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button onClick={() => setDeleting(true)} variant="secondary" size="sm" className="border-red-500/30 text-red-400 hover:bg-red-500/10" leftIcon={<Trash2 className="h-3.5 w-3.5" />}>
                  Delete
                </Button>
              )}
            </>
          )}
          <Button onClick={onClose} variant="primary" size="sm">Done</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Edit event modal (ADMIN) ────────────────────────────────────────────────

function EditEventModal({
  event,
  onClose,
  onSaved,
}: {
  event: OnboardingEvent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(event.person_name);
  const [email, setEmail] = useState(event.person_email);
  const [startDate, setStartDate] = useState(event.start_date ?? '');
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});

  const save = useMutation({
    mutationFn: () =>
      updateOnboardingEvent(event.id, {
        person_name: name.trim() || undefined,
        person_email: email.trim() || undefined,
        start_date: startDate || null,
      }),
    onSuccess: onSaved,
  });

  // FORM-02: same submit-time inline validation as the create modal.
  const submit = () => {
    const e: { name?: string; email?: string } = {};
    if (!name.trim()) e.name = 'Full name is required';
    if (!email.trim()) {
      e.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      e.email = 'Enter a valid email address';
    }
    setErrors(e);
    if (e.name) {
      document.getElementById('edit-event-name')?.focus();
      return;
    }
    if (e.email) {
      document.getElementById('edit-event-email')?.focus();
      return;
    }
    save.mutate();
  };

  return (
    <Modal onClose={onClose} title="Edit event">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1" htmlFor="edit-event-name">
          <span className={labelCls}>
            Full name <span aria-hidden="true" className="text-red-400">*</span>
          </span>
          <input
            id="edit-event-name"
            className={inputCls}
            value={name}
            aria-required="true"
            {...errProps('edit-event-name', errors.name)}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) setErrors((er) => ({ ...er, name: undefined }));
            }}
          />
          <FieldError id="edit-event-name-error" error={errors.name} />
        </label>
        <label className="flex flex-col gap-1" htmlFor="edit-event-email">
          <span className={labelCls}>
            Email <span aria-hidden="true" className="text-red-400">*</span>
          </span>
          <input
            id="edit-event-email"
            className={inputCls}
            value={email}
            aria-required="true"
            {...errProps('edit-event-email', errors.email)}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errors.email) setErrors((er) => ({ ...er, email: undefined }));
            }}
          />
          <FieldError id="edit-event-email-error" error={errors.email} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Start date</span>
          <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="secondary">Cancel</Button>
          <Button
            onClick={submit}
            loading={save.isPending}
            variant="primary"
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
