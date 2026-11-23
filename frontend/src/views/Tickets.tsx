import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Columns3,
  Download,
  Link2,
  MessageSquare,
  Paperclip,
  Plus,
  Table,
  Ticket as TicketIcon,
  Trash2,
  User,
  X,
  Zap,
} from 'lucide-react';
import {
  convertTicketToArticle,
  createTicket,
  listTemplates,
  createTicketComment,
  getCachedUser,
  deleteTicketAttachment,
  deleteTicketComment,
  downloadTicketAttachment,
  exportTicketsCsv,
  getTicketTimeline,
  listCanned,
  listTickets,
  patchTicketStatus,
  suggestArticles,
  uploadTicketAttachment,
} from '@/api/client';
import { PRIORITIES, TICKET_STATUSES, TICKET_TYPES } from '@/api/types';
import type { CreateTicketInput, Ticket, TicketStatus, TicketTemplate } from '@/api/types';
import DataTable, { type Column } from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import FilterBar from '@/components/FilterBar';
import Modal from '@/components/Modal';
import PageHeader from '@/components/PageHeader';
import ScrollX from '@/components/ScrollX';
import Select from '@/components/Select';
import { PriorityBadge, StatusBadge } from '@/components/TicketBadge';
import SlaChip, { SlaBar } from '@/components/SlaChip';
import { Button } from '@/components/Button';
import { cn, formatDate, inputCls, labelCls } from '@/lib/utils';
import { useServerPagination } from '@/lib/usePagination';

const SLA_HOURS: Record<string, number> = { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 };

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
      <TemplatePicker
        onApply={(t) => setForm((f) => ({
          ...f,
          ticket_type: t.ticket_type as CreateTicketInput['ticket_type'],
          priority: t.priority as CreateTicketInput['priority'],
          description: t.description || f.description,
        }))}
      />
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
      <SuggestionPanel query={form.title} />
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

