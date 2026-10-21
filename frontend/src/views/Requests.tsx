import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  Clock,
  LoaderCircle,
  Plus,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from 'lucide-react';
import { cn, inputCls, labelCls } from '@/lib/utils';
import { useServerPagination } from '@/lib/usePagination';
import Modal from '@/components/Modal';
import PaginationFooter from '@/components/PaginationFooter';
import Select from '@/components/Select';
import { Button } from '@/components/Button';
import { getCachedUser } from '@/api/client';
import {
  approveRequest,
  createRequest,
  getCatalog,
  getRequests,
  rejectRequest,
  updateRequest,
} from '@/api/client';
import type {
  CatalogFormField,
  CatalogItem,
  RequestPriority,
  RequestStatus,
  ServiceRequest,
} from '@/api/types';

const STATUS_STYLE: Record<RequestStatus, string> = {
  SUBMITTED: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  APPROVED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  REJECTED: 'bg-red-500/10 text-red-400 border-red-500/30',
  IN_PROGRESS: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  COMPLETED: 'bg-elevated/10 text-secondary border-edge2/30',
  CANCELLED: 'bg-elevated/10 text-muted border-edge2/30',
};

const PRIORITY_STYLE: Record<RequestPriority, string> = {
  LOW: 'text-secondary',
  MEDIUM: 'text-blue-400',
  HIGH: 'text-amber-400',
  URGENT: 'text-red-400',
};

const PRIORITIES: RequestPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

type Tab = 'mine' | 'pending' | 'all';

export default function Requests() {
  const me = getCachedUser();
  const isAgent = me?.role === 'ADMIN' || me?.role === 'AGENT';
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? (isAgent ? 'pending' : 'mine');
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();

  const { page, pageSize, setPage, setPageSize, reset, offset } = useServerPagination(20);

  const requests = useQuery({
    queryKey: ['requests', tab, page, pageSize],
    queryFn: () => {
      if (tab === 'mine') return getRequests({ mine: true, limit: pageSize, offset });
      if (tab === 'pending') return getRequests({ pending: true, limit: pageSize, offset });
      return getRequests({ limit: pageSize, offset });
    },
  });

  // Approval badge must not depend on the current page — one row is enough
  // to read X-Total-Count for the filtered pending queue.
  const pendingQ = useQuery({
    queryKey: ['requests-pending-count'],
    queryFn: () => getRequests({ pending: true, limit: 1 }),
  });
  const pendingCount = pendingQ.data?.total ?? 0;

  const setTab = (t: Tab) => {
    const p = new URLSearchParams(params);
    p.set('tab', t);
    setParams(p, { replace: true });
    reset();
  };

  const mutate = useMutation({
    mutationFn: ({ id, fn }: { id: string; fn: 'approve' | 'reject' | 'cancel' | 'progress' | 'complete' }) => {
      if (fn === 'approve') return approveRequest(id);
      if (fn === 'reject') return rejectRequest(id);
      if (fn === 'cancel') return updateRequest(id, { status: 'CANCELLED' });
      if (fn === 'progress') return updateRequest(id, { status: 'IN_PROGRESS' });
      return updateRequest(id, { status: 'COMPLETED' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const list = useMemo(() => requests.data?.items ?? [], [requests.data]);

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'mine', label: 'My Requests' },
    ...(isAgent ? [{ id: 'pending' as Tab, label: 'Approvals', badge: pendingCount }] : []),
    ...(isAgent ? [{ id: 'all' as Tab, label: 'All Requests' }] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Service Requests</h1>
          <p className="text-xs text-secondary">
            Raise a structured IT request instead of a corridor / WhatsApp ask.
          </p>
        </div>
        <Button
          onClick={() => setCreating(true)}
          variant="primary"
          leftIcon={<Plus className="h-4 w-4" />}
        >
          New Request
        </Button>
      </div>

      {/* tabs */}
      <div className="flex gap-1 rounded-xl glass-dense p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
              tab === t.id ? 'bg-accent text-white' : 'text-secondary hover:text-primary',
            )}
          >
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className="rounded-full bg-red-500/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* list */}
      <div className="flex flex-col gap-3">
        {requests.isLoading && (
          <div className="flex justify-center py-10">
            <LoaderCircle className="h-6 w-6 animate-spin text-muted" />
          </div>
        )}
        {!requests.isLoading && list.length === 0 && (
          <div className="rounded-xl border border-dashed border-edge p-10 text-center text-sm text-secondary">
            {tab === 'pending' ? 'No requests waiting for approval. 🎉' : 'No requests here yet.'}
          </div>
        )}
        {list.map((r) => (
          <RequestCard
            key={r.id}
            r={r}
            isAgent={isAgent}
            onAction={(fn) => mutate.mutate({ id: r.id, fn })}
          />
        ))}
      </div>

      <PaginationFooter
        page={page}
        pageSize={pageSize}
        total={requests.data?.total}
        rowsLength={list.length}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      {creating && (
        <CreateRequestModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            qc.invalidateQueries({ queryKey: ['requests'] });
            qc.invalidateQueries({ queryKey: ['dashboard'] });
          }}
        />
      )}
    </div>
  );
}

