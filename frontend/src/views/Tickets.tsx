import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Columns3,
  Download,
  Link2,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Table,
  Ticket as TicketIcon,
  Trash2,
  User,
  X,
  Zap,
} from 'lucide-react';
import {
  convertTicketToArticle,
  createTicketComment,
  getCachedUser,
  getTicket,
  deleteTicketAttachment,
  deleteTicketComment,
  downloadTicketAttachment,
  exportTicketsCsv,
  getTicketTimeline,
  listCanned,
  listTickets,
  listUsers,
  patchTicketStatus,
  updateTicket,
  uploadTicketAttachment,
} from '@/api/client';
import { ALLOWED_TICKET_TRANSITIONS, PRIORITIES, TICKET_STATUSES, TICKET_TYPES } from '@/api/types';
import type { Priority, Ticket, TicketStatus, UpdateTicketInput } from '@/api/types';
import DataTable, { type Column } from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import FilterBar from '@/components/FilterBar';
import Modal from '@/components/Modal';
import NewTicketForm from '@/components/NewTicketForm';
import PageHeader from '@/components/PageHeader';
import ScrollX from '@/components/ScrollX';
import Select from '@/components/Select';
import { PriorityBadge, StatusBadge } from '@/components/TicketBadge';
import SlaChip, { SlaBar } from '@/components/SlaChip';
import { Button } from '@/components/Button';
import { cn, formatDate, inputCls, labelCls } from '@/lib/utils';
import { useServerPagination } from '@/lib/usePagination';

const SLA_HOURS: Record<string, number> = { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 };

const KANBAN_LIMIT = 200;

