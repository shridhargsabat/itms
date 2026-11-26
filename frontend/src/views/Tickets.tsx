import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  listAssets,
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
import { FieldError, errProps } from '@/components/FieldError';
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

// TFE-32: focusable selector for the drawer trap (mirrors Modal.tsx).
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Mirrors backend MAX_ATTACHMENT_BYTES (10 MB) and ALLOWED_CONTENT_TYPES
// (comments.rs) as picker extensions (TFE-25).
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_ACCEPT = '.pdf,.json,.zip,.doc,.docx,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.md';

// UX-04 (#178): the drawer assignee picker is searchable. `searchable` lands
// on Select.tsx from the sibling — spread-typed so tsc stays green until the
// prop exists (spreads bypass excess-property checks; inert at runtime).
const ASSIGNEE_SEARCHABLE = { searchable: true } as { searchable?: boolean };

// UX-12 (#186): compact kanban sort — value encodes `sort:order` so one
// Select writes both ?sort= and ?order= (sla_due_at sorts nulls last server-side).
const KANBAN_SORT_OPTIONS = [
  { value: '', label: 'Default order' },
  { value: 'sla_due_at:asc', label: 'SLA due ↑' },
  { value: 'sla_due_at:desc', label: 'SLA due ↓' },
  { value: 'ticket_number:asc', label: 'Ticket # ↑' },
  { value: 'ticket_number:desc', label: 'Ticket # ↓' },
  { value: 'priority:asc', label: 'Priority ↑' },
  { value: 'priority:desc', label: 'Priority ↓' },
  { value: 'status:asc', label: 'Status ↑' },
  { value: 'status:desc', label: 'Status ↓' },
  { value: 'ticket_type:asc', label: 'Type ↑' },
  { value: 'ticket_type:desc', label: 'Type ↓' },
];

