import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  createTicket,
  getCachedUser,
  listAssets,
  listTemplates,
  listUsers,
  suggestArticles,
} from '@/api/client';
import { PRIORITIES, TICKET_TYPES } from '@/api/types';
import type { CreateTicketInput, TicketTemplate } from '@/api/types';
import { Button } from '@/components/Button';
import { FieldError, errProps } from '@/components/FieldError';
import Select from '@/components/Select';
import { inputCls, labelCls } from '@/lib/utils';

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4000;

export default function NewTicketForm({
  onDone,
  onNewTicket,
}: {
  onDone: () => void;
  /** TFE-14/C4: called with the created ticket id on success (parent toast/nav hook). */
  onNewTicket?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateTicketInput>({
    title: '',
    description: '',
    ticket_type: 'INCIDENT',
    priority: 'MEDIUM',
    requester_id: getCachedUser()?.id ?? '',
  });
  const me = getCachedUser();
  // TFE-06: the server forces requester=self for EMPLOYEE — hide the picker.
  const isEmployee = me?.role === 'EMPLOYEE';
  const users = useQuery({
    queryKey: ['users', 'picker'],
    queryFn: () => listUsers({ limit: 200 }),
    // TFE-06: employees never see the requester picker — don't fetch it either.
    enabled: !isEmployee,
  });
  const assets = useQuery({ queryKey: ['assets', 'picker'], queryFn: () => listAssets({ limit: 200 }) });
  const [titleError, setTitleError] = useState<string | null>(null);
  // TFE-15: type/priority always hold a value (defaults), so track whether the
  // user picked them — templates fill only untouched fields.
  const [customType, setCustomType] = useState(false);
  const [customPriority, setCustomPriority] = useState(false);
  const mutation = useMutation({
    mutationFn: createTicket,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['metrics'] });
      qc.invalidateQueries({ queryKey: ['service-queue'] });
      if (created?.id) onNewTicket?.(created.id);
      onDone();
    },
  });
  const set = <K extends keyof CreateTicketInput>(k: K, v: CreateTicketInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // CT-03: the backend 422s tickets filed with an inactive requester — only
  // offer active users. The "(You)" fallback covers a self missing from the
  // page, unless the page knows self as inactive.
  const allUsers = users.data?.items ?? [];
  const activeUsers = allUsers.filter((u) => u.active);
  const meKnownInactive = me ? allUsers.some((u) => u.id === me.id && !u.active) : false;
  const requesterOptions = [
    { value: '', label: 'Current user (default)' },
    ...(me && !meKnownInactive && !activeUsers.some((u) => u.id === me.id)
      ? [{ value: me.id, label: `${me.name} (You)` }]
      : []),
    ...activeUsers.map((u) => ({
      value: u.id,
      label: `${u.name} (${u.department})`,
    })),
  ];
  const assetOptions = [
    { value: '', label: 'None (optional)' },
    ...(assets.data?.items ?? []).map((a) => ({
      value: a.id,
      label: `${a.asset_tag} · ${a.name}`,
    })),
  ];

  return (
    <form
      className="space-y-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        // TFE-17: native `required` passes whitespace — check the trimmed value.
        const title = form.title.trim();
        if (!title) {
          setTitleError('Title is required.');
          return;
        }
        setTitleError(null);
        mutation.mutate({
          ...form,
          title,
          description: form.description ?? '',
          requester_id: isEmployee ? me?.id : form.requester_id || me?.id || undefined,
          asset_id: form.asset_id || undefined,
        });
      }}
    >
      <TemplatePicker
        // TFE-15: fill only untouched fields — never overwrite typed/picked values.
        onApply={(t) => setForm((f) => ({
          ...f,
          ticket_type: customType ? f.ticket_type : (t.ticket_type as CreateTicketInput['ticket_type']),
          priority: customPriority ? f.priority : (t.priority as CreateTicketInput['priority']),
          description: f.description?.trim() ? f.description : t.description || f.description,
        }))}
      />
      <div>
        <label className={labelCls}>Title *</label>
        <input
          required
          maxLength={TITLE_MAX}
          className={inputCls}
          value={form.title}
          onChange={(e) => {
            set('title', e.target.value);
            if (titleError) setTitleError(null);
          }}
          placeholder="What's the issue?"
          {...errProps('new-ticket-title', titleError)}
        />
        <FieldError id="new-ticket-title-error" error={titleError} />
      </div>
      <div>
        <label className={labelCls}>Description</label>
        <textarea
          className={inputCls}
          rows={3}
          maxLength={DESCRIPTION_MAX}
          value={form.description ?? ''}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Details (optional)"
        />
      </div>
      <SuggestionPanel query={form.title} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Type</label>
          <Select
            className="w-full"
            value={form.ticket_type}
            onChange={(v) => {
              setCustomType(true);
              set('ticket_type', v as CreateTicketInput['ticket_type']);
            }}
            options={TICKET_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ') }))}
            ariaLabel="Type"
          />
        </div>
        <div>
          <label className={labelCls}>Priority</label>
          <Select
            className="w-full"
            value={form.priority}
            onChange={(v) => {
              setCustomPriority(true);
              set('priority', v as CreateTicketInput['priority']);
            }}
            options={PRIORITIES.map((p) => ({ value: p, label: p }))}
            ariaLabel="Priority"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!isEmployee && (
          <div>
            <label className={labelCls}>Requester</label>
            <Select
              className="w-full"
              value={form.requester_id ?? ''}
              onChange={(v) => set('requester_id', v)}
              options={requesterOptions}
              ariaLabel="Requester"
            />
            {users.data && users.data.total > activeUsers.length && (
              <p className="mt-1 text-[11px] text-muted">
                Showing first {activeUsers.length} of {users.data.total} users
              </p>
            )}
          </div>
        )}
        <div>
          <label className={labelCls}>Linked Asset</label>
          <Select
            className="w-full"
            value={form.asset_id ?? ''}
            onChange={(v) => set('asset_id', v)}
            options={assetOptions}
            ariaLabel="Linked Asset"
          />
          {assets.data && assets.data.total > assets.data.items.length && (
            <p className="mt-1 text-[11px] text-muted">
              Showing first {assets.data.items.length} of {assets.data.total} assets
            </p>
          )}
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

