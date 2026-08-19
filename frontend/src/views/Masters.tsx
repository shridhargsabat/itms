import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ClipboardList, Database, LoaderCircle, Pencil, Plus, Save, ShieldAlert, Trash2, UserPlus, Users } from 'lucide-react';
import { cn, inputCls, labelCls } from '@/lib/utils';
import { useServerPagination } from '@/lib/usePagination';
import Modal from '@/components/Modal';
import ScrollX from '@/components/ScrollX';
import { Button } from '@/components/Button';
import Select from '@/components/Select';
import DataTable, { type Column } from '@/components/DataTable';
import { getCachedUser } from '@/api/client';
import {
  createMasterOption,
  createTemplate,
  createUser,
  createClaim,
  createVendor,
  createLocation,
  deleteMasterOption,
  deleteTemplate,
  deleteClaim,
  deleteVendor,
  deleteLocation,
  getMasters,
  listClaims,
  listLocationAssets,
  listLocations,
  listTemplates,
  listUsers,
  listVendors,
  updateMasterOption,
  updateTemplate,
  updateUser,
  updateVendor,
  updateLocation,
} from '@/api/client';
import type { LookupOption, LocationWithCount, MasterFamily, TicketTemplate, UserRecord, Vendor, VendorInput } from '@/api/types';

const TABS: { id: MasterFamily | 'users' | 'templates' | 'vendors' | 'locations'; label: string }[] = [
  { id: 'vendors', label: 'Vendors' },
  { id: 'locations', label: 'Locations' },
  { id: 'users', label: 'Users' },
  { id: 'department', label: 'Departments' },
  { id: 'asset_category', label: 'Asset Categories' },
  { id: 'ticket_type', label: 'Ticket Types' },
  { id: 'ticket_priority', label: 'Priorities' },
  { id: 'ticket_status', label: 'Statuses' },
  { id: 'templates', label: 'Ticket Templates' },
];

const ROLES = ['ADMIN', 'AGENT', 'EMPLOYEE'];

const ROLE_STYLE: Record<string, string> = {
  ADMIN: 'bg-accent/10 text-accent border-indigo-500/30',
  AGENT: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  EMPLOYEE: 'bg-elevated/10 text-secondary border-edge2/30',
};