function RequestCard({
  r,
  isAgent,
  onAction,
}: {
  r: ServiceRequest;
  isAgent: boolean;
  onAction: (fn: 'approve' | 'reject' | 'cancel' | 'progress' | 'complete') => void;
}) {
  const [confirmReject, setConfirmReject] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-xl glass-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] text-muted">{r.request_number}</span>
          <span className="text-sm font-medium">{r.subject}</span>
          <span
            className={cn(
              'rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
              'bg-accent/10 text-accent border-accent/30',
            )}
          >
            {r.catalog_name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('text-xs font-semibold', PRIORITY_STYLE[r.priority])}>{r.priority}</span>
          <span className={cn('rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', STATUS_STYLE[r.status])}>
            {r.status.replace('_', ' ')}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {r.requester_name && <span>{r.requester_name}</span>}
          {r.assignee_name && <span>→ {r.assignee_name}</span>}
          {r.approved_by && r.status === 'APPROVED' && (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <ShieldCheck className="h-3 w-3" /> Approved by {r.approved_by ? 'agent' : 'system'}
            </span>
          )}
          <span>{new Date(r.created_at).toLocaleDateString()}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {isAgent && r.status === 'SUBMITTED' && (
            <>
              <button
                onClick={() => onAction('approve')}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:opacity-90"
              >
                <ThumbsUp className="h-3.5 w-3.5" /> Approve
              </button>
              {confirmReject ? (
                <>
                  <button
                    onClick={() => onAction('reject')}
                    className="rounded-lg bg-red-500 px-2.5 py-1.5 text-[11px] font-semibold text-white"
                  >
                    Confirm reject
                  </button>
                  <button
                    onClick={() => setConfirmReject(false)}
                    className="rounded-lg border border-edge px-2.5 py-1.5 text-[11px] text-secondary"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmReject(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-[11px] font-medium text-red-400 hover:bg-red-500/10"
                >
                  <ThumbsDown className="h-3.5 w-3.5" /> Reject
                </button>
              )}
            </>
          )}
          {isAgent && r.status === 'APPROVED' && (
            <button
              onClick={() => onAction('progress')}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-500 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:opacity-90"
            >
              <Clock className="h-3.5 w-3.5" /> Start work
            </button>
          )}
          {isAgent && r.status === 'IN_PROGRESS' && (
            <button
              onClick={() => onAction('complete')}
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-white hover:opacity-90"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Complete
            </button>
          )}
          {!isAgent && (r.status === 'SUBMITTED' || r.status === 'APPROVED') && (
            <button
              onClick={() => onAction('cancel')}
              className="inline-flex items-center gap-1 rounded-lg border border-edge px-2.5 py-1.5 text-[11px] text-muted hover:bg-elevated"
            >
              <XCircle className="h-3.5 w-3.5" /> Cancel
            </button>
          )}
        </div>
      </div>

      {/* answers */}
      {Object.keys(r.details || {}).length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5 border-t border-edge pt-2">
          {Object.entries(r.details as Record<string, unknown>)
            .filter(([, v]) => v !== '' && v != null)
            .map(([k, v]) => (
              <span key={k} className="rounded-md bg-elevated px-2 py-1 text-[10px] text-secondary">
                <span className="font-medium capitalize">{k.replace(/_/g, ' ')}:</span> {String(v)}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

// ── Create request modal ────────────────────────────────────────────────────

function CreateRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [catalogId, setCatalogId] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [priority, setPriority] = useState<RequestPriority>('MEDIUM');
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const catalog = useQuery({ queryKey: ['catalog'], queryFn: getCatalog, staleTime: 60_000 });
  const items = useMemo(() => catalog.data ?? [], [catalog.data]);
  const item: CatalogItem | undefined = items.find((i) => i.id === catalogId);

  const create = useMutation({
    mutationFn: () =>
      createRequest({
        catalog_item_id: catalogId,
        subject: subject.trim(),
        priority,
        details: answers,
      }),
    onSuccess: onCreated,
  });

  const missingRequired = useMemo(() => {
    if (!item) return false;
    return item.form_fields.some((f) => f.required && !(answers[f.key] || '').trim());
  }, [item, answers]);

  const pickItem = (id: string) => {
    setCatalogId(id);
    const it = items.find((i) => i.id === id);
    if (it) {
      setAnswers(Object.fromEntries(it.form_fields.map((f) => [f.key, ''])));
      // default subject from item name
      setSubject((s) => s || `${it.name}`);
    }
  };

  const fieldInput = (f: CatalogFormField) => {
    if (f.type === 'textarea') {
      return (
        <textarea
          className={cn(inputCls, 'min-h-[72px]')}
          value={answers[f.key] ?? ''}
          onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
        />
      );
    }
    if (f.type === 'select') {
      return (
        <Select
          value={answers[f.key] ?? ''}
          onChange={(v) => setAnswers((a) => ({ ...a, [f.key]: v }))}
          options={(f.options ?? []).map((o) => ({ value: o, label: o }))}
          placeholder={f.required ? 'Select…' : 'Optional'}
        />
      );
    }
    if (f.type === 'date') {
      return (
        <input
          type="date"
          className={inputCls}
          value={answers[f.key] ?? ''}
          onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
        />
      );
    }
    return (
      <input
        className={inputCls}
        value={answers[f.key] ?? ''}
        onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
        placeholder={f.label}
      />
    );
  };

  return (
    <Modal onClose={onClose} title="New Service Request">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Request type</span>
          <Select
            value={catalogId}
            onChange={pickItem}
            options={items.map((i) => ({ value: i.id, label: `${i.name}${i.approval_required ? ' · needs approval' : ''}` }))}
            placeholder="Choose a request type…"
          />
        </label>

        {item && (
          <>
            <div className="rounded-lg glass-dense p-3 text-[11px] text-secondary">
              {item.description}
              {item.approval_required && (
                <span className="mt-1 flex items-center gap-1 text-amber-400">
                  <ShieldCheck className="h-3 w-3" /> This request needs a one-click approval.
                </span>
              )}
            </div>

            <label className="flex flex-col gap-1">
              <span className={labelCls}>Subject</span>
              <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary" />
            </label>

            {item.form_fields.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className={labelCls}>
                  {f.label} {f.required && <span className="text-red-400">*</span>}
                </span>
                {fieldInput(f)}
              </label>
            ))}

            <label className="flex flex-col gap-1">
              <span className={labelCls}>Priority</span>
              <Select
                value={priority}
                onChange={(v) => setPriority(v as RequestPriority)}
                options={PRIORITIES.map((p) => ({ value: p, label: p }))}
              />
            </label>
          </>
        )}

        {create.isError && <p className="text-xs text-red-400">Failed to submit. Please try again.</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="secondary">Cancel</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!catalogId || !subject.trim() || missingRequired}
            loading={create.isPending}
            variant="primary"
          >
            Submit Request
          </Button>
        </div>
      </div>
    </Modal>
  );
}
