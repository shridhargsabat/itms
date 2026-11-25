import { useEffect, useRef, useState } from 'react';
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
  getSlaPolicy,
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
import { FieldError } from '@/components/FieldError';
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

// Fallback when GET /sla/policy is unreachable (TFE-28) — mirrors the server policy today.
const SLA_HOURS: Record<string, number> = { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 };

const KANBAN_LIMIT = 200;

// Mirrors backend MAX_ATTACHMENT_BYTES (10 MB) and ALLOWED_CONTENT_TYPES
// (comments.rs) as picker extensions (TFE-25).
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_ACCEPT = '.pdf,.json,.zip,.doc,.docx,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.md';

export default function Tickets() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const openParam = params.get('open');
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get('open'));
  const [newOpen, setNewOpen] = useState(false);
  const { page, pageSize, setPage, setPageSize, reset, offset } = useServerPagination(20);

  // TFE-03: EMPLOYEE is read-only — staff-only editing UI is gated on this.
  const user = getCachedUser();
  const isStaff = user?.role !== 'EMPLOYEE';

  const status = params.get('status') ?? '';
  const priority = params.get('priority') ?? '';
  const type = params.get('type') ?? '';
  const search = params.get('search') ?? '';
  const sort = params.get('sort') ?? null;
  const order = (params.get('order') as 'asc' | 'desc' | null) ?? null;
  const overdueOnly = params.get('overdue') === 'true';

  // TFE-05: debounced search — the box is local state; the param (and the API
  // call) follows ~300ms after the user stops typing.
  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => {
    setSearchInput(search);
  }, [search]);
  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (searchInput) {
        next.set('search', searchInput);
      } else {
        next.delete('search');
      }
      setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, search, params, setParams]);

  // TFE-09: two-way ?open= sync — opening writes the param (reload-safe,
  // Back-closes-the-drawer), closing clears it.
  const selectTicket = (id: string | null) => {
    setSelectedId(id);
    const next = new URLSearchParams(params);
    if (id) {
      next.set('open', id);
    } else {
      next.delete('open');
    }
    setParams(next, { replace: true });
  };

  useEffect(() => {
    setSelectedId(openParam);
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
  // TFE-01: capture the list error — a failed fetch must not render as "No tickets found".
  const { data, isLoading, isError, error, refetch } = useQuery({
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
  // TFE-08: deep link to a missing/inaccessible ticket — surfaced as a notice, not a silent no-op.
  const badOpen = Boolean(selectedId && !rowMatch && singleTicket.isError);
  const users = useQuery({ queryKey: ['users', 'picker'], queryFn: () => listUsers({ limit: 200 }) });
  // TFE-28: live SLA policy with the const as fallback (values match the server today).
  const slaPolicy = useQuery({ queryKey: ['sla-policy'], queryFn: getSlaPolicy, staleTime: Infinity, retry: false });
  const slaHours = (p: string) => slaPolicy.data?.[p]?.hours ?? SLA_HOURS[p] ?? 24;

  // TFE-29: staff can fix title/description/type (C1 — PATCH accepts them).
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState({ title: '', description: '', ticket_type: '' });
  useEffect(() => {
    setEditingDetails(false);
  }, [selectedId]);
  const openDetailsEditor = () => {
    if (!selected) return;
    setDetailsDraft({
      title: selected.title,
      description: selected.description ?? '',
      ticket_type: selected.ticket_type,
    });
    setEditingDetails(true);
  };

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
      selectTicket(t.id);
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

  const saveDetails = useMutation({
    mutationFn: (input: { title: string; description: string; ticket_type: string }) =>
      updateTicket(selected!.id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      if (selected) {
        qc.invalidateQueries({ queryKey: ['ticket', selected.id] });
        qc.invalidateQueries({ queryKey: ['ticket-timeline', selected.id] });
      }
      qc.invalidateQueries({ queryKey: ['metrics'] });
      qc.invalidateQueries({ queryKey: ['service-queue'] });
      setEditingDetails(false);
    },
  });

  // TFE-13: export with pending state and a caught error (no unhandled rejection offline).
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await exportTicketsCsv({
        status: status || undefined,
        priority: priority || undefined,
        type: type || undefined,
        overdue: filters.overdue,
        search: filters.search,
        sort: sort ?? undefined,
        order: order ?? undefined,
      });
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  // C4: NewTicketForm calls this via onNewTicket(id) — reset to a clean
  // list and open the new ticket.
  const handleNewTicket = (id: string) => {
    reset();
    setNewOpen(false);
    setSelectedId(id);
    const next = new URLSearchParams();
    next.set('open', id);
    setParams(next, { replace: true });
  };

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
          <span className="whitespace-nowrap font-mono text-xs text-accent">{t.ticket_number}</span>
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
    { key: 'sla', header: 'SLA', sortable: false, render: (t) => <span className="whitespace-nowrap"><SlaChip dueAt={t.sla_due_at} policyHours={slaHours(t.priority)} /></span> },
    {
      key: 'ticket_type',
      header: 'Type',
      sortable: true,
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
        <span className="whitespace-nowrap font-mono text-xs text-secondary">{t.asset_tag ?? '—'}</span>
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
          isLoading
            ? 'Loading tickets…'
            : kanbanTruncated
              ? sort
                ? `Showing ${rows.length} of ${data?.total} tickets`
                : `Showing newest ${rows.length} of ${data?.total} tickets`
              : `${matchCount} ticket${matchCount === 1 ? '' : 's'} matching filters`
        }
        actions={
          <>
            <Button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              loading={exporting}
              variant="secondary"
              size="lg"
              leftIcon={!exporting ? <Download className="h-4 w-4" /> : undefined}
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
        <div className="relative min-w-0 flex-1 basis-full sm:basis-56"><Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" /><input value={searchInput} type="search" inputMode="search" onChange={(e) => setSearchInput(e.target.value)} placeholder="Search tickets..." aria-label="Search tickets" className={cn(inputCls, 'pl-9')} /></div>
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
          ariaLabel="Filter tickets by status"
          className="w-full sm:w-auto sm:min-w-[130px]"
          value={status}
          onChange={(v) => update('status', v)}
          options={[
            { value: '', label: 'All Statuses' },
            ...TICKET_STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') })),
          ]}
        />
        <Select
          ariaLabel="Filter tickets by priority"
          className="w-full sm:w-auto sm:min-w-[130px]"
          value={priority}
          onChange={(v) => update('priority', v)}
          options={[{ value: '', label: 'All Priorities' }, ...PRIORITIES.map((p) => ({ value: p, label: p }))]}
        />
        <Select
          ariaLabel="Filter tickets by type"
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

      {(overdueOnly || exportError) && (
        <div className="flex flex-wrap items-center gap-2">
          {overdueOnly && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 py-1 pl-3 pr-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              Overdue only
              <button
                type="button"
                onClick={() => update('overdue', '')}
                aria-label="Clear overdue filter"
                className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-amber-500/25"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          {exportError && <FieldError id="tickets-export-error" error={`Export failed: ${exportError}`} />}
        </div>
      )}

      {badOpen && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl glass-card liquid-glass-subcard px-4 py-3">
          <p className="text-sm text-secondary">
            <span className="font-medium text-primary">Ticket not found.</span>{' '}
            It may have been deleted, or the link is wrong.
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={() => selectTicket(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="min-w-0">
        {isError ? (
          <div role="alert" className="rounded-xl glass-card liquid-glass-subcard px-6 py-10 text-center">
            <p className="text-sm font-semibold text-primary">Couldn&apos;t load tickets</p>
            <p className="mt-1 text-xs text-muted">
              {error instanceof Error ? error.message : 'Something went wrong while fetching the ticket list.'}
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={() => refetch()} className="mt-4">
              Retry
            </Button>
          </div>
        ) : !isLoading && rows.length === 0 ? (
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
              caption="Tickets"
              highlightId={selectedId ?? undefined}
              onRowClick={(t) => selectTicket(t.id)}
            />
          ) : isLoading ? (
            <ScrollX innerClassName="pb-2">
              <div className="flex snap-x gap-4 md:grid md:grid-cols-2 md:overflow-visible md:pb-0 xl:grid-cols-4" aria-busy="true" aria-label="Loading tickets">
                {TICKET_STATUSES.map((st) => (
                  <div key={st} data-testid="kanban-skeleton" className="min-w-[240px] snap-start rounded-xl glass-dense liquid-glass-panel p-3 md:min-w-0">
                    <div className="mb-3 flex items-center justify-between px-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-secondary">
                        {st.replace('_', ' ')}
                      </span>
                      <span className="h-5 w-8 animate-pulse rounded-full bg-elevated" />
                    </div>
                    <div className="space-y-2">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="animate-pulse rounded-lg glass-card liquid-glass-subcard p-3">
                          <div className="h-3 w-2/3 rounded bg-elevated" />
                          <div className="mt-2 h-3 w-1/2 rounded bg-elevated" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollX>
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
                        <span
                          className="rounded-full bg-elevated px-2 py-0.5 text-xs text-secondary"
                          title={kanbanTruncated ? `First ${rows.length} of ${data?.total} tickets loaded` : undefined}
                        >
                          {items.length}
                        </span>
                      </div>
                      <div className="max-h-[calc(100dvh-19rem)] space-y-2 overflow-y-auto pr-1">
                        {items.map((t, i) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => selectTicket(t.id)}
                            className={cn(
                              'animate-list-in w-full rounded-lg glass-card liquid-glass-subcard p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
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
            <div className="fixed inset-0 z-[70]">
            <div
              aria-hidden="true"
              className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => selectTicket(null)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Ticket ${selected.ticket_number}`}
              className="animate-slide-in-right absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-edge bg-surface shadow-2xl"
            >
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
                  onClick={(e) => { e.stopPropagation(); selectTicket(null); }}
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
                  SLA · {slaHours(selected.priority)}h policy
                </span>
                <SlaChip dueAt={selected.sla_due_at} policyHours={slaHours(selected.priority)} />
              </div>
              <div className="mt-2">
                <SlaBar dueAt={selected.sla_due_at} policyHours={slaHours(selected.priority)} />
              </div>
              <p className="mt-1.5 text-[10px] text-muted">
                {selected.sla_due_at
                  ? `Due ${new Date(selected.sla_due_at).toLocaleString()}${selected.sla_escalated_at ? ' · escalated' : ''}`
                  : 'No active SLA'}
              </p>
            </div>

            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-secondary">
              {selected.description || 'No description provided.'}
            </p>

            {isStaff && !editingDetails && (
              <div className="mt-2">
                <Button type="button" variant="ghost" size="sm" onClick={openDetailsEditor} className="px-2 text-xs">
                  Edit title, type & description
                </Button>
              </div>
            )}
            {isStaff && editingDetails && (
              <div className="mt-3 space-y-3 rounded-lg glass-card liquid-glass-subcard p-3">
                <div>
                  <label className={labelCls} htmlFor="ticket-edit-title">Title</label>
                  <input
                    id="ticket-edit-title"
                    className={inputCls}
                    value={detailsDraft.title}
                    maxLength={200}
                    onChange={(e) => setDetailsDraft((d) => ({ ...d, title: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>Type</label>
                  <Select
                    ariaLabel="Ticket type"
                    className="w-full"
                    value={detailsDraft.ticket_type}
                    onChange={(v) => setDetailsDraft((d) => ({ ...d, ticket_type: v }))}
                    options={TICKET_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ') }))}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="ticket-edit-description">Description</label>
                  <textarea
                    id="ticket-edit-description"
                    className={cn(inputCls, 'min-h-[80px] resize-y')}
                    rows={3}
                    maxLength={4000}
                    value={detailsDraft.description}
                    onChange={(e) => setDetailsDraft((d) => ({ ...d, description: e.target.value }))}
                  />
                </div>
                {saveDetails.isError && (
                  <FieldError
                    id="ticket-details-error"
                    error={saveDetails.error instanceof Error ? saveDetails.error.message : 'Failed to save changes.'}
                  />
                )}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setEditingDetails(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={!detailsDraft.title.trim() || saveDetails.isPending}
                    loading={saveDetails.isPending}
                    onClick={() =>
                      saveDetails.mutate({
                        title: detailsDraft.title.trim(),
                        description: detailsDraft.description,
                        ticket_type: detailsDraft.ticket_type,
                      })
                    }
                  >
                    Save changes
                  </Button>
                </div>
              </div>
            )}

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

            {isStaff ? (
              <>
                <div className="mt-5 grid grid-cols-1 gap-3 border-t border-edge pt-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Priority</label>
                    <div className={cn(editTicket.isPending && 'pointer-events-none opacity-60')} aria-disabled={editTicket.isPending}>
                      <Select
                        ariaLabel="Ticket priority"
                        className="w-full"
                        value={selected.priority}
                        onChange={(v) => editTicket.mutate({ priority: v as Priority })}
                        options={PRIORITIES.map((p) => ({ value: p, label: p }))}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Assignee</label>
                    <div className={cn(editTicket.isPending && 'pointer-events-none opacity-60')} aria-disabled={editTicket.isPending}>
                      <Select
                        ariaLabel="Ticket assignee"
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
                    {users.data && users.data.total > users.data.items.length && (
                      <p className="mt-1 text-[10px] text-muted">
                        Showing first 200 of {users.data.total} users
                      </p>
                    )}
                  </div>
                </div>
                {editTicket.isError && (
                  <FieldError
                    id="ticket-edit-error"
                    error={editTicket.error instanceof Error ? editTicket.error.message : 'Ticket update failed.'}
                  />
                )}
              </>
            ) : (
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-edge pt-4">
                <div>
                  <p className={labelCls}>Priority</p>
                  <PriorityBadge priority={selected.priority} />
                </div>
                <div>
                  <p className={labelCls}>Assignee</p>
                  <p className="text-sm text-secondary">{selected.assignee_name ?? 'Unassigned'}</p>
                </div>
              </div>
            )}

            {isStaff && (
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
            )}

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
          <NewTicketForm
            onDone={() => setNewOpen(false)}
            onNewTicket={handleNewTicket}
          />
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
  const me = getCachedUser();
  const [draft, setDraft] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [confirmAttDel, setConfirmAttDel] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
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
      setDeleteErr(null);
      qc.invalidateQueries({ queryKey: ['ticket-timeline', ticketId] });
    },
    onError: (e) => {
      setConfirmDel(null);
      setDeleteErr((e as Error).message || 'Failed to delete comment.');
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
      setDeleteErr(null);
      qc.invalidateQueries({ queryKey: ['ticket-timeline', ticketId] });
    },
    onError: (e) => {
      setConfirmAttDel(null);
      setDeleteErr((e as Error).message || 'Failed to delete attachment.');
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

      {deleteErr && <FieldError id="ticket-delete-error" error={deleteErr} />}

      {/* attachments */}
      {attachments.length > 0 && (
        <div className="mb-3 flex flex-col gap-1.5">
          {attachments.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg glass-dense px-2.5 py-1.5">
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-accent" />
              <Button
                type="button"
                onClick={() => downloadTicketAttachment(a.id).then((blob) => {
                  // TFE-24: downloadBlob pattern (client.ts) — the anchor must be
                  // attached to the DOM before click() or the download can abort
                  // in Safari/Firefox.
                  const url = URL.createObjectURL(blob);
                  const el = document.createElement('a');
                  el.href = url;
                  el.download = a.file_name;
                  document.body.appendChild(el);
                  el.click();
                  el.remove();
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
                    <button type="button" onClick={() => delAtt.mutate(a.id)} className="inline-flex min-h-6 items-center rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">Confirm</button>
                    <button type="button" onClick={() => setConfirmAttDel(null)} className="inline-flex min-h-6 items-center rounded border border-edge px-1.5 py-0.5 text-[10px] text-secondary">No</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmAttDel(a.id)} aria-label="Delete attachment" className="inline-flex h-6 w-6 items-center justify-center text-red-400 hover:opacity-80" title="Delete attachment">
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
                        <button type="button" onClick={() => delComment.mutate(c.id)} className="inline-flex min-h-6 items-center rounded bg-red-500 px-1.5 py-0.5 font-semibold text-white">Confirm</button>
                        <button type="button" onClick={() => setConfirmDel(null)} className="inline-flex min-h-6 items-center rounded border border-edge px-1.5 py-0.5">No</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmDel(c.id)} aria-label="Delete comment" className="ml-auto inline-flex h-6 w-6 items-center justify-center text-red-400 hover:opacity-80" title="Delete comment">
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
      <div className="flex min-w-0 flex-col gap-2">
        <CannedPicker onPick={(t) => setDraft((d) => (d ? d + '\n\n' + t : t))} />
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment…"
          aria-label="Add a comment"
          rows={2}
          maxLength={4000}
          className={cn(inputCls, 'min-h-[60px] resize-y text-xs')}
        />
        {post.isError && (
          <FieldError
            id="ticket-comment-error"
            error={post.error instanceof Error ? post.error.message : 'Failed to post comment.'}
          />
        )}
        {uploadErr && <p className="text-[10px] text-red-400">{uploadErr}</p>}
        <div className="flex flex-wrap items-center gap-2">
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
            accept={ATTACHMENT_ACCEPT}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                if (f.size > MAX_ATTACHMENT_BYTES) {
                  setUploadErr('File exceeds the 10 MB limit.');
                } else {
                  setUploadErr('');
                  upload.mutate(f);
                }
              }
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
            className="ml-auto shrink-0 px-3 py-1.5 text-[11px]"
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
  const [confirming, setConfirming] = useState(false);
  const convert = useMutation({
    mutationFn: () => convertTicketToArticle(ticket.id, {}),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['kb-articles'] });
      setConfirming(false);
      navigate(`/kb?open=${a.id}`);
    },
  });
  if (user?.role === 'EMPLOYEE') return null;
  if (ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED') return null;
  return (
    <>
      <Button
        type="button"
        disabled={convert.isPending}
        fullWidth
        variant="secondary"
        onClick={() => setConfirming(true)}
        leftIcon={<BookOpen className="h-4 w-4" />}
        title="Capture this resolution as a knowledge-base article"
      >
        Convert to KB article
      </Button>
      {convert.isError && (
        <FieldError
          id="ticket-convert-error"
          error={convert.error instanceof Error ? convert.error.message : 'Conversion failed.'}
        />
      )}
      {confirming && (
        <Modal title="Convert to KB article" onClose={() => setConfirming(false)}>
          <p className="text-sm text-secondary">
            Capture <span className="font-mono text-accent">{ticket.ticket_number}</span> as a
            knowledge-base article? You&apos;ll be taken to the new article.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={convert.isPending}
              loading={convert.isPending}
              onClick={() => convert.mutate()}
            >
              Convert
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function CannedPicker({ onPick }: { onPick: (text: string) => void }) {
  const user = getCachedUser();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canned = useQuery({ queryKey: ['kb-canned'], queryFn: () => listCanned(), enabled: user?.role !== 'EMPLOYEE' });
  // TFE-21: dismiss on outside-click / Escape. Capture-phase + preventDefault so
  // the drawer's own Escape handler (which yields on defaultPrevented) stays shut.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open ]);
  if (user?.role === 'EMPLOYEE') return null;
  if (!canned.data?.length) return null;
  return (
    <div className="relative" ref={wrapRef}>
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