export default function Tickets() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const openParam = params.get('open');
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get('open'));
  const [newOpen, setNewOpen] = useState(false);
  const { page, pageSize, setPage, setPageSize, reset, offset } = useServerPagination(20);

  const status = params.get('status') ?? '';
  const priority = params.get('priority') ?? '';
  const type = params.get('type') ?? '';
  const search = params.get('search') ?? '';
  const sort = params.get('sort') ?? null;
  const order = (params.get('order') as 'asc' | 'desc' | null) ?? null;

  const selectTicket = (id: string | null) => {
    setSelectedId(id);
    if (!id && params.has('open')) {
      const next = new URLSearchParams(params);
      next.delete('open');
      setParams(next, { replace: true });
    }
  };

  useEffect(() => {
    if (openParam) setSelectedId(openParam);
  }, [openParam]);

  const filters = {
    status: status || undefined,
    priority: priority || undefined,
    type: type || undefined,
    search: search || undefined,
    overdue: params.get('overdue') === 'true' ? true : undefined,
    sort: sort ?? undefined,
    order: order ?? undefined,
  };
  const { data, isLoading } = useQuery({
    queryKey: ['tickets', filters, view === 'table' ? { page, pageSize } : 'all'],
    queryFn: () =>
      view === 'table'
        ? listTickets({ ...filters, limit: pageSize, offset })
        : listTickets({ ...filters, limit: KANBAN_LIMIT }),
  });
  const rows = data?.items ?? [];
  const rowMatch = rows.find((t) => t.id === selectedId) ?? null;
  const singleTicket = useQuery({
    queryKey: ['ticket', selectedId],
    queryFn: () => getTicket(selectedId!),
    enabled: Boolean(selectedId && !rowMatch),
  });
  const selected = rowMatch ?? singleTicket.data ?? null;
  const users = useQuery({ queryKey: ['users', 'picker'], queryFn: () => listUsers({ limit: 200 }) });

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="listbox"]')) selectTicket(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  // any filter change or view switch resets to page 1
  useEffect(() => {
    reset();
  }, [status, priority, type, search, view, sort, order]);

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
      qc.invalidateQueries({ queryKey: ['ticket', t.id] });
      qc.invalidateQueries({ queryKey: ['ticket-timeline', t.id] });
      qc.invalidateQueries({ queryKey: ['metrics'] });
      qc.invalidateQueries({ queryKey: ['service-queue'] });
      setSelectedId(t.id);
    },
  });

  const editTicket = useMutation({
    mutationFn: (input: UpdateTicketInput) => updateTicket(selected!.id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      if (selected) {
        qc.invalidateQueries({ queryKey: ['ticket', selected.id] });
        qc.invalidateQueries({ queryKey: ['ticket-timeline', selected.id] });
      }
      qc.invalidateQueries({ queryKey: ['metrics'] });
      qc.invalidateQueries({ queryKey: ['service-queue'] });
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

  const nextStatuses = selected ? (ALLOWED_TICKET_TRANSITIONS[selected.status] ?? []) : [];

  const matchCount = data?.total ?? rows.length;
  const kanbanTruncated = view === 'kanban' && (data?.total ?? 0) > rows.length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tickets"
        description={
          kanbanTruncated
            ? `Showing newest ${rows.length} of ${data?.total} tickets`
            : `${matchCount} ticket${matchCount === 1 ? '' : 's'} matching filters`
        }
        actions={
          <>
            <Button
              type="button"
              onClick={() =>
                exportTicketsCsv({
                  status: status || undefined,
                  priority: priority || undefined,
                  type: type || undefined,
                  overdue: filters.overdue,
                  search: filters.search,
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
        <div className="relative min-w-0 flex-1 basis-full sm:basis-56"><Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" /><input value={search} type="search" inputMode="search" onChange={(e) => update('search', e.target.value)} placeholder="Search tickets..." aria-label="Search tickets" className={cn(inputCls, 'pl-9')} /></div>
        <div className="grid w-full grid-cols-2 gap-2 sm:contents">
        <div className="flex w-full justify-center overflow-hidden rounded-lg glass-dense sm:w-auto">
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
        </div>
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
                      <div className="max-h-[calc(100dvh-19rem)] space-y-2 overflow-y-auto pr-1">
                        {items.map((t, i) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setSelectedId(t.id)}
                            className={cn(
                              'animate-list-in w-full rounded-lg glass-card liquid-glass-subcard p-3 text-left transition-colors',
                              selectedId === t.id && 'border-accent/60',
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

        {selected &&
          createPortal(
            <div className="fixed inset-0 z-[60]">
            <div
              className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => selectTicket(null)}
            />
            <div className="animate-slide-in-right absolute inset-y-0 right-0 flex w-full max-w-md flex-col glass-chrome">
              <div className="flex items-start justify-between border-b border-edge px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top))]">
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
                  onClick={() => selectTicket(null)}
                  aria-label="Close"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg p-2 text-secondary transition-colors hover:bg-elevated hover:text-primary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto px-5 pt-5 pb-[calc(2rem+env(safe-area-inset-bottom))]">
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
                <span className="truncate">{selected.requester_name}</span>
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

            <div className="mt-5 grid grid-cols-1 gap-3 border-t border-edge pt-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Priority</label>
                <Select
                  className="w-full"
                  value={selected.priority}
                  onChange={(v) => editTicket.mutate({ priority: v as Priority })}
                  options={PRIORITIES.map((p) => ({ value: p, label: p }))}
                />
              </div>
              <div>
                <label className={labelCls}>Assignee</label>
                <Select
                  className="w-full"
                  value={selected.assignee_id ?? ''}
                  onChange={(v) => editTicket.mutate({ assignee_id: v || null })}
                  options={[
                    { value: '', label: 'Unassigned' },
                    ...(users.data?.items ?? []).map((u) => ({
                      value: u.id,
                      label: `${u.name} (${u.department})`,
                    })),
                  ]}
                />
              </div>
            </div>
            {editTicket.isError && (
              <p className="mt-2 text-xs text-red-400">
                {editTicket.error instanceof Error ? editTicket.error.message : 'Ticket update failed.'}
              </p>
            )}

            <div className="mt-5 border-t border-edge pt-4">
              {nextStatuses.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    onClick={() => advance.mutate({ id: selected.id, st: nextStatuses[0] })}
                    disabled={advance.isPending}
                    loading={advance.isPending}
                    fullWidth
                    variant="primary"
                    rightIcon={!advance.isPending ? <ArrowRight className="h-4 w-4" /> : undefined}
                  >
                    Advance to {nextStatuses[0].replace('_', ' ')}
                  </Button>
                  {nextStatuses.slice(1).map((st) => (
                    <Button
                      key={st}
                      type="button"
                      onClick={() => advance.mutate({ id: selected.id, st })}
                      disabled={advance.isPending}
                      fullWidth
                      variant="secondary"
                    >
                      {st === 'OPEN' ? 'Reopen to OPEN' : st === 'CLOSED' ? 'Close' : `Move to ${st.replace('_', ' ')}`}
                    </Button>
                  ))}
                </div>
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
            </div>,
            document.body,
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
  TICKET_ASSIGN: 'updated assignee',
  TICKET_COMMENT: 'commented',
  TICKET_ATTACH: 'attached a file',
  TICKET_COMMENT_DELETE: 'deleted a comment',
  TICKET_ATTACH_DELETE: 'removed a file',
  TICKET_EMAIL_INTAKE: 'created ticket via email',
  TICKET_EMAIL_REPLY: 'replied via email',
  SLA_ESCALATE: 'escalated SLA breach',
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

  const entries = [
    ...comments.map((c) => ({ kind: 'comment' as const, at: c.created_at, key: `c-${c.id}`, comment: c })),
    ...changes.map((c, idx) => ({ kind: 'change' as const, at: c.at, key: `h-${c.id ?? idx}-${c.at}-${c.action}`, change: c })),
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
                }).catch((e: unknown) => setUploadErr((e as Error).message || 'download failed'))}
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
            const c = e.comment;
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
          const h = e.change;
          return (
            <div key={e.key} className="flex items-baseline gap-2 text-[11px] text-muted">
              <span className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full bg-accent/60" />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-secondary">{h.actor || 'System'}</span>{' '}
                {CHANGE_LABEL[h.action] ?? h.action.replace('TICKET_', '').toLowerCase()}
                {(h.action === 'TICKET_STATUS' || h.action === 'TICKET_PRIORITY') && Boolean(h.details?.from && h.details?.to) && (
                  <span> ({String(h.details.from).replace('_', ' ')} → {String(h.details.to).replace('_', ' ')})</span>
                )}
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
// P1-7 (issue #48): KB integrations — convert at close, canned responses
// in the comment composer. (Suggestions at creation live in NewTicketForm.)

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
        <div className="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-80 max-w-[calc(100dvw-2.5rem)] overflow-y-auto rounded-xl glass-chrome p-1 shadow-xl">
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