export default function Tickets() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const { page, pageSize, setPage, setPageSize, reset, offset } = useServerPagination(20);

  const status = params.get('status') ?? '';
  const priority = params.get('priority') ?? '';
  const type = params.get('type') ?? '';
  const sort = params.get('sort') ?? null;
  const order = (params.get('order') as 'asc' | 'desc' | null) ?? null;

  const filters = {
    status: status || undefined,
    priority: priority || undefined,
    type: type || undefined,
    overdue: params.get('overdue') === 'true' ? true : undefined,
    sort: sort ?? undefined,
    order: order ?? undefined,
  };
  const { data, isLoading } = useQuery({
    queryKey: ['tickets', filters, view === 'table' ? { page, pageSize } : 'all'],
    queryFn: () =>
      view === 'table'
        ? listTickets({ ...filters, limit: pageSize, offset })
        : listTickets(filters),
  });
  const rows = data?.items ?? [];
  const selected = rows.find((t) => t.id === selectedId) ?? null;

  // any filter change or view switch resets to page 1
  useEffect(() => {
    reset();
  }, [status, priority, type, view, sort, order]);

  const onSortChange = (s: { key: string; dir: 'asc' | 'desc' } | null) => {
    const next = new URLSearchParams(params);
    if (s) {
      next.set('sort', s.key);
      next.set('order', s.dir);
    } else {
      next.delete('sort');
      next.delete('order');
    }
    setParams(next, { replace: true });
  };

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
      sortable: true,
      render: (t) => (
        <div>
          <span className="font-mono text-xs text-accent">{t.ticket_number}</span>
          <p className="max-w-[220px] truncate font-medium text-primary">{t.title}</p>
        </div>
      ),
    },
    { key: 'priority', header: 'Priority', sortable: true, render: (t) => <PriorityBadge priority={t.priority} /> },
    { key: 'status', header: 'Status', sortable: true, render: (t) => (
      <span className="flex items-center gap-1.5">
        <StatusBadge status={t.status} />
        {t.source === 'EMAIL' && (
          <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-400">
            Email
          </span>
        )}
      </span>
    ) },
    { key: 'sla', header: 'SLA', sortable: false, render: (t) => <SlaChip dueAt={t.sla_due_at} policyHours={SLA_HOURS[t.priority]} /> },
    {
      key: 'ticket_type',
      header: 'Type',
      render: (t) => <span className="text-xs text-secondary">{t.ticket_type.replace('_', ' ')}</span>,
    },
    {
      key: 'requester_name',
      header: 'Requester',
      render: (t) => <span className="text-secondary">{t.requester_name}</span>,
    },
    {
      key: 'assignee_name',
      header: 'Assignee',
      render: (t) => <span className="text-secondary">{t.assignee_name ?? '—'}</span>,
    },
    {
      key: 'asset_tag',
      header: 'Asset',
      render: (t) => (
        <span className="font-mono text-xs text-secondary">{t.asset_tag ?? '—'}</span>
      ),
    },
  ];

  const next = selected ? NEXT_STATUS[selected.status] : undefined;

  const matchCount = view === 'table' ? (data?.total ?? rows.length) : rows.length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tickets"
        description={`${matchCount} ticket${matchCount === 1 ? '' : 's'} matching filters`}
        actions={
          <>
            <Button
              type="button"
              onClick={() =>
                exportTicketsCsv({
                  status: status || undefined,
                  priority: priority || undefined,
                  type: type || undefined,
                  sort: sort ?? undefined,
                  order: order ?? undefined,
                })
              }
              variant="secondary"
              size="lg"
              leftIcon={<Download className="h-4 w-4" />}
            >
              Export
            </Button>
            <Button
              type="button"
              onClick={() => setNewOpen(true)}
              variant="primary"
              leftIcon={<Plus className="h-4 w-4" />}
            >
              New Ticket
            </Button>
          </>
        }
      />

      <FilterBar>
        <div className="flex overflow-hidden rounded-lg glass-dense">
          <button
            type="button"
            onClick={() => setView('table')}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 px-3 text-sm transition-colors',
              view === 'table' ? 'bg-elevated text-primary' : 'text-secondary hover:text-primary',
            )}
          >
            <Table className="h-4 w-4" /> Table
          </button>
          <button
            type="button"
            onClick={() => setView('kanban')}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 px-3 text-sm transition-colors',
              view === 'kanban' ? 'bg-elevated text-primary' : 'text-secondary hover:text-primary',
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
      </FilterBar>

      <div className="min-w-0">
        {!isLoading && rows.length === 0 ? (
          <EmptyState
            icon={TicketIcon}
            title="No tickets found"
            description="No tickets match the current filters. Adjust the filters or create a new ticket."
            action={
              <Button
                type="button"
                onClick={() => setNewOpen(true)}
                variant="primary"
                leftIcon={<Plus className="h-4 w-4" />}
              >
                New Ticket
              </Button>
            }
          />
        ) : view === 'table' ? (
            <DataTable
              columns={columns}
              rows={rows}
              total={data?.total}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              sort={sort ? { key: sort, dir: order === 'desc' ? 'desc' : 'asc' } : null}
              onSortChange={onSortChange}
              loading={isLoading}
              emptyMessage="No tickets match the current filters."
              onRowClick={(t) => setSelectedId(t.id)}
            />
          ) : (
            <ScrollX innerClassName="pb-2">
              <div className="flex snap-x gap-4 md:grid md:grid-cols-2 md:overflow-visible md:pb-0 xl:grid-cols-4">
                {TICKET_STATUSES.map((st) => {
                  const items = rows.filter((t) => t.status === st);
                  return (
                    <div key={st} className="min-w-[240px] snap-start rounded-xl glass-dense liquid-glass-panel p-3 md:min-w-0">
                      <div className="mb-3 flex items-center justify-between px-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-secondary">
                          {st.replace('_', ' ')}
                        </span>
                        <span className="rounded-full bg-elevated px-2 py-0.5 text-xs text-secondary">
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
                              'animate-list-in w-full rounded-lg glass-card liquid-glass-subcard p-3 text-left transition-colors',
                              selectedId === t.id && 'border-indigo-500/60',
                            )}
                            style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-[10px] text-muted">
                                {t.ticket_number}
                              </span>
                              <PriorityBadge priority={t.priority} />
                            </div>
                            <p className="mt-1 text-sm font-medium text-primary">{t.title}</p>
                            <p className="mt-1 truncate text-xs text-muted">
                              {t.assignee_name ?? 'Unassigned'}
                            </p>
                          </button>
                        ))}
                        {items.length === 0 && (
                          <p className="rounded-lg border border-dashed border-edge p-3 text-center text-xs text-muted">
                            Empty
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollX>
          )}
        </div>

        {selected && (
          <div className="fixed inset-0 z-[60]">
            <div
              className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setSelectedId(null)}
            />
            <div className="animate-slide-in-right absolute inset-y-0 right-0 flex w-full max-w-md flex-col glass-chrome">
              <div className="flex items-start justify-between border-b border-edge px-5 py-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-accent">{selected.ticket_number}</span>
                    <PriorityBadge priority={selected.priority} />
                    <StatusBadge status={selected.status} />
                  </div>
                  <h2 className="mt-1 text-lg font-semibold text-primary">{selected.title}</h2>
                  <p className="mt-0.5 text-xs uppercase tracking-wide text-muted">
                    {selected.ticket_type.replace('_', ' ')}
                    {selected.source === 'EMAIL' && (
                      <span className="ml-1 rounded bg-violet-500/15 px-1.5 py-0.5 font-semibold text-violet-400">
                        via Email
                      </span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close"
                  className="rounded-md p-1 text-secondary transition-colors hover:bg-elevated hover:text-primary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto p-5">
            <div className="mt-3 rounded-lg glass-card liquid-glass-subcard p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  SLA · {SLA_HOURS[selected.priority] ?? 24}h policy
                </span>
                <SlaChip dueAt={selected.sla_due_at} policyHours={SLA_HOURS[selected.priority]} />
              </div>
              <div className="mt-2">
                <SlaBar dueAt={selected.sla_due_at} policyHours={SLA_HOURS[selected.priority]} />
              </div>
              <p className="mt-1.5 text-[10px] text-muted">
                {selected.sla_due_at
                  ? `Due ${new Date(selected.sla_due_at).toLocaleString()}${selected.sla_escalated_at ? ' · escalated' : ''}`
                  : 'No SLA (closed)'}
              </p>
            </div>

            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-secondary">
              {selected.description || 'No description provided.'}
            </p>

            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center gap-2 text-secondary">
                <User className="h-4 w-4 shrink-0 text-muted" />
                <span className="truncate">
                  {selected.requester_name}
                  <span className="ml-1 font-mono text-[10px] text-muted">
                    ({selected.requester_id})
                  </span>
                </span>
              </div>
              {selected.asset_id && (
                <div className="flex items-center gap-2 rounded-lg glass-card liquid-glass-subcard px-3 py-2">
                  <Link2 className="h-4 w-4 shrink-0 text-accent" />
                  <div className="min-w-0">
                    <p className="truncate text-xs text-primary">
                      <span className="font-mono text-accent">{selected.asset_tag}</span>
                      {' · '}
                      {selected.asset_name}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-muted">
                      linked asset
                    </p>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted">
                Created {formatDate(selected.created_at)} · Updated {formatDate(selected.updated_at)}
              </p>
            </div>

            <TicketThread ticketId={selected.id} isAdmin={getCachedUser()?.role === 'ADMIN'} />

            <div className="mt-5 border-t border-edge pt-4">
              {next ? (
                <Button
                  type="button"
                  onClick={() => advance.mutate({ id: selected.id, st: next })}
                  disabled={advance.isPending}
                  loading={advance.isPending}
                  fullWidth
                  variant="primary"
                  rightIcon={!advance.isPending ? <ArrowRight className="h-4 w-4" /> : undefined}
                >
                  Advance to {next.replace('_', ' ')}
                </Button>
              ) : (
                <p className="text-center text-xs text-muted">
                  No further status transition.
                </p>
              )}
              {advance.isError && (
                <p className="mt-2 text-xs text-red-400">
                  {advance.error instanceof Error ? advance.error.message : 'Status update failed.'}
                </p>
              )}
            </div>

            <div className="mt-3">
              <ConvertButton ticket={selected} />
            </div>
              </div>
            </div>
          </div>
        )}

      {newOpen && (
        <Modal title="New Ticket" onClose={() => setNewOpen(false)}>
          <NewTicketForm onDone={() => setNewOpen(false)} />
        </Modal>
      )}
    </div>
  );
}


// ── P1-1 comments + activity + attachments ──────────────────────────────────

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const CHANGE_LABEL: Record<string, string> = {
  TICKET_CREATE: 'opened the ticket',
  TICKET_STATUS: 'changed status',
  TICKET_PRIORITY: 'changed priority',
  TICKET_ASSIGN: 'assigned the ticket',
  TICKET_COMMENT: 'commented',
  TICKET_ATTACH: 'attached a file',
  TICKET_COMMENT_DELETE: 'deleted a comment',
  TICKET_ATTACH_DELETE: 'removed a file',
};

function TicketThread({ ticketId, isAdmin }: { ticketId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const me = useMemo(() => JSON.parse(localStorage.getItem('itms_user') || 'null'), []);
  const [draft, setDraft] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [confirmAttDel, setConfirmAttDel] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadErr, setUploadErr] = useState('');

  const tl = useQuery({ queryKey: ['ticket-timeline', ticketId], queryFn: () => getTicketTimeline(ticketId) });

  const post = useMutation({
    mutationFn: (body: string) => createTicketComment(ticketId, { body }),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['ticket-timeline', ticketId] });
    },
  });
  const delComment = useMutation({
    mutationFn: (id: string) => deleteTicketComment(ticketId, id),
    onSuccess: () => {
      setConfirmDel(null);
      qc.invalidateQueries({ queryKey: ['ticket-timeline', ticketId] });
    },
  });
  const upload = useMutation({
    mutationFn: (f: File) => uploadTicketAttachment(ticketId, f),
    onSuccess: () => {
      setUploadErr('');
      qc.invalidateQueries({ queryKey: ['ticket-timeline', ticketId] });
    },
    onError: (e) => setUploadErr((e as Error).message || 'upload failed'),
  });
  const delAtt = useMutation({
    mutationFn: (id: string) => deleteTicketAttachment(ticketId, id),
    onSuccess: () => {
      setConfirmAttDel(null);
      qc.invalidateQueries({ queryKey: ['ticket-timeline', ticketId] });
    },
  });

  const comments = tl.data?.comments ?? [];
  const changes = tl.data?.changes ?? [];
  const attachments = tl.data?.attachments ?? [];

  const entries: { kind: 'comment' | 'change'; at: string; key: string }[] = [
    ...comments.map((c) => ({ kind: 'comment' as const, at: c.created_at, key: `c-${c.id}` })),
    ...changes.map((c) => ({ kind: 'change' as const, at: c.at, key: `h-${c.at}-${c.action}` })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="mt-5 border-t border-edge pt-4">
      <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <MessageSquare className="h-3.5 w-3.5" /> Activity & Comments
        <span className="ml-auto font-mono text-[10px] text-muted">{comments.length}</span>
      </p>

      {/* attachments */}
      {attachments.length > 0 && (
        <div className="mb-3 flex flex-col gap-1.5">
          {attachments.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg glass-dense px-2.5 py-1.5">
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-accent" />
              <Button
                type="button"
                onClick={() => downloadTicketAttachment(a.id).then((blob) => {
                  const url = URL.createObjectURL(blob);
                  const el = document.createElement('a');
                  el.href = url;
                  el.download = a.file_name;
                  el.click();
                  URL.revokeObjectURL(url);
                })}
                variant="text"
                className="min-w-0 flex-1 truncate text-left text-xs"
                title={`Download ${a.file_name}`}
              >
                {a.file_name}
              </Button>
              <span className="text-[10px] text-muted">{fmtBytes(a.size_bytes)}</span>
              {(isAdmin || me?.id === a.uploader_id) &&
                (confirmAttDel === a.id ? (
                  <span className="flex gap-1">
                    <button type="button" onClick={() => delAtt.mutate(a.id)} className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">Confirm</button>
                    <button type="button" onClick={() => setConfirmAttDel(null)} className="rounded border border-edge px-1.5 py-0.5 text-[10px] text-secondary">No</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmAttDel(a.id)} className="text-red-400 hover:opacity-80" title="Delete attachment">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}

      {/* timeline entries */}
      <div className="mb-3 flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
        {entries.length === 0 && <p className="text-xs text-muted">No activity yet.</p>}
        {entries.map((e) => {
          if (e.kind === 'comment') {
            const c = comments.find((x) => x.id === e.key.slice(2))!;
            return (
              <div key={e.key} className="rounded-lg glass-dense p-2">
                <div className="flex items-center gap-2 text-[10px] text-muted">
                  <span className="font-medium text-secondary">{c.author_name ?? 'Unknown'}</span>
                  <span className="font-mono">{formatDate(c.created_at)}</span>
                  {(isAdmin || me?.id === c.author_id) &&
                    (confirmDel === c.id ? (
                      <span className="ml-auto flex gap-1">
                        <button type="button" onClick={() => delComment.mutate(c.id)} className="rounded bg-red-500 px-1.5 py-0.5 font-semibold text-white">Confirm</button>
                        <button type="button" onClick={() => setConfirmDel(null)} className="rounded border border-edge px-1.5 py-0.5">No</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmDel(c.id)} className="ml-auto text-red-400 hover:opacity-80" title="Delete comment">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    ))}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-secondary">{c.body}</p>
              </div>
            );
          }
          const h = changes.find((x) => x.at === e.at && e.key === `h-${x.at}-${x.action}`)!;
          return (
            <div key={e.key} className="flex items-baseline gap-2 text-[11px] text-muted">
              <span className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full bg-accent/60" />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-secondary">{h.actor || 'System'}</span>{' '}
                {CHANGE_LABEL[h.action] ?? h.action.replace('TICKET_', '').toLowerCase()}
              </span>
              <span className="shrink-0 font-mono text-[9px]">{formatDate(h.at)}</span>
            </div>
          );
        })}
      </div>

      {/* new comment */}
      <div className="flex flex-col gap-2">
        <CannedPicker onPick={(t) => setDraft((d) => (d ? d + '\n\n' + t : t))} />
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment…"
          rows={2}
          maxLength={4000}
          className={cn(inputCls, 'min-h-[60px] resize-y text-xs')}
        />
        {uploadErr && <p className="text-[10px] text-red-400">{uploadErr}</p>}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={upload.isPending}
            variant="secondary"
            size="sm"
            className="border-edge px-2.5 py-1.5 text-[11px]"
            title="Attach file (max 10 MB)"
            leftIcon={<Paperclip className="h-3.5 w-3.5" />}
          >
            {upload.isPending ? 'Uploading…' : 'Attach'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = '';
            }}
          />
          <Button
            type="button"
            onClick={() => draft.trim() && post.mutate(draft)}
            disabled={!draft.trim() || post.isPending}
            loading={post.isPending}
            variant="primary"
            size="sm"
            className="ml-auto px-3 py-1.5 text-[11px]"
          >
            Post comment
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// P1-7 (issue #48): KB integrations — suggestions at creation, convert at
// close, canned responses in the comment composer.

function SuggestionPanel({ query }: { query: string }) {
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);
  const suggestions = useQuery({
    queryKey: ['kb-suggest', debounced],
    queryFn: () => suggestArticles(debounced),
    enabled: debounced.length >= 3,
  });
  if (debounced.length < 3 || !suggestions.data?.length) return null;
  return (
    <div className="rounded-lg glass-card border-indigo-500/20 bg-indigo-500/5 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-accent">
        Maybe this already exists in the KB?
      </p>
      <div className="mt-1.5 space-y-1">
        {suggestions.data.slice(0, 3).map((a) => (
          <Link
            key={a.id}
            to={`/kb?open=${a.id}`}
            className="block truncate text-xs text-secondary hover:text-accent hover:underline"
            title={a.body}
          >
            <span className="mr-1.5 rounded bg-indigo-500/15 px-1 py-0.5 text-[9px] font-medium text-accent">
              {a.ticket_type}
            </span>
            {a.title}
          </Link>
        ))}
      </div>
    </div>
  );
}

function ConvertButton({ ticket }: { ticket: Ticket }) {
  const qc = useQueryClient();
  const user = getCachedUser();
  const navigate = useNavigate();
  const convert = useMutation({
    mutationFn: () => convertTicketToArticle(ticket.id, {}),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      navigate(`/kb?open=${a.id}`);
    },
  });
  if (user?.role === 'EMPLOYEE') return null;
  if (ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED') return null;
  return (
    <Button
      type="button"
      disabled={convert.isPending}
      loading={convert.isPending}
      fullWidth
      variant="secondary"
      onClick={() => convert.mutate()}
      leftIcon={!convert.isPending ? <BookOpen className="h-4 w-4" /> : undefined}
      title="Capture this resolution as a knowledge-base article"
    >
      Convert to KB article
    </Button>
  );
}

function CannedPicker({ onPick }: { onPick: (text: string) => void }) {
  const user = getCachedUser();
  const [open, setOpen] = useState(false);
  const canned = useQuery({ queryKey: ['kb-canned'], queryFn: () => listCanned(), enabled: user?.role !== 'EMPLOYEE' });
  if (user?.role === 'EMPLOYEE') return null;
  if (!canned.data?.length) return null;
  return (
    <div className="relative">
      <Button
        type="button"
        onClick={() => setOpen((v) => !v)}
        variant="secondary"
        size="sm"
        className="border-edge px-2 py-1 text-[11px] text-accent"
        leftIcon={<Zap className="h-3 w-3" />}
      >
        Canned response
      </Button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-80 overflow-y-auto rounded-xl glass-chrome p-1 shadow-xl">
          {canned.data.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onPick(c.body); setOpen(false); }}
              className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-elevated"
            >
              <span className="block text-xs font-semibold text-primary">{c.title}</span>
              <span className="block truncate text-[11px] text-muted">{c.body}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


function TemplatePicker({ onApply }: { onApply: (t: TicketTemplate) => void }) {
  const templates = useQuery({ queryKey: ['templates', 'active'], queryFn: () => listTemplates(true) });
  const [selected, setSelected] = useState('');
  if (!templates.data?.length) return null;
  return (
    <div>
      <label className={labelCls}>Start from a template</label>
      <Select
        className="w-full"
        value={selected}
        placeholder="Choose a template…"
        onChange={(v) => {
          const t = templates.data?.find((x) => x.id === v);
          if (t) onApply(t);
          setSelected('');
        }}
        options={templates.data.map((t) => ({ value: t.id, label: `${t.name} — ${t.ticket_type} / ${t.priority}` }))}
      />
    </div>
  );
}
