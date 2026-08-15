import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Database, LoaderCircle, Pencil, Plus, Save, ShieldAlert, Trash2, UserPlus, Users } from 'lucide-react';
import { cn, inputCls, labelCls } from '@/lib/utils';
import Modal from '@/components/Modal';
import ScrollX from '@/components/ScrollX';
import Select from '@/components/Select';
import DataTable, { type Column } from '@/components/DataTable';
import { getCachedUser } from '@/api/client';
import {
  createMasterOption,
  createUser,
  deleteMasterOption,
  getMasters,
  listUsers,
  updateMasterOption,
  updateUser,
} from '@/api/client';
import type { LookupOption, MasterFamily, UserRecord } from '@/api/types';

const TABS: { id: MasterFamily | 'users'; label: string }[] = [
  { id: 'users', label: 'Users' },
  { id: 'department', label: 'Departments' },
  { id: 'asset_category', label: 'Asset Categories' },
  { id: 'ticket_type', label: 'Ticket Types' },
  { id: 'ticket_priority', label: 'Priorities' },
  { id: 'ticket_status', label: 'Statuses' },
];

const ROLES = ['ADMIN', 'AGENT', 'EMPLOYEE'];

const ROLE_STYLE: Record<string, string> = {
  ADMIN: 'bg-accent/10 text-accent border-indigo-500/30',
  AGENT: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  EMPLOYEE: 'bg-elevated/10 text-secondary border-edge2/30',
};