export default function Masters() {
  const me = getCachedUser();
  const [tab, setTab] = useState<MasterFamily | 'users' | 'templates' | 'vendors' | 'locations'>('users');
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
      ) : tab === 'vendors' ? (
        <VendorsTab />
      ) : tab === 'locations' ? (
        <LocationsTab />
      ) : tab === 'templates' ? (
        <TemplatesTab />
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
  const { page, pageSize, setPage, setPageSize, reset, offset } = useServerPagination(20);

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
        offset,
        sort: sort ?? undefined,
        order: order ?? undefined,
      }),
  });
  useEffect(() => {
    reset();
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
            <Button
              type="button"
              onClick={() => openEdit(u)}
              aria-label={`Edit ${u.name}`}
              variant="ghost"
              size="icon"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              onClick={() => toggleActive(u)}
              disabled={u.email === 'admin@itms.local'}
              title={u.email === 'admin@itms.local' ? 'Seed admin cannot be disabled' : u.active ? 'Disable' : 'Enable'}
              variant="ghost"
              size="icon"
              className={cn(
                u.active
                  ? 'hover:bg-red-500/10 hover:text-red-400'
                  : 'text-muted hover:bg-emerald-500/10 hover:text-emerald-400',
                u.email === 'admin@itms.local' && 'cursor-not-allowed opacity-30',
              )}
            >
              {u.active ? <Trash2 className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            </Button>
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
        <Button
          type="button"
          onClick={openCreate}
          className="ml-auto"
          variant="primary"
          leftIcon={<Plus className="h-4 w-4" />}
        >
          New User
        </Button>
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
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
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
              <Button type="button" onClick={() => setFormOpen(false)} variant="secondary" size="lg">
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending}
                loading={mutation.isPending}
                variant="primary"
              >
                {editing ? 'Save changes' : 'Create user'}
              </Button>
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
      <ScrollX className="rounded-xl border border-edge" innerClassName="max-h-[55vh] overflow-y-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-edge bg-surface text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="sticky top-0 z-10 bg-surface px-4 py-3 font-medium">Label</th>
              <th className="sticky top-0 z-10 bg-surface px-4 py-3 font-medium">Code</th>
              <th className="sticky top-0 z-10 w-24 bg-surface px-4 py-3 font-medium">Order</th>
              <th className="sticky top-0 z-10 w-24 bg-surface px-4 py-3 font-medium">Active</th>
              <th className="sticky top-0 z-10 w-32 bg-surface px-4 py-3 font-medium" />
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
                      <Button
                        type="button"
                        onClick={() => saveMut.mutate({ id: o.id, body: d })}
                        disabled={!dirty || saveMut.isPending}
                        variant="ghost"
                        className="gap-1 px-2.5 text-xs font-medium text-accent hover:bg-accent/10"
                        leftIcon={<Save className="h-3.5 w-3.5" />}
                      >
                        Save
                      </Button>
                      {confirmDelete === o.id ? (
                        <Button
                          type="button"
                          onClick={() => {
                            delMut.mutate(o.id);
                            setConfirmDelete(null);
                          }}
                          variant="ghost"
                          className="gap-1 bg-red-500/15 px-2.5 text-xs font-medium text-red-400 hover:bg-red-500/25"
                        >
                          Sure?
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          onClick={() => {
                            setConfirmDelete(o.id);
                            window.setTimeout(() => setConfirmDelete((c) => (c === o.id ? null : c)), 3000);
                          }}
                          aria-label={`Delete ${o.label}`}
                          variant="ghost"
                          size="icon"
                          className="text-muted hover:bg-red-500/10 hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
        <Button
          type="button"
          disabled={!newRow.label.trim() || !newRow.code.trim() || createMut.isPending}
          loading={createMut.isPending}
          onClick={() => createMut.mutate()}
          variant="primary"
          leftIcon={!createMut.isPending ? <Plus className="h-4 w-4" /> : undefined}
        >
          Add option
        </Button>
        {createMut.isError && <p className="w-full text-xs text-red-400">{(createMut.error as Error).message}</p>}
      </div>
    </div>
  );
}


function TemplatesTab() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [tt, setTt] = useState('INCIDENT');
  const [prio, setPrio] = useState('MEDIUM');
  const [desc, setDesc] = useState('');
  const [editing, setEditing] = useState<TicketTemplate | null>(null);
  // Small master data — intentionally unpaginated (backend stays array-bodied).
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => listTemplates() });

  const create = useMutation({
    mutationFn: () => createTemplate({ name, ticket_type: tt, priority: prio, description: desc }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); setName(''); setDesc(''); },
  });
  const save = useMutation({
    mutationFn: () => updateTemplate(editing!.id, { name, ticket_type: tt, priority: prio, description: desc, active: editing?.active }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); setEditing(null); setName(''); setDesc(''); },
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
  const toggle = useMutation({
    mutationFn: (t: TicketTemplate) => updateTemplate(t.id, { active: !t.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });

  const startEdit = (t: TicketTemplate) => { setEditing(t); setName(t.name); setTt(t.ticket_type); setPrio(t.priority); setDesc(t.description); };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-edge bg-surface/60 p-4">
        <h2 className="text-sm font-semibold text-primary">{editing ? 'Edit template' : 'New template'}</h2>
        <p className="mt-0.5 text-xs text-muted">Standard intakes — requesters pick these in the New Ticket form.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className={labelCls}>Name *</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="New-hire setup" />
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <Select className="w-full" value={tt} onChange={(v) => setTt(v as string)}
              options={['INCIDENT', 'REQUEST', 'CHANGE', 'PROBLEM', 'ACCESS', 'OTHER'].map((x) => ({ value: x, label: x }))} />
          </div>
          <div>
            <label className={labelCls}>Priority</label>
            <Select className="w-full" value={prio} onChange={(v) => setPrio(v as string)}
              options={['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((x) => ({ value: x, label: x }))} />
          </div>
        </div>
        <div className="mt-3">
          <label className={labelCls}>Prefill description</label>
          <textarea className={cn(inputCls, 'min-h-20 resize-y')} value={desc} onChange={(e) => setDesc(e.target.value)}
            placeholder="Steps/details the requester should provide…" />
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            disabled={!name.trim() || create.isPending || save.isPending}
            loading={create.isPending || save.isPending}
            onClick={() => (editing ? save.mutate() : create.mutate())}
            variant="primary"
            size="sm"
            leftIcon={!(create.isPending || save.isPending) ? <Save className="h-3.5 w-3.5" /> : undefined}
          >
            {editing ? 'Save changes' : 'Create template'}
          </Button>
          {editing && (
            <Button type="button" onClick={() => { setEditing(null); setName(''); setDesc(''); }}
              variant="secondary" size="sm" className="border-edge text-muted">Cancel</Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {templates.data?.map((t) => (
          <div key={t.id} className={cn('rounded-xl border bg-surface/60 p-3.5', t.active ? 'border-edge' : 'border-edge opacity-60')}>
            <div className="flex flex-wrap items-center gap-2">
              <ClipboardList className="h-4 w-4 text-secondary" />
              <span className="text-sm font-semibold text-primary">{t.name}</span>
              <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-accent">{t.ticket_type}</span>
              <span className="rounded-full bg-elevated px-2 py-0.5 text-[10px] text-muted">{t.priority}</span>
              {!t.active && <span className="text-[10px] text-muted">inactive</span>}
              <div className="ml-auto flex items-center gap-1.5">
                <Button type="button" onClick={() => toggle.mutate(t)}
                  variant="secondary" size="sm" className="border-edge px-2 py-1 text-[11px]">
                  {t.active ? 'Deactivate' : 'Activate'}
                </Button>
                <Button type="button" onClick={() => startEdit(t)}
                  variant="ghost" size="sm" className="border border-edge px-2 py-1 text-accent">
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button type="button" onClick={() => del.mutate(t.id)}
                  variant="ghost" size="sm" className="border border-edge px-2 py-1 text-red-400 hover:bg-red-500/10">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
            {t.description && <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted">{t.description}</p>}
            <p className="mt-1 text-[10px] text-muted">by {t.created_by_name ?? '—'}</p>
          </div>
        ))}
        {templates.data?.length === 0 && (
          <p className="rounded-xl border border-dashed border-edge p-6 text-center text-sm text-muted">No templates yet.</p>
        )}
      </div>
    </div>
  );
}

// ── Phase 2 (#39): Vendor master tab ────────────────────────────────────────

// Empty strings from the form must become null — the backend rejects "" for
// Option<NaiveDate> (422) and stores blank text otherwise.
function normalizeVendor(f: VendorInput): VendorInput {
  return {
    name: f.name,
    contact_name: f.contact_name?.trim() ? f.contact_name.trim() : null,
    contact_email: f.contact_email?.trim() ? f.contact_email.trim() : null,
    contact_phone: f.contact_phone?.trim() ? f.contact_phone.trim() : null,
    support_link: f.support_link?.trim() ? f.support_link.trim() : null,
    amc_expiry: f.amc_expiry || null,
  };
}

function VendorsTab() {
  const qc = useQueryClient();
  const me = getCachedUser();
  const isAdmin = me?.role === 'ADMIN';
  // Small master data — intentionally unpaginated (backend stays array-bodied).
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => listVendors() });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState<VendorInput>({ name: '', contact_name: '', contact_email: '', contact_phone: '', support_link: '', amc_expiry: '' });
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: (v: { id?: string; input: VendorInput }) =>
      v.id ? updateVendor(v.id, normalizeVendor(v.input)) : createVendor(normalizeVendor(v.input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendors'] });
      setOpen(false);
      setEditing(null);
      setForm({ name: '', contact_name: '', contact_email: '', contact_phone: '', support_link: '', amc_expiry: '' });
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteVendor(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  });

  const amcBadge = (v: Vendor) => {
    if (!v.amc_expiry) return null;
    const days = Math.round((new Date(v.amc_expiry).getTime() - Date.now()) / 86400000);
    const cls = days < 0 ? 'bg-red-500/10 text-red-400 border-red-500/30'
      : days <= 60 ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    return <span className={`rounded-md border px-1.5 py-0.5 text-[11px] ${cls}`}>{days < 0 ? `AMC expired ${-days}d ago` : `AMC ${days}d`}</span>;
  };

  const startEdit = (v: Vendor) => {
    setEditing(v);
    setForm({ name: v.name, contact_name: v.contact_name ?? '', contact_email: v.contact_email ?? '', contact_phone: v.contact_phone ?? '', support_link: v.support_link ?? '', amc_expiry: v.amc_expiry ?? '' });
    setError('');
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">Vendor records + AMC dates — asset detail shows the vendor and its claim/repair log</p>
        <Button onClick={() => { setEditing(null); setForm({ name: '', contact_name: '', contact_email: '', contact_phone: '', support_link: '', amc_expiry: '' }); setError(''); setOpen(true); }}
          variant="primary" size="sm" leftIcon={<Plus className="h-4 w-4" />}>
          Add vendor
        </Button>
      </div>

      <div className="space-y-2">
        {vendors.data?.map((v) => (
          <div key={v.id} className="rounded-xl border border-edge bg-surface/60">
            <div className="flex items-center justify-between gap-3 p-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => setExpanded(expanded === v.id ? null : v.id)}>
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{v.name}</span>
                  {amcBadge(v)}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted">
                  {[v.contact_name, v.contact_email, v.contact_phone].filter(Boolean).join(' · ') || 'no contact info'}
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <Button onClick={() => startEdit(v)} variant="ghost" size="icon" className="p-2 text-muted hover:text-accent" title="Edit"><Pencil className="h-4 w-4" /></Button>
                {isAdmin && (
                  <Button onClick={() => { if (confirm(`Delete vendor ${v.name}?`)) remove.mutate(v.id); }} variant="ghost" size="icon" className="p-2 text-muted hover:bg-red-500/10 hover:text-red-400" title="Delete"><Trash2 className="h-4 w-4" /></Button>
                )}
              </div>
            </div>
            {expanded === v.id && <VendorClaims vendorId={v.id} />}
          </div>
        ))}
        {!vendors.isLoading && (vendors.data?.length ?? 0) === 0 && (
          <div className="rounded-xl border border-dashed border-edge2 p-6 text-center text-xs text-muted">No vendors yet — add your first one.</div>
        )}
      </div>

      {open && (
        <Modal title={editing ? 'Edit vendor' : 'Add vendor'} onClose={() => setOpen(false)}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(editing ? { id: editing.id, input: form } : { input: form }); }}>
            <div>
              <label className="mb-1 block text-xs font-medium text-secondary">Name *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-9 w-full rounded-lg border border-edge2 bg-base px-3 text-sm outline-none focus:border-accent" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-secondary">Contact name</label>
                <input value={form.contact_name ?? ''} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className="h-9 w-full rounded-lg border border-edge2 bg-base px-3 text-sm outline-none focus:border-accent" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-secondary">Contact email</label>
                <input type="email" value={form.contact_email ?? ''} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} className="h-9 w-full rounded-lg border border-edge2 bg-base px-3 text-sm outline-none focus:border-accent" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-secondary">Contact phone</label>
                <input value={form.contact_phone ?? ''} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} className="h-9 w-full rounded-lg border border-edge2 bg-base px-3 text-sm outline-none focus:border-accent" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-secondary">Support link</label>
                <input value={form.support_link ?? ''} onChange={(e) => setForm({ ...form, support_link: e.target.value })} className="h-9 w-full rounded-lg border border-edge2 bg-base px-3 text-sm outline-none focus:border-accent" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-secondary">AMC / renewal date</label>
              <input type="date" value={form.amc_expiry ?? ''} onChange={(e) => setForm({ ...form, amc_expiry: e.target.value })} className="h-9 w-full rounded-lg border border-edge2 bg-base px-3 text-sm outline-none focus:border-accent" />
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" onClick={() => setOpen(false)} variant="secondary" size="sm">Cancel</Button>
              <Button type="submit" loading={save.isPending} variant="primary" size="sm">
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function VendorClaims({ vendorId }: { vendorId: string }) {
  const qc = useQueryClient();
  // Per-vendor claims — bounded small list, intentionally unpaginated.
  const claims = useQuery({ queryKey: ['claims', vendorId], queryFn: () => listClaims({ vendor_id: vendorId }) });
  const [adding, setAdding] = useState(false);
  const [issue, setIssue] = useState('');
  const [outcome, setOutcome] = useState('');
  const [replacement, setReplacement] = useState(false);

  const add = useMutation({
    mutationFn: () => createClaim({ vendor_id: vendorId, issue, outcome: outcome || null, replacement }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claims', vendorId] });
      setAdding(false); setIssue(''); setOutcome(''); setReplacement(false);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteClaim(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claims', vendorId] }),
  });

  return (
    <div className="border-t border-edge px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium text-secondary">Claim / repair log</span>
        <Button onClick={() => setAdding(!adding)} variant="text" className="text-[11px]">{adding ? 'Cancel' : '+ Add claim'}</Button>
      </div>
      {adding && (
        <form className="mb-3 space-y-2 rounded-lg border border-edge2 bg-base p-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <textarea required placeholder="Issue / fault (e.g. 'Power port dead — sent for RMA')" value={issue} onChange={(e) => setIssue(e.target.value)} className="w-full rounded-lg border border-edge2 bg-base px-3 py-2 text-sm outline-none focus:border-accent" rows={2} />
          <input placeholder="Outcome (optional — e.g. 'Motherboard replaced')" value={outcome} onChange={(e) => setOutcome(e.target.value)} className="h-9 w-full rounded-lg border border-edge2 bg-base px-3 text-sm outline-none focus:border-accent" />
          <label className="flex items-center gap-2 text-xs text-secondary">
            <input type="checkbox" checked={replacement} onChange={(e) => setReplacement(e.target.checked)} className="accent-indigo-500" /> Replacement unit provided
          </label>
          <Button type="submit" loading={add.isPending} variant="primary" size="sm">{add.isPending ? 'Saving…' : 'Log claim'}</Button>
        </form>
      )}
      <div className="space-y-1.5">
        {claims.data?.map((c) => (
          <div key={c.id} className="flex items-start justify-between gap-3 rounded-lg bg-elevated/50 px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs">{c.issue}</div>
              <div className="mt-0.5 text-[11px] text-muted">
                {[c.asset_tag ?? c.asset_name, c.ticket_number, c.outcome].filter(Boolean).join(' · ') || '—'}
                {c.replacement && ' · replacement'}
              </div>
            </div>
            <Button onClick={() => remove.mutate(c.id)} variant="ghost" size="icon" className="shrink-0 p-1 text-muted hover:text-red-400" title="Delete claim"><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
        {(claims.data?.length ?? 0) === 0 && <p className="text-[11px] text-muted">No claims logged yet.</p>}
      </div>
    </div>
  );
}


// App-native two-step delete (no window.confirm — #77).
function DeleteButton({ onConfirm, label }: { onConfirm: () => void; label: string }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button onClick={() => setConfirming(true)} variant="text" className="ml-3 text-xs text-rose-400">Delete</Button>
    );
  }
  return (
    <span className="ml-3 inline-flex items-center gap-1.5 text-[11px]">
      <span className="text-muted">Delete “{label}”?</span>
      <Button onClick={() => { setConfirming(false); onConfirm(); }} variant="text" className="font-semibold text-rose-400">Yes</Button>
      <Button onClick={() => setConfirming(false)} variant="text">No</Button>
    </span>
  );
}

// ── #40 Locations tab ───────────────────────────────────────────────────────

interface LocationForm {
  site: string;
  building: string;
  floor: string;
  room: string;
}

const EMPTY_LOCATION: LocationForm = { site: '', building: '', floor: '', room: '' };

function fmtLocation(l: { site: string; building: string; floor: string; room: string }): string {
  return [l.site, l.building, l.floor, l.room].filter(Boolean).join(' / ');
}

function LocationsTab() {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LocationWithCount | null>(null);
  const [form, setForm] = useState<LocationForm>(EMPTY_LOCATION);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<LocationWithCount | null>(null);

  const qc = useQueryClient();
  const locations = useQuery({ queryKey: ['locations', search], queryFn: () => listLocations(search || undefined) });
  const detailAssets = useQuery({
    queryKey: ['location-assets', detail?.id],
    queryFn: () => (detail ? listLocationAssets(detail.id) : Promise.resolve([])),
    enabled: !!detail,
  });

  const save = useMutation({
    mutationFn: (v: { id?: string; input: LocationForm }) =>
      v.id ? updateLocation(v.id, v.input) : createLocation(v.input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations'] });
      setOpen(false);
      setEditing(null);
      setForm(EMPTY_LOCATION);
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteLocation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations'] });
      if (detail?.id) setDetail(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const rows = locations.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search site / building / floor / room…"
          className="h-9 min-w-0 flex-1 rounded-lg border border-edge2 bg-base px-3 text-sm outline-none focus:border-accent"
        />
        <Button
          onClick={() => { setEditing(null); setForm(EMPTY_LOCATION); setError(''); setOpen(true); }}
          variant="primary"
          size="sm"
          className="shrink-0"
        >
          + Add location
        </Button>
      </div>

      {error && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">{error}</p>}

      <div className="max-h-[55vh] overflow-x-auto overflow-y-auto rounded-xl border border-edge">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="sticky top-0 z-10 bg-surface px-3 py-2">Location path</th>
              <th className="sticky top-0 z-10 bg-surface px-3 py-2 text-right">Assets</th>
              <th className="sticky top-0 z-10 bg-surface px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge/60">
            {rows.map((l) => (
              <tr key={l.id} className="hover:bg-elevated/40">
                <td className="px-3 py-2">
                  <button className="text-left hover:text-accent" onClick={() => setDetail(l)}>
                    {fmtLocation(l) || '—'}
                  </button>
                </td>
                <td className="px-3 py-2 text-right text-xs text-secondary">{l.asset_count}</td>
                <td className="px-3 py-2 text-right">
                  <Button
                    onClick={() => { setEditing(l); setForm({ site: l.site, building: l.building, floor: l.floor, room: l.room }); setError(''); setOpen(true); }}
                    variant="text"
                    className="text-xs"
                  >
                    Edit
                  </Button>
                  <DeleteButton onConfirm={() => remove.mutate(l.id)} label={fmtLocation(l)} />
                </td>
              </tr>
            ))}
            {!locations.isLoading && rows.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-8 text-center text-xs text-muted">No locations yet — add your first site/building/floor/room.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal title={editing ? 'Edit location' : 'Add location'} onClose={() => setOpen(false)}>
          <div className="space-y-3 p-4">
            {(['site', 'building', 'floor', 'room'] as const).map((k) => (
              <label key={k} className="block">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-secondary">{k}</span>
                <input
                  value={form[k]}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                  placeholder={`e.g. ${k === 'site' ? 'Main Plant' : k === 'building' ? 'Factory A' : k === 'floor' ? 'Floor 2' : 'Server Room'}`}
                  autoFocus={k === 'site'}
                  className="h-9 w-full rounded-lg border border-edge2 bg-base px-3 text-sm outline-none focus:border-accent"
                />
              </label>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={() => setOpen(false)} variant="secondary" size="sm">Cancel</Button>
              <Button
                onClick={() => save.mutate(editing ? { id: editing.id, input: form } : { input: form })}
                disabled={save.isPending || !form.site && !form.building && !form.floor && !form.room}
                loading={save.isPending}
                variant="primary"
                size="sm"
              >
                {editing ? 'Save' : 'Create'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={fmtLocation(detail) || 'Location'} onClose={() => setDetail(null)}>
          <div className="space-y-3 p-4">
            <p className="text-xs text-secondary">{detail.asset_count} asset{detail.asset_count === 1 ? '' : 's'} at this location</p>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {detailAssets.data?.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg bg-elevated/50 px-3 py-2 text-xs">
                  <span className="font-mono">{a.asset_tag}</span>
                  <span className="truncate px-2 text-secondary">{a.name}</span>
                  <span className="text-secondary">{a.status}</span>
                </div>
              ))}
              {detailAssets.isLoading && <p className="text-xs text-muted">Loading…</p>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
