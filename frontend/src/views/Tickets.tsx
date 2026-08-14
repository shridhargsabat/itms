import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, Columns3, Link2, LoaderCircle, Plus, Table, User } from 'lucide-react';
import { createTicket, listTickets, patchTicketStatus } from '@/api/client';
import { PRIORITIES, TICKET_STATUSES, TICKET_TYPES } from '@/api/types';
import type { CreateTicketInput, Ticket, TicketStatus } from '@/api/types';
import DataTable, { type Column } from '@/components/DataTable';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { PriorityBadge, StatusBadge } from '@/components/TicketBadge';
import { cn, formatDate, inputCls, labelCls } from '@/lib/utils';

const NEXT_STATUS: Partial<Record<TicketStatus, TicketStatus>> = {
  OPEN: 'IN_PROGRESS',
  IN_PROGRESS: 'RESOLVED',
};

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
      <div className="grid grid-cols-2 gap-3">
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Requester ID</label>
          <input
            className={inputCls}
            value={form.requester_id ?? ''}
            onChange={(e) => set('requester_id', e.target.value)}
            placeholder="User ID (optional)"
          />
        </div>
        <div>
          <label className={labelCls}>Asset ID</label>
          <input
            className={inputCls}
            value={form.asset_id ?? ''}
            onChange={(e) => set('asset_id', e.target.value)}
            placeholder="Linked asset (optional)"
          />
        </div>
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

