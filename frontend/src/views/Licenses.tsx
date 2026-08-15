import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  Infinity as InfinityIcon,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { cn, inputCls, labelCls } from '@/lib/utils';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { getCachedUser, listUsers } from '@/api/client';
import {
  assignSeat,
  createLicense,
  deleteLicense,
  getLicenseAlerts,
  getLicenseDetail,
  getLicenses,
  revokeSeat,
  updateLicense,
} from '@/api/client';
import type { License, LicenseType } from '@/api/types';

const TYPE_STYLE: Record<LicenseType, string> = {
  SUBSCRIPTION: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  PERPETUAL: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  OPEN_SOURCE: 'bg-elevated/10 text-secondary border-edge2/30',
};

const fmtMoney = (n: number | null | undefined, cur: string) =>
  n == null ? '—' : `${cur} ${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

function daysLeft(d: string | null): number | null {
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(d + 'T00:00:00');
  return Math.round((exp.getTime() - today.getTime()) / 86400000);
}

type Tab = 'all' | 'expiring' | 'expired';

export default function Licenses() {
  const me = getCachedUser();
  const isAdmin = me?.role === 'ADMIN';
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'all';
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<License | null>(null); // detail modal
  const [editing, setEditing] = useState<License | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const qc = useQueryClient();

  const all = useQuery({ queryKey: ['licenses', 'all'], queryFn: () => getLicenses({ limit: 500 }) });
  const alerts = useQuery({ queryKey: ['licenses', 'alerts'], queryFn: () => getLicenseAlerts() });

  const setTab = (t: Tab) => {
    const p = new URLSearchParams(params);
    p.set('tab', t);
    setParams(p, { replace: true });
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['licenses'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const del = useMutation({
    mutationFn: (id: string) => deleteLicense(id),
    onSuccess: refresh,
  });

  // utilization summary
  const totalSeats = useMemo(() => all.data?.reduce((a, l) => a + l.seats_total, 0) ?? 0, [all.data]);
  const usedSeats = useMemo(() => all.data?.reduce((a, l) => a + l.seats_used, 0) ?? 0, [all.data]);
  const utilPct = totalSeats > 0 ? Math.round((usedSeats / totalSeats) * 100) : 0;
  // wasted cost: (seats_total - seats_used) * cost_per_seat for paid subs
  const wasted = useMemo(
    () =>
      (all.data ?? []).reduce(
        (a, l) => a + (l.cost_per_seat ? (l.seats_total - l.seats_used) * l.cost_per_seat : 0),
        0,
      ),
    [all.data],
  );

  const list =
    tab === 'expiring'
      ? (alerts.data?.expiring_90 ?? [])
      : tab === 'expired'
        ? (alerts.data?.expired ?? [])
        : (all.data ?? []);
  const alertCount = (alerts.data?.expired.length ?? 0) + (alerts.data?.expiring_90.length ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Software Licenses</h1>
          <p className="text-xs text-secondary">Seat register — track what you pay for vs what you use.</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Register License
          </button>
        )}
      </div>

      {/* utilization summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-edge bg-surface p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted">Utilization</p>
          <p className={cn('mt-1 text-lg font-bold', utilPct < 70 ? 'text-red-400' : utilPct < 90 ? 'text-amber-400' : 'text-emerald-400')}>
            {utilPct}%
          </p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-elevated">
            <div
              className={cn('h-full rounded-full', utilPct < 70 ? 'bg-red-400' : utilPct < 90 ? 'bg-amber-400' : 'bg-emerald-400')}
              style={{ width: `${Math.min(utilPct, 100)}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-muted">{usedSeats}/{totalSeats} seats in use</p>
        </div>
        <div className="rounded-xl border border-edge bg-surface p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted">Wasted spend / yr</p>
          <p className="mt-1 text-lg font-bold text-amber-400">{fmtMoney(wasted, 'INR')}</p>
          <p className="mt-1 text-[10px] text-muted">unused seats × cost</p>
        </div>
        <button onClick={() => setTab('expiring')} className="rounded-xl border border-edge bg-surface p-3 text-left transition hover:border-accent/40">
          <p className="text-[10px] uppercase tracking-wide text-muted">Expiry alerts</p>
          <p className={cn('mt-1 text-lg font-bold', alertCount > 0 ? 'text-red-400' : 'text-emerald-400')}>{alertCount}</p>
          <p className="mt-1 text-[10px] text-muted">expired + ≤90 days</p>
        </button>
      </div>

      {/* tabs */}
      <div className="flex gap-1 rounded-xl border border-edge bg-surface p-1">
        {(
          [
            { id: 'all', label: 'All Licenses' },
            { id: 'expiring', label: `Expiring ≤90d (${(alerts.data?.expiring_90.length ?? 0) + (alerts.data?.expiring_60.length ?? 0) + (alerts.data?.expiring_30.length ?? 0)})` },
            { id: 'expired', label: `Expired (${alerts.data?.expired.length ?? 0})` },
          ] as { id: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition',
              tab === t.id ? 'bg-accent text-white' : 'text-secondary hover:text-primary',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* list */}
      <div className="flex flex-col gap-3">
        {all.isLoading && (
          <div className="flex justify-center py-10">
            <LoaderCircle className="h-6 w-6 animate-spin text-muted" />
          </div>
        )}
        {!all.isLoading && list.length === 0 && (
          <div className="rounded-xl border border-dashed border-edge p-10 text-center text-sm text-secondary">
            {tab === 'expired' ? 'No expired licenses. 🎉' : tab === 'expiring' ? 'Nothing expiring in the next 90 days. 🎉' : 'No licenses registered yet.'}
          </div>
        )}
        {list.map((l) => (
          <LicenseCard
            key={l.id}
            l={l}
            isAdmin={isAdmin}
            onOpen={() => setSelected(l)}
            onEdit={(e) => { setSelected(null); setEditing(e); }}
            onDelete={() => del.mutate(l.id)}
            confirmDel={confirmDel === l.id}
            setConfirmDel={(v) => setConfirmDel(v ? l.id : null)}
          />
        ))}
      </div>

      {/* detail modal */}
      {selected && (
        <LicenseDetailModal
          license={selected}
          isAdmin={isAdmin}
          onClose={() => setSelected(null)}
          onChanged={refresh}
        />
      )}
      {(creating || editing) && (
        <LicenseFormModal
          license={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function LicenseCard({
  l,
  isAdmin,
  onOpen,
  onEdit,
  onDelete,
  confirmDel,
  setConfirmDel,
}: {
  l: License;
  isAdmin: boolean;
  onOpen: () => void;
  onEdit: (l: License) => void;
  onDelete: () => void;
  confirmDel: boolean;
  setConfirmDel: (v: boolean) => void;
}) {
  const dl = daysLeft(l.expiry_date);
  const util = l.seats_total > 0 ? Math.min(100, Math.round((l.seats_used / l.seats_total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={onOpen} className="flex flex-wrap items-center gap-2 text-left">
          <span className="text-sm font-medium">{l.name}</span>
          {l.vendor && <span className="text-[11px] text-muted">{l.vendor}</span>}
          <span className={cn('rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', TYPE_STYLE[l.license_type])}>
            {l.license_type === 'OPEN_SOURCE' ? 'Open source' : l.license_type === 'PERPETUAL' ? 'Perpetual' : 'Subscription'}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {l.expiry_date && dl != null && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold',
                dl < 0 ? 'border-red-500/40 bg-red-500/10 text-red-400' : dl <= 30 ? 'border-red-500/30 bg-red-500/10 text-red-400' : dl <= 60 ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : dl <= 90 ? 'border-amber-500/20 bg-amber-500/5 text-amber-300' : 'border-edge2 bg-elevated text-secondary',
              )}
            >
              <CalendarClock className="h-3 w-3" />
              {dl < 0 ? `${-dl}d expired` : dl === 0 ? 'expires today' : `${dl}d left`}
            </span>
          )}
          {isAdmin && (
            <>
              <button onClick={() => onEdit(l)} className="rounded-lg border border-edge p-1.5 text-secondary hover:bg-elevated" title="Edit">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              {confirmDel ? (
                <>
                  <button onClick={onDelete} className="rounded-lg bg-red-500 px-2 py-1.5 text-[11px] font-semibold text-white">Confirm</button>
                  <button onClick={() => setConfirmDel(false)} className="rounded-lg border border-edge px-2 py-1.5 text-[11px] text-secondary">No</button>
                </>
              ) : (
                <button onClick={() => setConfirmDel(true)} className="rounded-lg border border-edge p-1.5 text-red-400 hover:bg-red-500/10" title="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-elevated">
          <div
            className={cn('h-full rounded-full', util < 50 ? 'bg-red-400' : util < 80 ? 'bg-amber-400' : 'bg-emerald-400')}
            style={{ width: `${util}%` }}
          />
        </div>
        <span className="w-20 text-right text-[10px] text-muted">
          {l.seats_used}/{l.seats_total} seats · {util}%
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted">
        <span>{fmtMoney(l.cost_per_seat, l.currency)}/seat</span>
        <span>{fmtMoney(l.cost_total, l.currency)} total</span>
        {l.cost_per_seat && l.seats_total > l.seats_used && (
          <span className="font-medium text-amber-400">
            ~{fmtMoney((l.seats_total - l.seats_used) * l.cost_per_seat, l.currency)} unused/yr
          </span>
        )}
        {l.license_type === 'OPEN_SOURCE' && (
          <span className="inline-flex items-center gap-1"><InfinityIcon className="h-3 w-3" /> unlimited</span>
        )}
      </div>
    </div>
  );
}

function LicenseDetailModal({
  license: lic,
  isAdmin,
  onClose,
  onChanged,
}: {
  license: License;
  isAdmin: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const detail = useQuery({ queryKey: ['license', lic.id], queryFn: () => getLicenseDetail(lic.id) });
  const users = useQuery({ queryKey: ['users'], queryFn: () => listUsers({ limit: 500 }) });
  const qc = useQueryClient();
  const [assigning, setAssigning] = useState(false);
  const [pickUser, setPickUser] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const assign = useMutation({
    mutationFn: (userId: string) => assignSeat(lic.id, userId),
    onSuccess: () => {
      setPickUser('');
      setAssigning(false);
      qc.invalidateQueries({ queryKey: ['license', lic.id] });
      onChanged();
    },
  });
  const revoke = useMutation({
    mutationFn: (userId: string) => revokeSeat(lic.id, userId),
    onSuccess: () => {
      setConfirmRevoke(null);
      qc.invalidateQueries({ queryKey: ['license', lic.id] });
      onChanged();
    },
  });

  const allocations = detail.data?.allocations ?? [];
  const userList = Array.isArray(users.data) ? users.data : (users.data?.items ?? []);
  const available = allocations.length < lic.seats_total;
  const assignableUsers = userList.filter(
    (u) => !allocations.some((a) => a.user_id === u.id),
  );
  const dl = daysLeft(lic.expiry_date);

  return (
    <Modal onClose={onClose} title={lic.name}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-elevated/50 p-2.5">
            <p className="text-[10px] uppercase text-muted">Vendor</p>
            <p className="mt-0.5 font-medium">{lic.vendor ?? '—'}</p>
          </div>
          <div className="rounded-lg bg-elevated/50 p-2.5">
            <p className="text-[10px] uppercase text-muted">Type</p>
            <p className="mt-0.5 font-medium">{lic.license_type.replace('_', ' ')}</p>
          </div>
          <div className="rounded-lg bg-elevated/50 p-2.5">
            <p className="text-[10px] uppercase text-muted">Seats</p>
            <p className="mt-0.5 font-medium">
              {lic.seats_used}/{lic.seats_total} used
            </p>
          </div>
          <div className="rounded-lg bg-elevated/50 p-2.5">
            <p className="text-[10px] uppercase text-muted">Cost</p>
            <p className="mt-0.5 font-medium">
              {fmtMoney(lic.cost_per_seat, lic.currency)}
              {lic.cost_per_seat ? '/seat' : ''}
            </p>
          </div>
          {lic.expiry_date && (
            <div className={cn('rounded-lg p-2.5', dl != null && dl <= 30 ? 'bg-red-500/10' : 'bg-elevated/50')}>
              <p className="text-[10px] uppercase text-muted">Expires</p>
              <p className={cn('mt-0.5 font-medium', dl != null && dl <= 30 && 'text-red-400')}>
                {lic.expiry_date} {dl != null && `(${dl < 0 ? `${-dl}d ago` : `${dl}d left`})`}
              </p>
            </div>
          )}
          {lic.renewal_cost != null && (
            <div className="rounded-lg bg-elevated/50 p-2.5">
              <p className="text-[10px] uppercase text-muted">Renewal cost</p>
              <p className="mt-0.5 font-medium">{fmtMoney(lic.renewal_cost, lic.currency)}</p>
            </div>
          )}
        </div>
        {lic.notes && <p className="rounded-lg border border-edge bg-elevated/30 p-2.5 text-xs text-secondary">{lic.notes}</p>}

        {/* allocations */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Assigned seats</p>
            {isAdmin && available && (
              <button
                onClick={() => setAssigning((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white"
              >
                <UserPlus className="h-3.5 w-3.5" /> Assign seat
              </button>
            )}
          </div>
          {assigning && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 p-2">
              <Select
                value={pickUser}
                onChange={setPickUser}
                options={assignableUsers.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
                placeholder="Choose a user…"
              />
              <button
                onClick={() => pickUser && assign.mutate(pickUser)}
                disabled={!pickUser || assign.isPending}
                className="shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
              >
                {assign.isPending ? 'Assigning…' : 'Assign'}
              </button>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {allocations.length === 0 && (
              <p className="text-xs text-muted">No seats assigned yet.</p>
            )}
            {allocations.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-edge bg-elevated/30 px-3 py-2">
                <div>
                  <p className="text-xs font-medium">{a.user_name}</p>
                  <p className="text-[10px] text-muted">{a.user_email}</p>
                </div>
                {isAdmin && (confirmRevoke === a.user_id ? (
                  <div className="flex gap-1.5">
                    <button onClick={() => revoke.mutate(a.user_id)} className="rounded-lg bg-red-500 px-2 py-1 text-[10px] font-semibold text-white">Confirm</button>
                    <button onClick={() => setConfirmRevoke(null)} className="rounded-lg border border-edge px-2 py-1 text-[10px] text-secondary">No</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmRevoke(a.user_id)} className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 px-2 py-1 text-[10px] text-red-400 hover:bg-red-500/10">
                    <UserMinus className="h-3 w-3" /> Revoke
                  </button>
                ))}
              </div>
            ))}
          </div>
          {!available && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-amber-400">
              <AlertTriangle className="h-3 w-3" /> All {lic.seats_total} seats are assigned — reduce elsewhere or buy more.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function LicenseFormModal({ license, onClose, onSaved }: { license: License | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(license?.name ?? '');
  const [vendor, setVendor] = useState(license?.vendor ?? '');
  const [type, setType] = useState<LicenseType>(license?.license_type ?? 'SUBSCRIPTION');
  const [seats, setSeats] = useState(String(license?.seats_total ?? 1));
  const [costPerSeat, setCostPerSeat] = useState(license?.cost_per_seat != null ? String(license.cost_per_seat) : '');
  const [costTotal, setCostTotal] = useState(license?.cost_total != null ? String(license.cost_total) : '');
  const [currency, setCurrency] = useState(license?.currency ?? 'INR');
  const [expiry, setExpiry] = useState(license?.expiry_date ?? '');
  const [renewal, setRenewal] = useState(license?.renewal_cost != null ? String(license.renewal_cost) : '');
  const [notes, setNotes] = useState(license?.notes ?? '');
  const [err, setErr] = useState('');
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        vendor: vendor.trim() || null,
        license_type: type,
        seats_total: Number(seats),
        cost_per_seat: costPerSeat ? Number(costPerSeat) : null,
        cost_total: costTotal ? Number(costTotal) : null,
        currency: currency.trim() || 'INR',
        expiry_date: expiry || null,
        renewal_cost: renewal ? Number(renewal) : null,
        notes: notes.trim() || null,
      };
      return license ? updateLicense(license.id, payload) : createLicense(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['licenses'] });
      onSaved();
      onClose();
    },
    onError: (e) => setErr((e as Error).message || 'Failed to save'),
  });

  return (
    <Modal onClose={onClose} title={license ? 'Edit License' : 'Register License'}>
      <div className="flex flex-col gap-3.5">
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Software name *</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Microsoft 365 Business" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Vendor</span>
            <input className={inputCls} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Microsoft" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Type</span>
            <Select
              value={type}
              onChange={(v) => setType(v as LicenseType)}
              options={['SUBSCRIPTION', 'PERPETUAL', 'OPEN_SOURCE'].map((t) => ({ value: t, label: t === 'OPEN_SOURCE' ? 'Open source' : t === 'PERPETUAL' ? 'Perpetual' : 'Subscription' }))}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Seats purchased *</span>
            <input className={inputCls} type="number" min={0} value={seats} onChange={(e) => setSeats(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Currency</span>
            <input className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Cost / seat / yr</span>
            <input className={inputCls} type="number" min={0} value={costPerSeat} onChange={(e) => setCostPerSeat(e.target.value)} placeholder="6120" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Total cost / yr</span>
            <input className={inputCls} type="number" min={0} value={costTotal} onChange={(e) => setCostTotal(e.target.value)} placeholder="153000" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Expiry date</span>
            <input className={inputCls} type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Renewal cost</span>
            <input className={inputCls} type="number" min={0} value={renewal} onChange={(e) => setRenewal(e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Notes</span>
          <textarea className={cn(inputCls, 'min-h-[64px]')} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-edge px-4 py-2 text-sm font-medium text-secondary hover:bg-elevated">Cancel</button>
          <button
            onClick={() => save.mutate()}
            disabled={!name.trim() || !seats || save.isPending}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : license ? 'Save changes' : 'Register'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