export default function Tickets() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const openParam = params.get('open');
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get('open'));
  const [newOpen, setNewOpen] = useState(false);
  const { page, pageSize, setPage, setPageSize, reset, offset } = useServerPagination(20);
  // UX-09 (#183): ?page= read once on mount (the sibling owns usePagination,
  // so the URL sync lives here, not in the hook).
  useEffect(() => {
    const initial = Number.parseInt(params.get('page') ?? '', 10);
    if (Number.isInteger(initial) && initial >= 1 && initial !== page) setPage(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // UX-07 (#181): filters counted across status/priority/type/search/overdue.
  const activeFilterCount =
    [status, priority, type, search].filter(Boolean).length + (overdueOnly ? 1 : 0);

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
    // FE-07: fail fast — the default 3 retries delay a bad deep link by seconds.
    retry: false,
  });
  const selected = rowMatch ?? singleTicket.data ?? null;
  // TFE-08: deep link to a missing/inaccessible ticket — surfaced as a notice, not a silent no-op.
  const badOpen = Boolean(selectedId && !rowMatch && singleTicket.isError);
  // FE-07: deep link resolving — a pending drawer skeleton (below) instead of nothing.
  const deepLinkPending = Boolean(selectedId && !rowMatch && singleTicket.isPending);
  const users = useQuery({ queryKey: ['users', 'picker'], queryFn: () => listUsers({ limit: 200 }) });
  // UX-05 (#179): drawer asset picker source (NewTicketForm pattern, limit 200).
  const assets = useQuery({ queryKey: ['assets', 'picker'], queryFn: () => listAssets({ limit: 200 }) });
  // TFE-28: live SLA policy with the const as fallback (values match the server today).
  const slaPolicy = useQuery({ queryKey: ['sla-policy'], queryFn: getSlaPolicy, staleTime: Infinity, retry: false });
  const slaHours = (p: string) => slaPolicy.data?.[p]?.hours ?? SLA_HOURS[p] ?? 24;

  // TFE-29: staff can fix title/description/type (C1 — PATCH accepts them).
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState({ title: '', description: '', ticket_type: '' });
  // UX-06 (#180): inline title error (FieldError + errProps + focus-first-invalid).
  const [titleError, setTitleError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setEditingDetails(false);
    setTitleError(null);
  }, [selectedId]);
  const openDetailsEditor = () => {
    if (!selected) return;
    setDetailsDraft({
      title: selected.title,
      description: selected.description ?? '',
      ticket_type: selected.ticket_type,
    });
    setTitleError(null);
    setEditingDetails(true);
  };

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      // FE-02: an open Modal is topmost — it owns Escape (and stopPropagates),
      // so the drawer must not close underneath it.
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="listbox"]') && !document.querySelector('[data-modal]')) selectTicket(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  // TFE-32: drawer focus trap + return focus (mirrors Modal.tsx). The listbox
  // guard lets an open Select/Canned menu own keyboard handling.
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerOpen = selected !== null;
  useEffect(() => {
    if (!drawerOpen) return;
    const container = drawerRef.current;
    if (!container) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!document.querySelector('[role="listbox"]')) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? container.querySelector<HTMLElement>('[role="dialog"]'))?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (document.querySelector('[role="listbox"]')) return;
      // FE-02: topmost-only trap — an open Modal owns Tab while it is up.
      if (document.querySelector('[data-modal]')) return;
      const scope = drawerRef.current;
      if (!scope) return;
      const items = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !scope.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !scope.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
    };
  }, [drawerOpen]);

  // any filter change or view switch resets to page 1
  // FE-11: overdue is a filter too — omitting it left page 2+ active with a
  // narrowed result set (often an empty page).
  // UX-09 (#183): the reset also drops ?page=; skipped on first render so the
  // mount-time ?page= read above survives (page already starts at 1).
  const firstFilterPass = useRef(true);
  useEffect(() => {
    if (firstFilterPass.current) {
      firstFilterPass.current = false;
      return;
    }
    reset();
    const next = new URLSearchParams(params);
    if (next.has('page')) {
      next.delete('page');
      setParams(next, { replace: true });
    }
  }, [status, priority, type, search, view, sort, order, overdueOnly]);

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
    // TFE-26: optimistic priority/assignee — apply immediately, roll back on
    // failure (the FieldError below surfaces the error).
    onMutate: async (input) => {
      if (!selected) return undefined;
      const ticketId = selected.id;
      await qc.cancelQueries({ queryKey: ['tickets'] });
      await qc.cancelQueries({ queryKey: ['ticket', ticketId] });
      const prevLists = qc.getQueriesData<{ items: Ticket[]; total: number }>({ queryKey: ['tickets'] });
      const prevSingle = qc.getQueryData<Ticket>(['ticket', ticketId]);
      const optimisticAssignee =
        input.assignee_id === undefined
          ? undefined
          : {
              assignee_id: input.assignee_id,
              assignee_name:
                input.assignee_id === null
                  ? null
                  : (users.data?.items.find((u) => u.id === input.assignee_id)?.name ?? selected.assignee_name),
            };
      // UX-05 (#179): optimistic asset link/unlink mirrors the assignee above.
      const optimisticAsset =
        input.asset_id === undefined
          ? undefined
          : {
              asset_id: input.asset_id,
              asset_tag:
                input.asset_id === null
                  ? null
                  : (assets.data?.items.find((a) => a.id === input.asset_id)?.asset_tag ?? selected.asset_tag),
              asset_name:
                input.asset_id === null
                  ? null
                  : (assets.data?.items.find((a) => a.id === input.asset_id)?.name ?? selected.asset_name),
            };
      const apply = (t: Ticket): Ticket =>
        t.id !== ticketId
          ? t
          : {
              ...t,
              ...(input.priority !== undefined ? { priority: input.priority } : {}),
              ...(optimisticAssignee ?? {}),
              ...(optimisticAsset ?? {}),
            };
      qc.setQueriesData<{ items: Ticket[]; total: number }>({ queryKey: ['tickets'] }, (old) =>
        old ? { ...old, items: old.items.map(apply) } : old,
      );
      qc.setQueryData<Ticket>(['ticket', ticketId], (old) => (old ? apply(old) : old));
      return { ticketId, prevLists, prevSingle };
    },
    onError: (_err, _input, context) => {
      context?.prevLists.forEach(([key, data]) => qc.setQueryData(key, data));
      if (context && context.prevSingle !== undefined) {
        qc.setQueryData(['ticket', context.ticketId], context.prevSingle);
      }
    },
    onSettled: () => {
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

  // UX-07 (#181) / UX-11 (#185): one-tap clear across the five list filters.
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    for (const k of ['status', 'priority', 'type', 'search', 'overdue']) next.delete(k);
    setParams(next, { replace: true });
  };

  // UX-09 (#183): page changes write ?page= back (page 1 omits it).
  const handlePageChange = (p: number) => {
    setPage(p);
    const next = new URLSearchParams(params);
    if (p <= 1) {
      next.delete('page');
    } else {
      next.set('page', String(p));
    }
    setParams(next, { replace: true });
  };
  const handlePageSizeChange = (s: number) => {
    setPageSize(s);
    const next = new URLSearchParams(params);
    next.delete('page');
    setParams(next, { replace: true });
  };

  // UX-12 (#186): kanban sort Select value ↔ ?sort=&order=.
  const kanbanSortValue = sort ? `${sort}:${order ?? 'asc'}` : '';
  const onKanbanSortChange = (v: string) => {
    if (!v) {
      onSortChange(null);
      return;
    }
    const [key, dir] = v.split(':');
    onSortChange({ key, dir: dir === 'desc' ? 'desc' : 'asc' });
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
    { key: 'sla', header: 'SLA', sortable: true, sortKey: 'sla_due_at', render: (t) => <span className="whitespace-nowrap"><SlaChip dueAt={t.sla_due_at} policyHours={slaHours(t.priority)} /></span> },
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

  // CT-03 (drawer): only active ADMIN/AGENT users are assignable — EMPLOYEE
  // and deactivated accounts are filtered out of the assignee picker.
  const staffUsers = (users.data?.items ?? []).filter(
    (u) => (u.role === 'ADMIN' || u.role === 'AGENT') && u.active,
  );

  // UX-05 (#179): NewTicketForm asset-picker pattern (`None (optional)` +
  // `TAG · name`) + FE-10-style pinning of the current asset past page 1.
  const assetPickerOptions = [
    { value: '', label: 'None (optional)' },
    ...(selected?.asset_id && !(assets.data?.items ?? []).some((a) => a.id === selected.asset_id)
      ? [{ value: selected.asset_id, label: `${selected.asset_tag} · ${selected.asset_name}` }]
      : []),
    ...(assets.data?.items ?? []).map((a) => ({
      value: a.id,
      label: `${a.asset_tag} · ${a.name}`,
    })),
  ];

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
            {/* CT-02: CSV export is staff-only — EMPLOYEE never sees the button. */}
            {isStaff && (
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
            )}
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
        {/* UX-08 (#182): overdue toggle beside the three Selects — writes
            ?overdue=true; the active-state chip below stays as-is. It sits
            outside the mobile grid (Mobile #4 pins that grid at 4 cells). */}
        <button
          type="button"
          onClick={() => update('overdue', overdueOnly ? '' : 'true')}
          aria-pressed={overdueOnly}
          aria-label="Show overdue only"
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors',
            overdueOnly
              ? 'border-amber-500/40 bg-amber-500/15 font-medium text-amber-700 dark:text-amber-400'
              : 'border-edge bg-surface text-secondary hover:text-primary',
          )}
        >
          Overdue
        </button>
        {/* UX-07 (#181): N-filters-active badge + one-tap Clear all. */}
        {activeFilterCount > 0 && (
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent">
              {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} active
            </span>
            <Button type="button" variant="secondary" size="sm" onClick={clearFilters}>
              Clear all
            </Button>
          </div>
        )}
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
            description={
              search
                ? `No tickets match "${search}". Try a different search or clear the filters below.`
                : 'No tickets match the current filters. Adjust the filters or create a new ticket.'
            }
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  onClick={() => setNewOpen(true)}
                  variant="primary"
                  leftIcon={<Plus className="h-4 w-4" />}
                >
                  New Ticket
                </Button>
                {/* UX-11 (#185): secondary clear — for query empties and
                    filter-only empties alike. */}
                {activeFilterCount > 0 && (
                  <Button type="button" onClick={clearFilters} variant="secondary">
                    Clear search & filters
                  </Button>
                )}
              </div>
            }
          />
        ) : view === 'table' ? (
            <DataTable
              columns={columns}
              rows={rows}
              total={data?.total}
              page={page}
              pageSize={pageSize}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              sort={sort ? { key: sort, dir: order === 'desc' ? 'desc' : 'asc' } : null}
              onSortChange={onSortChange}
              loading={isLoading}
              emptyMessage="No tickets match the current filters."
              caption="Tickets"
              highlightId={selectedId ?? undefined}
              onRowClick={(t) => selectTicket(t.id)}
            />
          ) : (
            /* UX-12 (#186): compact kanban sort above the board (table keeps
               its header sorting). */
            <div className="space-y-2">
              <div className="flex justify-end">
                <Select
                  ariaLabel="Sort kanban tickets"
                  className="w-full sm:w-auto sm:min-w-[180px]"
                  value={kanbanSortValue}
                  onChange={onKanbanSortChange}
                  options={KANBAN_SORT_OPTIONS}
                />
              </div>
              {isLoading ? (
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
                              {/* UX-10 (#184): SLA chip on the number row. */}
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="font-mono text-[10px] text-muted">
                                  {t.ticket_number}
                                </span>
                                <SlaChip dueAt={t.sla_due_at} policyHours={slaHours(t.priority)} />
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
          )}
        </div>

        {/* FE-07: deep-link resolving — a pending drawer skeleton so ?open=
            shows a loading state instead of nothing until the fetch lands. */}
        {deepLinkPending &&
          createPortal(
            <div className="fixed inset-0 z-[70]">
              <div aria-hidden="true" className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" />
              <div
                role="status"
                aria-label="Loading ticket"
                aria-busy="true"
                data-testid="ticket-drawer-skeleton"
                className="animate-slide-in-right absolute inset-y-0 right-0 flex w-full max-w-md flex-col liquid-glass-panel modal-panel px-5 py-6"
              >
                <div className="animate-pulse space-y-3">
                  <div className="h-4 w-24 rounded bg-elevated" />
                  <div className="h-6 w-3/4 rounded bg-elevated" />
                  <div className="h-3 w-1/3 rounded bg-elevated" />
                  <div className="mt-6 h-20 rounded-lg bg-elevated" />
                  <div className="h-10 rounded-lg bg-elevated" />
                </div>
              </div>
            </div>,
            document.body,
          )}

        {selected &&
          createPortal(
            <div ref={drawerRef} className="fixed inset-0 z-[70]">
            <div
              aria-hidden="true"
              className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => selectTicket(null)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Ticket ${selected.ticket_number}`}
              tabIndex={-1}
              className="animate-slide-in-right absolute inset-y-0 right-0 flex w-full max-w-md flex-col liquid-glass-panel modal-panel"
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
                    ref={titleRef}
                    className={inputCls}
                    value={detailsDraft.title}
                    // CT-06: backend allows 255 — the old 200 cap rejected valid titles client-side.
                    maxLength={255}
                    disabled={saveDetails.isPending}
                    onChange={(e) => {
                      setDetailsDraft((d) => ({ ...d, title: e.target.value }));
                      if (titleError) setTitleError(null);
                    }}
                    {...errProps('ticket-edit-title', titleError)}
                  />
                  {/* UX-06 (#180): inline error under the title input (not a
                      silent disabled Save) — wired via aria-describedby. */}
                  <FieldError id="ticket-edit-title-error" error={titleError} />
                </div>
                <div>
                  <label className={labelCls}>Type</label>
                  {/* FE-05: freeze the editor while the save is in flight — a
                      success closes the editor and would wipe in-flight edits. */}
                  <div className={cn(saveDetails.isPending && 'pointer-events-none opacity-60')} aria-disabled={saveDetails.isPending}>
                    <Select
                      ariaLabel="Ticket type"
                      className="w-full"
                      value={detailsDraft.ticket_type}
                      onChange={(v) => setDetailsDraft((d) => ({ ...d, ticket_type: v }))}
                      options={TICKET_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ') }))}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelCls} htmlFor="ticket-edit-description">Description</label>
                  <textarea
                    id="ticket-edit-description"
                    className={cn(inputCls, 'min-h-[80px] resize-y')}
                    rows={3}
                    maxLength={4000}
                    value={detailsDraft.description}
                    disabled={saveDetails.isPending}
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
                    disabled={saveDetails.isPending}
                    loading={saveDetails.isPending}
                    // UX-06 (#180): empty title → inline error + focus the
                    // input (focus-first-invalid), not a silent disable.
                    onClick={() => {
                      if (!detailsDraft.title.trim()) {
                        setTitleError('Title is required.');
                        titleRef.current?.focus();
                        return;
                      }
                      setTitleError(null);
                      saveDetails.mutate({
                        title: detailsDraft.title.trim(),
                        description: detailsDraft.description,
                        ticket_type: detailsDraft.ticket_type,
                      });
                    }}
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
                        // FE-12: TFE-20-style guard — re-selecting the current
                        // value is a no-op (no pointless PATCH + invalidation storm).
                        onChange={(v) => {
                          if (v === selected.priority) return;
                          editTicket.mutate({ priority: v as Priority });
                        }}
                        options={PRIORITIES.map((p) => ({ value: p, label: p }))}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Assignee</label>
                    <div className={cn(editTicket.isPending && 'pointer-events-none opacity-60')} aria-disabled={editTicket.isPending}>
                      <Select
                        {...ASSIGNEE_SEARCHABLE}
                        ariaLabel="Ticket assignee"
                        className="w-full"
                        value={selected.assignee_id ?? ''}
                        // FE-12: TFE-20-style guard — re-selecting the current
                        // assignee (or Unassigned when already unassigned) is a no-op.
                        onChange={(v) => {
                          if (v === (selected.assignee_id ?? '')) return;
                          editTicket.mutate({ assignee_id: v || null });
                        }}
                        options={[
                          { value: '', label: 'Unassigned' },
                          // FE-10: pin the current assignee (NewTicketForm requester
                          // pattern) — past the first 200 users the Select would
                          // otherwise fall back to the placeholder.
                          ...(selected.assignee_id && !staffUsers.some((u) => u.id === selected.assignee_id)
                            ? [{ value: selected.assignee_id, label: selected.assignee_name ?? 'Current assignee' }]
                            : []),
                          ...staffUsers.map((u) => ({
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
                  {/* UX-05 (#179): staff asset link/unlink — same picker
                      pattern as NewTicketForm, PATCHes asset_id. */}
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Linked asset</label>
                    <div className={cn(editTicket.isPending && 'pointer-events-none opacity-60')} aria-disabled={editTicket.isPending}>
                      <Select
                        ariaLabel="Ticket linked asset"
                        className="w-full"
                        value={selected.asset_id ?? ''}
                        // FE-12-style guard — re-selecting the current asset
                        // is a no-op (no pointless PATCH).
                        onChange={(v) => {
                          if (v === (selected.asset_id ?? '')) return;
                          editTicket.mutate({ asset_id: v || null });
                        }}
                        options={assetPickerOptions}
                      />
                    </div>
                    {assets.data && assets.data.total > assets.data.items.length && (
                      <p className="mt-1 text-[10px] text-muted">
                        Showing first {assets.data.items.length} of {assets.data.total} assets
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
  // CT-08: backend emits these — without labels the thread rendered raw
  // action slugs (e.g. "edit", "asset", "convert").
  TICKET_EDIT: 'edited the ticket',
  TICKET_ASSET: 'updated the linked asset',
  TICKET_CONVERT: 'converted to KB article',
  SLA_ESCALATE: 'escalated SLA breach',
};

// CT-07: explicit thread window — matches the backend default (100). Any
// section hitting it is truncated, and the thread says so (below).
const TIMELINE_LIMIT = 100;

// CT-08: TICKET_EDIT diffs are per-field { from, to } pairs (title,
// ticket_type, description previews) — flatten them into the same from → to
// style as status/priority changes.
function editDiffs(details: Record<string, unknown>): string[] {
  const out: string[] = [];
  const fields = [
    ['title', 'title'],
    ['ticket_type', 'type'],
    ['description', 'description'],
  ] as const;
  for (const [key, label] of fields) {
    const pair = details[key] as { from?: unknown; to?: unknown } | undefined;
    if (pair && typeof pair === 'object' && ('from' in pair || 'to' in pair)) {
      const from = pair.from == null || pair.from === '' ? '—' : String(pair.from);
      const to = pair.to == null || pair.to === '' ? '—' : String(pair.to);
      out.push(`${label}: ${from} → ${to}`);
    }
  }
  return out;
}

function TicketThread({ ticketId, isAdmin }: { ticketId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const me = getCachedUser();
  const [draft, setDraft] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [confirmAttDel, setConfirmAttDel] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadErr, setUploadErr] = useState('');

  const tl = useQuery({
    queryKey: ['ticket-timeline', ticketId],
    // CT-07: pin the window explicitly — the backend default is also 100, but
    // an explicit limit lets the thread honestly report truncation (below).
    queryFn: () => getTicketTimeline(ticketId, { limit: TIMELINE_LIMIT }),
  });

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

  // CT-07: any section at the window edge means older rows were cut — say so
  // instead of silently showing a partial thread.
  const timelineTruncated =
    comments.length >= TIMELINE_LIMIT ||
    changes.length >= TIMELINE_LIMIT ||
    attachments.length >= TIMELINE_LIMIT;

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

      {/* FE-04: a failed thread fetch must not render as an empty "No
          activity yet" — skeleton while loading, TFE-01 error block with
          Retry (refetch) on failure. The composer below stays mounted. */}
      {tl.isLoading ? (
        <div
          data-testid="thread-skeleton"
          aria-busy="true"
          aria-label="Loading activity"
          className="mb-3 space-y-2"
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse rounded-lg glass-dense p-2">
              <div className="h-3 w-1/3 rounded bg-elevated" />
              <div className="mt-2 h-3 w-2/3 rounded bg-elevated" />
            </div>
          ))}
        </div>
      ) : tl.isError ? (
        <div role="alert" className="mb-3 rounded-lg glass-card liquid-glass-subcard px-4 py-6 text-center">
          <p className="text-sm font-semibold text-primary">Couldn&apos;t load activity</p>
          <p className="mt-1 text-xs text-muted">
            {tl.error instanceof Error ? tl.error.message : 'Something went wrong while fetching the ticket activity.'}
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={() => tl.refetch()} className="mt-3">
            Retry
          </Button>
        </div>
      ) : (
        <>
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
                    {/* FE-13: freeze the confirm while the DELETE is in flight — a
                        double-click otherwise fires a second DELETE at a gone row. */}
                    <button type="button" onClick={() => delAtt.mutate(a.id)} disabled={delAtt.isPending} className="inline-flex min-h-6 items-center rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-60">Confirm</button>
                    <button type="button" onClick={() => setConfirmAttDel(null)} disabled={delAtt.isPending} className="inline-flex min-h-6 items-center rounded border border-edge px-1.5 py-0.5 text-[10px] text-secondary disabled:opacity-60">No</button>
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
                        {/* FE-13: freeze the confirm while the DELETE is in flight. */}
                        <button type="button" onClick={() => delComment.mutate(c.id)} disabled={delComment.isPending} className="inline-flex min-h-6 items-center rounded bg-red-500 px-1.5 py-0.5 font-semibold text-white disabled:opacity-60">Confirm</button>
                        <button type="button" onClick={() => setConfirmDel(null)} disabled={delComment.isPending} className="inline-flex min-h-6 items-center rounded border border-edge px-1.5 py-0.5 disabled:opacity-60">No</button>
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
          // CT-08: precompute the EDIT field diffs once per row.
          const edit = h.action === 'TICKET_EDIT' ? editDiffs(h.details ?? {}) : [];
          return (
            <div key={e.key} className="flex items-baseline gap-2 text-[11px] text-muted">
              <span className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full bg-accent/60" />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-secondary">{h.actor || 'System'}</span>{' '}
                {CHANGE_LABEL[h.action] ?? h.action.replace('TICKET_', '').toLowerCase()}
                {(h.action === 'TICKET_STATUS' || h.action === 'TICKET_PRIORITY') && Boolean(h.details?.from && h.details?.to) && (
                  <span> ({String(h.details.from).replace('_', ' ')} → {String(h.details.to).replace('_', ' ')})</span>
                )}
                {/* CT-08: asset (un)links carry nullable id endpoints — either
                    side may be missing, so key off presence, not truthiness. */}
                {h.action === 'TICKET_ASSET' && h.details && ('from' in h.details || 'to' in h.details) && (
                  <span> ({h.details.from == null ? 'none' : String(h.details.from)} → {h.details.to == null ? 'none' : String(h.details.to)})</span>
                )}
                {h.action === 'TICKET_EDIT' && edit.length > 0 && (
                  <span> ({edit.join('; ')})</span>
                )}
              </span>
              <span className="shrink-0 font-mono text-[9px]">{formatDate(h.at)}</span>
            </div>
          );
        })}
      </div>
      {/* CT-07: the thread window is 100 per section — when a section hits it,
          older rows were cut server-side, so say so instead of implying completeness. */}
      {timelineTruncated && (
        <p className="mb-3 text-[10px] text-muted">
          {`Showing first ${TIMELINE_LIMIT} entries — older activity is hidden.`}
        </p>
      )}
        </>
      )}

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
          disabled={post.isPending}
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
            // FE-14: the gate checks draft.trim() — post the trimmed text, not
            // the padded original (leading/trailing blank lines in the thread).
            onClick={() => draft.trim() && post.mutate(draft.trim())}
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
  // FE-09: closing resets the mutation — a stale failure must not greet the next open.
  const closeConfirm = () => {
    convert.reset();
    setConfirming(false);
  };
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
      {confirming && (
        // FE-01: nested over the z-70 drawer — render above it.
        <Modal title="Convert to KB article" onClose={closeConfirm} zIndex={80}>
          <p className="text-sm text-secondary">
            Capture <span className="font-mono text-accent">{ticket.ticket_number}</span> as a
            knowledge-base article? You&apos;ll be taken to the new article.
          </p>
          {/* FE-09: the failure lives INSIDE the confirm, above the buttons —
              the old slot behind the trigger was hidden by the modal's own
              scrim. A retry clears it (pending resets isError); closeConfirm
              resets it on close. */}
          {convert.isError && (
            <FieldError
              id="ticket-convert-error"
              error={convert.error instanceof Error ? convert.error.message : 'Conversion failed.'}
            />
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={closeConfirm}>
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
  const [activeIdx, setActiveIdx] = useState(0);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const canned = useQuery({ queryKey: ['kb-canned'], queryFn: () => listCanned(), enabled: user?.role !== 'EMPLOYEE' });
  const items = canned.data ?? [];
  // Latest onPick without resubscribing the key handler every render.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const focusTrigger = () => {
    wrapRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  };
  // FE-08: focus moves into the menu on open (Escape/select return it).
  useEffect(() => {
    if (!open) return;
    setActiveIdx(0);
    menuRef.current?.focus();
  }, [open]);
  // FE-08: arrows/Home/End move the active option, Enter/Space picks it —
  // focus stays on the menu with aria-activedescendant (the Select.tsx
  // pattern). TFE-21 dismiss rules stay: outside-mousedown / Escape (capture
  // + stopPropagation so the drawer's own Escape handler stays shut),
  // scroll/resize close since the fixed menu must not float detached.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        focusTrigger();
        return;
      }
      const len = items.length;
      if (len === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((i) => (i + 1) % len);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((i) => (i - 1 + len) % len);
      } else if (e.key === 'Home') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx(len - 1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        const c = items[activeIdx] ?? items[0];
        if (c) {
          onPickRef.current(c.body);
          setOpen(false);
          focusTrigger();
        }
      }
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, activeIdx, items]);
  // TFE-21: measure + place synchronously after commit (Select pattern) so the
  // fixed menu lands exactly above the trigger before paint. role="listbox"
  // lets it share the drawer/Modal Escape + focus-trap guards with Select.
  useLayoutEffect(() => {
    if (!open) return;
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const menuW = Math.min(320, window.innerWidth - 40);
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - menuW - 8)),
      bottom: Math.max(8, window.innerHeight - r.top + 4),
    });
  }, [open]);
  if (user?.role === 'EMPLOYEE') return null;
  if (!canned.data?.length) return null;
  const activeId = items[activeIdx] ? `canned-opt-${items[activeIdx].id}` : undefined;
  return (
    <div className="relative" ref={wrapRef}>
      <Button
        type="button"
        onClick={() => setOpen((v) => !v)}
        variant="secondary"
        size="sm"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="canned-menu"
        className="border-edge px-2 py-1 text-[11px] text-accent"
        leftIcon={<Zap className="h-3 w-3" />}
      >
        Canned response
      </Button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label="Canned responses"
            id="canned-menu"
            tabIndex={-1}
            aria-activedescendant={activeId}
            style={{ position: 'fixed', left: pos?.left ?? 0, bottom: pos?.bottom ?? 0 }}
            className="z-[70] max-h-56 w-80 max-w-[calc(100dvw-2.5rem)] overflow-y-auto rounded-xl glass-chrome p-1 shadow-xl"
          >
            {items.map((c, i) => (
              <button
                key={c.id}
                type="button"
                role="option"
                id={`canned-opt-${c.id}`}
                aria-selected={i === activeIdx}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => { onPick(c.body); setOpen(false); }}
                className={cn(
                  'block w-full rounded-lg px-2.5 py-2 text-left hover:bg-elevated',
                  i === activeIdx && 'bg-elevated',
                )}
              >
                <span className="block text-xs font-semibold text-primary">{c.title}</span>
                <span className="block truncate text-[11px] text-muted">{c.body}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