export default function Tickets() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const status = params.get('status') ?? '';
  const priority = params.get('priority') ?? '';
  const type = params.get('type') ?? '';

  const filters = {
    status: status || undefined,
    priority: priority || undefined,
    type: type || undefined,
  };
  const { data, isLoading } = useQuery({
    queryKey: ['tickets', filters, view === 'table' ? { page, pageSize } : 'all'],
    queryFn: () =>
      view === 'table'
        ? listTickets({ ...filters, limit: pageSize, offset: (page - 1) * pageSize })
        : listTickets(filters),
  });
  const rows = data?.items ?? [];
  const selected = rows.find((t) => t.id === selectedId) ?? null;

  // any filter change or view switch resets to page 1
  useEffect(() => {
    setPage(1);
  }, [status, priority, type, view]);

  const advance = useMutation({
    mutationFn: ({ id, st }: { id: string; st: TicketStatus }) => patchTicketStatus(id, st),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['metrics'] });
      setSelectedId(t.id);
    },
  });

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setParams(next, { replace: true });
  };

  const columns: Column<Ticket>[] = [
    {
      key: 'ticket_number',
      header: 'Ticket',
      render: (t) => (
        <div>
          <span className="font-mono text-xs text-indigo-400">{t.ticket_number}</span>
          <p className="max-w-[220px] truncate font-medium text-slate-200">{t.title}</p>
        </div>
      ),
    },
    { key: 'priority', header: 'Priority', render: (t) => <PriorityBadge priority={t.priority} /> },
    { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
    {
      key: 'ticket_type',
      header: 'Type',
      render: (t) => <span className="text-xs text-slate-400">{t.ticket_type.replace('_', ' ')}</span>,
    },
    {
      key: 'requester_name',
      header: 'Requester',
      render: (t) => <span className="text-slate-300">{t.requester_name}</span>,
    },
    {
      key: 'assignee_name',
      header: 'Assignee',
      render: (t) => <span className="text-slate-300">{t.assignee_name ?? '—'}</span>,
    },
    {
      key: 'asset_tag',
      header: 'Asset',
      render: (t) => (
        <span className="font-mono text-xs text-slate-400">{t.asset_tag ?? '—'}</span>
      ),
    },
  ];

  const next = selected ? NEXT_STATUS[selected.status] : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Tickets</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            {view === 'table' ? data?.total ?? rows.length : rows.length} ticket
            {view === 'table' ? (data?.total ?? rows.length) === 1 ? '' : 's' : rows.length === 1 ? '' : 's'} matching filters
          </p>
        </div>
        <div className="w-full min-w-0 sm:w-auto">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
            <div className="col-span-2 flex overflow-hidden rounded-lg border border-slate-700 sm:col-auto">
              <button
                type="button"
                onClick={() => setView('table')}
                className={cn(
                  'inline-flex h-10 flex-1 items-center justify-center gap-1.5 px-3 text-sm transition-colors sm:flex-none',
                  view === 'table' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200',
                )}
              >
                <Table className="h-4 w-4" /> Table
              </button>
              <button
                type="button"
                onClick={() => setView('kanban')}
                className={cn(
                  'inline-flex h-10 flex-1 items-center justify-center gap-1.5 px-3 text-sm transition-colors sm:flex-none',
                  view === 'kanban' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200',
                )}
              >
                <Columns3 className="h-4 w-4" /> Kanban
              </button>
            </div>
            <Select
              className="w-full sm:w-auto sm:min-w-[130px]"
              value={status}
              onChange={(v) => update('status', v)}
              options={[
                { value: '', label: 'All Statuses' },
                ...TICKET_STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') })),
              ]}
          />
          <Select
            className="w-full sm:w-auto sm:min-w-[130px]"
            value={priority}
            onChange={(v) => update('priority', v)}
            options={[{ value: '', label: 'All Priorities' }, ...PRIORITIES.map((p) => ({ value: p, label: p }))]}
          />
          <Select
            className="w-full sm:w-auto sm:min-w-[130px]"
            value={type}
            onChange={(v) => update('type', v)}
            options={[
              { value: '', label: 'All Types' },
              ...TICKET_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ') })),
            ]}
          />
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="col-span-2 inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 sm:col-auto sm:inline-flex"
          >
            <Plus className="h-4 w-4" /> New Ticket
          </button>
          </div>
        </div>
      </div>

      <div className={cn('grid gap-4', selected && 'lg:grid-cols-[1fr_360px]')}>
        <div>
          {view === 'table' ? (
            <DataTable
              columns={columns}
              rows={rows}
              total={data?.total}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
              loading={isLoading}
              emptyMessage="No tickets match the current filters."
              minWidth="min-w-[760px]"
              onRowClick={(t) => setSelectedId(t.id)}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {TICKET_STATUSES.map((st) => {
                const items = rows.filter((t) => t.status === st);
                return (
                  <div key={st} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                    <div className="mb-3 flex items-center justify-between px-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {st.replace('_', ' ')}
                      </span>
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                        {items.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {items.map((t, i) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setSelectedId(t.id)}
                          className={cn(
                            'animate-list-in w-full rounded-lg border border-slate-800 bg-slate-950 p-3 text-left transition-colors hover:border-slate-700',
                            selectedId === t.id && 'border-indigo-500/60',
                          )}
                          style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] text-slate-500">
                              {t.ticket_number}
                            </span>
                            <PriorityBadge priority={t.priority} />
                          </div>
                          <p className="mt-1 text-sm font-medium text-slate-200">{t.title}</p>
                          <p className="mt-1 truncate text-xs text-slate-500">
                            {t.assignee_name ?? 'Unassigned'}
                          </p>
                        </button>
                      ))}
                      {items.length === 0 && (
                        <p className="rounded-lg border border-dashed border-slate-800 p-3 text-center text-xs text-slate-600">
                          Empty
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {selected && (
          <aside className="h-fit rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-indigo-400">{selected.ticket_number}</span>
              <PriorityBadge priority={selected.priority} />
              <StatusBadge status={selected.status} />
            </div>
            <h2 className="mt-2 text-lg font-semibold text-slate-100">{selected.title}</h2>
            <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
              {selected.ticket_type.replace('_', ' ')}
            </p>

            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
              {selected.description || 'No description provided.'}
            </p>

            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center gap-2 text-slate-300">
                <User className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="truncate">
                  {selected.requester_name}
                  <span className="ml-1 font-mono text-[10px] text-slate-500">
                    ({selected.requester_id})
                  </span>
                </span>
              </div>
              {selected.asset_id && (
                <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
                  <Link2 className="h-4 w-4 shrink-0 text-indigo-400" />
                  <div className="min-w-0">
                    <p className="truncate text-xs text-slate-200">
                      <span className="font-mono text-indigo-400">{selected.asset_tag}</span>
                      {' · '}
                      {selected.asset_name}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">
                      linked asset
                    </p>
                  </div>
                </div>
              )}
              <p className="text-xs text-slate-500">
                Created {formatDate(selected.created_at)} · Updated {formatDate(selected.updated_at)}
              </p>
            </div>

            <div className="mt-5 border-t border-slate-800 pt-4">
              {next ? (
                <button
                  type="button"
                  onClick={() => advance.mutate({ id: selected.id, st: next })}
                  disabled={advance.isPending}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
                >
                  {advance.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
                  Advance to {next.replace('_', ' ')}
                  {!advance.isPending && <ArrowRight className="h-4 w-4" />}
                </button>
              ) : (
                <p className="text-center text-xs text-slate-500">
                  No further status transition.
                </p>
              )}
              {advance.isError && (
                <p className="mt-2 text-xs text-red-400">
                  {advance.error instanceof Error ? advance.error.message : 'Status update failed.'}
                </p>
              )}
            </div>
          </aside>
        )}
      </div>

      {newOpen && (
        <Modal title="New Ticket" onClose={() => setNewOpen(false)}>
          <NewTicketForm onDone={() => setNewOpen(false)} />
        </Modal>
      )}
    </div>
  );
}