function TemplatePicker({ onApply }: { onApply: (t: TicketTemplate) => void }) {
  const templates = useQuery({ queryKey: ['templates', 'active'], queryFn: () => listTemplates(true) });
  const [selected, setSelected] = useState('');
  if (templates.isLoading) {
    // Reserved-height skeleton so the form below doesn't jump when the
    // picker resolves. Loaded-but-empty still renders null (no shift — the
    // picker never appears).
    return (
      <div className="min-h-[68px]" aria-busy="true">
        <label className={labelCls}>Start from a template</label>
        <div className="pointer-events-none opacity-60" aria-disabled="true">
          <Select
            className="w-full"
            value=""
            onChange={() => {}}
            options={[]}
            placeholder="Loading templates…"
          />
        </div>
      </div>
    );
  }
  if (!templates.data?.length) return null;
  return (
    <div>
      <label className={labelCls}>Start from a template</label>
      <Select
        className="w-full"
        value={selected}
        placeholder="Choose a template…"
        ariaLabel="Choose a template"
        onChange={(v) => {
          const t = templates.data?.find((x) => x.id === v);
          if (t) {
            const normalizedType = (t.ticket_type === 'REQUEST' ? 'SERVICE_REQUEST' : t.ticket_type) as CreateTicketInput['ticket_type'];
            onApply({ ...t, ticket_type: normalizedType });
          }
          setSelected('');
        }}
        options={templates.data.map((t) => ({ value: t.id, label: `${t.name} — ${t.ticket_type} / ${t.priority}` }))}
      />
    </div>
  );
}

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
    <div className="rounded-lg glass-card border-accent/20 bg-accent/5 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-accent">
        Maybe this already exists in the KB?
      </p>
      <div className="mt-1.5 space-y-1">
        {suggestions.data.slice(0, 3).map((a) => (
          <Link
            key={a.id}
            to={`/kb?open=${a.id}`}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-xs text-secondary hover:text-accent hover:underline"
            title={a.body}
          >
            <span className="mr-1.5 rounded bg-accent/15 px-1 py-0.5 text-[9px] font-medium text-accent">
              {a.ticket_type}
            </span>
            {a.title}
          </Link>
        ))}
      </div>
    </div>
  );
}