export default function Masters() {
  const me = getCachedUser();
  const [tab, setTab] = useState<MasterFamily | 'users'>('users');
  const masters = useQuery({ queryKey: ['masters'], queryFn: getMasters, staleTime: 30_000 });

  if (me?.role !== 'ADMIN') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-edge p-12 text-center">
        <ShieldAlert className="h-8 w-8 text-muted" />
        <p className="text-sm text-secondary">Only administrators can manage users and master data.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-primary">Masters</h1>
        <p className="mt-0.5 text-sm text-secondary">Users and lookup data powering every dropdown.</p>
      </div>

      <ScrollX className="pb-1">
        <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3.5 text-sm font-medium transition-colors',
              tab === t.id
                ? 'border-indigo-500/50 bg-accent/10 text-accent'
                : 'border-edge bg-surface/60 text-secondary hover:border-edge2 hover:text-primary',
            )}
          >
            {t.id === 'users' ? <Users className="h-4 w-4" /> : <Database className="h-4 w-4" />}
            {t.label}
          </button>
        ))}
        </div>
      </ScrollX>

      {tab === 'users' ? (
        <UsersTab />
      ) : (
        <LookupTab family={tab} options={masters.data?.[tab] ?? []} loading={masters.isLoading} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users tab
// ---------------------------------------------------------------------------

function UsersTab() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserRecord | null>(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'EMPLOYEE', department: 'IT', password: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const search = params.get('search') ?? '';
  const role = params.get('role') ?? '';
  const department = params.get('department') ?? '';
  const sort = params.get('sort') ?? null;
  const order = (params.get('order') as 'asc' | 'desc' | null) ?? null;

  const users = useQuery({
    queryKey: ['users', { search, role, department }, page, pageSize, sort, order],
    queryFn: () =>
      listUsers({
        search: search || undefined,
        role: role || undefined,
        department: department || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        sort: sort ?? undefined,
        order: order ?? undefined,
      }),
  });
  useEffect(() => {
    setPage(1);
  }, [search, role, department, sort, order]);
  const masters = useQuery({ queryKey: ['masters'], queryFn: getMasters, staleTime: 30_000 });
  const departments = masters.data?.department ?? [];

  const mutation = useMutation({
    mutationFn: (input: { id?: string; body: Record<string, unknown> }) =>
      input.id ? updateUser(input.id, input.body) : createUser(input.body as never),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setFormOpen(false);
      setEditing(null);
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', email: '', role: 'EMPLOYEE', department: departments[0]?.code ?? 'IT', password: '' });
    setFormError(null);
    setFormOpen(true);
  };
  const openEdit = (u: UserRecord) => {
    setEditing(u);
    setForm({ name: u.name, email: u.email, role: u.role, department: u.department, password: '' });
    setFormError(null);
    setFormOpen(true);
  };

  const toggleActive = (u: UserRecord) =>
    mutation.mutate({ id: u.id, body: { active: !u.active } });

  const columns: Column<UserRecord>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        sortable: true,
        className: 'max-w-[150px]',
        render: (u) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-primary">{u.name}</p>
            <p className="truncate text-xs text-muted">{u.email}</p>
          </div>
        ),
      },
      {
        key: 'role',
        header: 'Role',
        sortable: true,
        className: 'w-[86px]',
        render: (u) => (
          <span className={cn('inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium', ROLE_STYLE[u.role] ?? ROLE_STYLE.EMPLOYEE)}>
            {u.role}
          </span>
        ),
      },
      {
        key: 'department',
        header: 'Department',
        sortable: true,
        className: 'hidden sm:table-cell',
        render: (u) => <span className="text-secondary">{u.department}</span>,
      },
      {
        key: 'active',
        header: 'Status',
        className: 'hidden sm:table-cell',
        render: (u) => (
          <span className={cn('inline-flex items-center gap-1.5 text-xs', u.active ? 'text-emerald-400' : 'text-muted')}>
            <span className={cn('h-1.5 w-1.5 rounded-full', u.active ? 'bg-emerald-400' : 'bg-elevated2')} />
            {u.active ? 'Active' : 'Disabled'}
          </span>
        ),
      },
      {
        key: 'id',
        header: '',
        className: 'sticky right-0 w-28 border-l border-edge bg-inherit',
        render: (u) => (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => openEdit(u)}
              aria-label={`Edit ${u.name}`}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-elevated hover:text-accent"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => toggleActive(u)}
              disabled={u.email === 'admin@itms.local'}
              title={u.email === 'admin@itms.local' ? 'Seed admin cannot be disabled' : u.active ? 'Disable' : 'Enable'}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                u.active
                  ? 'text-secondary hover:bg-red-500/10 hover:text-red-400'
                  : 'text-muted hover:bg-emerald-500/10 hover:text-emerald-400',
                u.email === 'admin@itms.local' && 'cursor-not-allowed opacity-30',
              )}
            >
              {u.active ? <Trash2 className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            </button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [departments],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={cn(inputCls, 'w-full sm:w-56')}
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setParams(e.target.value ? { search: e.target.value } : {}, { replace: true })}
        />
        <Select
          className="w-auto min-w-[130px]"
          value={role}
          onChange={(v) => setParams(v ? { role: v } : {}, { replace: true })}
          options={[{ value: '', label: 'All Roles' }, ...ROLES.map((r) => ({ value: r, label: r }))]}
        />
        <Select
          className="w-auto min-w-[150px]"
          value={department}
          onChange={(v) => setParams(v ? { department: v } : {}, { replace: true })}
          options={[
            { value: '', label: 'All Departments' },
            ...departments.filter((d) => d.active).map((d) => ({ value: d.code, label: d.label })),
          ]}
        />
        <button
          type="button"
          onClick={openCreate}
          className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-sm font-medium text-white transition-colors hover:bg-blue-500"
        >
          <Plus className="h-4 w-4" /> New User
        </button>
      </div>

      {users.isLoading ? (
        <div className="flex items-center justify-center rounded-xl border border-edge bg-surface/40 py-16">
          <LoaderCircle className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : (
        <DataTable<UserRecord>
          rows={users.data?.items ?? []}
          total={users.data?.total}
          page={page}
          pageSize={pageSize}
          minWidth="min-w-[340px] sm:min-w-[640px]"
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
          sort={sort ? { key: sort, dir: order === 'desc' ? 'desc' : 'asc' } : null}
          onSortChange={(s) => {
            const next = new URLSearchParams(params);
            if (s) {
              next.set('sort', s.key);
              next.set('order', s.dir);
            } else {
              next.delete('sort');
              next.delete('order');
            }
            setParams(next, { replace: true });
          }}
          columns={columns}
          emptyMessage="No users match the filters."
        />
      )}

      {formOpen && (
        <Modal title={editing ? 'Edit User' : 'New User'} onClose={() => setFormOpen(false)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setFormError(null);
              mutation.mutate({
                id: editing?.id,
                body: editing
                  ? {
                      name: form.name,
                      email: form.email,
                      role: form.role,
                      department: form.department,
                      ...(form.password ? { password: form.password } : {}),
                    }
                  : form,
              });
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="user-name">Full name</label>
                <input id="user-name" className={inputCls} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className={labelCls} htmlFor="user-email">Email</label>
                <input id="user-email" className={inputCls} required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Role</label>
                <Select className="w-full" value={form.role} onChange={(v) => setForm({ ...form, role: v })} options={ROLES.map((r) => ({ value: r, label: r }))} />
              </div>
              <div>
                <label className={labelCls}>Department</label>
                <Select
                  className="w-full"
                  value={form.department}
                  onChange={(v) => setForm({ ...form, department: v })}
                  options={departments.filter((d) => d.active).map((d) => ({ value: d.code, label: d.label }))}
                />
              </div>
            </div>
            <div>
              <label className={labelCls} htmlFor="user-password">{editing ? 'New password (leave blank to keep)' : 'Password'}</label>
              <input
                id="user-password"
                className={inputCls}
                type="password"
                minLength={editing ? undefined : 8}
                required={!editing}
                placeholder={editing ? '••••••••' : 'At least 8 characters'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            {formError && <p className="text-xs text-red-400">{formError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setFormOpen(false)} className="h-10 rounded-lg border border-edge2 px-4 text-sm text-secondary hover:bg-elevated">
                Cancel
              </button>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
              >
                {mutation.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {editing ? 'Save changes' : 'Create user'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lookup family tab (departments, categories, types, priorities, statuses)
// ---------------------------------------------------------------------------

function LookupTab({ family, options, loading }: { family: MasterFamily; options: LookupOption[]; loading: boolean }) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, { label: string; sort_order: number }>>({});
  const [newRow, setNewRow] = useState({ code: '', label: '', sort_order: 0 });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['masters'] });

  const saveMut = useMutation({
    mutationFn: (o: { id: string; body: { label?: string; sort_order?: number; active?: boolean } }) => updateMasterOption(o.id, o.body),
    onSuccess: () => {
      invalidate();
      setDrafts({});
    },
  });
  const createMut = useMutation({
    mutationFn: () =>
      createMasterOption({
        family,
        code: newRow.code.trim().toUpperCase(),
        label: newRow.label.trim(),
        sort_order: newRow.sort_order,
      }),
    onSuccess: () => {
      invalidate();
      setNewRow({ code: '', label: '', sort_order: 0 });
    },
  });
  const delMut = useMutation({
    mutationFn: (id: string) => deleteMasterOption(id),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-3">
      <ScrollX className="rounded-xl border border-edge">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-edge bg-surface/60 text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Label</th>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="w-24 px-4 py-3 font-medium">Order</th>
              <th className="w-24 px-4 py-3 font-medium">Active</th>
              <th className="w-32 px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-edge bg-base">
            {(options ?? []).map((o) => {
              const d = drafts[o.id] ?? { label: o.label, sort_order: o.sort_order };
              const dirty = d.label !== o.label || d.sort_order !== o.sort_order;
              return (
                <tr key={o.id} className="animate-list-in">
                  <td className="px-4 py-2.5">
                    <input
                      className={cn(inputCls, 'h-9')}
                      value={d.label}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [o.id]: { ...d, label: e.target.value } }))}
                    />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted">{o.code}</td>
                  <td className="px-4 py-2.5">
                    <input
                      className={cn(inputCls, 'h-9 w-16')}
                      type="number"
                      value={d.sort_order}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [o.id]: { ...d, sort_order: Number(e.target.value) } }))}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => saveMut.mutate({ id: o.id, body: { active: !o.active } })}
                      className={cn(
                        'relative h-6 w-11 rounded-full transition-colors',
                        o.active ? 'bg-emerald-500/80' : 'bg-elevated2',
                      )}
                      aria-label={o.active ? 'Deactivate' : 'Activate'}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all',
                          o.active ? 'left-[22px]' : 'left-0.5',
                        )}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => saveMut.mutate({ id: o.id, body: d })}
                        disabled={!dirty || saveMut.isPending}
                        className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <Save className="h-3.5 w-3.5" /> Save
                      </button>
                      {confirmDelete === o.id ? (
                        <button
                          type="button"
                          onClick={() => {
                            delMut.mutate(o.id);
                            setConfirmDelete(null);
                          }}
                          className="inline-flex h-9 items-center rounded-lg bg-red-500/15 px-2.5 text-xs font-medium text-red-400 hover:bg-red-500/25"
                        >
                          Sure?
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDelete(o.id);
                            window.setTimeout(() => setConfirmDelete((c) => (c === o.id ? null : c)), 3000);
                          }}
                          aria-label={`Delete ${o.label}`}
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && (options ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted">
                  No options yet — add the first one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollX>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-edge p-3">
        <div>
          <label className={labelCls}>New label</label>
          <input className={cn(inputCls, 'w-48')} placeholder="e.g. Blocker" value={newRow.label} onChange={(e) => setNewRow({ ...newRow, label: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>Code</label>
          <input className={cn(inputCls, 'w-40 font-mono')} value={newRow.code} onChange={(e) => setNewRow({ ...newRow, code: e.target.value })} placeholder="UPPER_SNAKE" />
        </div>
        <div>
          <label className={labelCls}>Order</label>
          <input className={cn(inputCls, 'w-16')} type="number" value={newRow.sort_order} onChange={(e) => setNewRow({ ...newRow, sort_order: Number(e.target.value) })} />
        </div>
        <button
          type="button"
          disabled={!newRow.label.trim() || !newRow.code.trim() || createMut.isPending}
          onClick={() => createMut.mutate()}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
        >
          {createMut.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add option
        </button>
        {createMut.isError && <p className="w-full text-xs text-red-400">{(createMut.error as Error).message}</p>}
      </div>
    </div>
  );
}
