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
import Select from '@/components/Select';
import { inputCls, labelCls } from '@/lib/utils';

export default function NewTicketForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateTicketInput>({
    title: '',
    description: '',
    ticket_type: 'INCIDENT',
    priority: 'MEDIUM',
    requester_id: getCachedUser()?.id ?? '',
  });
  const users = useQuery({ queryKey: ['users', 'picker'], queryFn: () => listUsers({ limit: 200 }) });
  const assets = useQuery({ queryKey: ['assets', 'picker'], queryFn: () => listAssets({ limit: 200 }) });
  const mutation = useMutation({
    mutationFn: createTicket,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['metrics'] });
      qc.invalidateQueries({ queryKey: ['service-queue'] });
      onDone();
    },
  });
  const set = <K extends keyof CreateTicketInput>(k: K, v: CreateTicketInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const me = getCachedUser();
  const requesterOptions = [
    { value: '', label: 'Current user (default)' },
    ...(me && !(users.data?.items ?? []).some((u) => u.id === me.id)
      ? [{ value: me.id, label: `${me.name} (You)` }]
      : []),
    ...(users.data?.items ?? []).map((u) => ({
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
        mutation.mutate({
          ...form,
          description: form.description ?? '',
          requester_id: form.requester_id || getCachedUser()?.id || undefined,
          asset_id: form.asset_id || undefined,
        });
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Requester</label>
          <Select
            className="w-full"
            value={form.requester_id ?? ''}
            onChange={(v) => set('requester_id', v)}
            options={requesterOptions}
          />
        </div>
        <div>
          <label className={labelCls}>Linked Asset</label>
          <Select
            className="w-full"
            value={form.asset_id ?? ''}
            onChange={(v) => set('asset_id', v)}
            options={assetOptions}
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
