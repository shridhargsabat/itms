import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, History, IndianRupee, LoaderCircle, MapPin, Pencil, User, Wrench, X } from 'lucide-react';
import { assignAsset, createClaim, getAssetLifecycle, getCachedUser, listAssetMoves, listClaims, listLocations, listVendors, updateAsset } from '@/api/client';
import type { Asset, AssetMove, AssetStatus, LifecycleEvent, UpdateAssetInput, VendorClaim } from '@/api/types';
import { AssetStatusBadge } from '@/components/TicketBadge';
import Select from '@/components/Select';
import { formatDateOnly, inputCls, labelCls, pretty } from '@/lib/utils';

interface AssetSpecModalProps {
  asset: Asset | null;
  onClose: () => void;
}

const STATUS_OPTIONS: { value: AssetStatus; label: string }[] = [
  { value: 'IN_STOCK', label: 'In Stock' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'RETIRED', label: 'Retired' },
];

function fmtCost(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Depreciation hint: straight-line 3y from purchase_date (or expected_eol). */
function deprecBasis(asset: Asset): string {
  const base = asset.purchase_date ?? asset.expected_eol;
  if (!base) return 'Add a purchase date to track depreciation';
  return `3-year straight-line from ${formatDateOnly(base)}`;
}

export default function AssetSpecModal({ asset, onClose }: AssetSpecModalProps) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<UpdateAssetInput>({});
  // Admin-only mutations (backend gated since PR #96) — hide the controls for other roles.
  const isAdmin = getCachedUser()?.role === 'ADMIN';

  const assign = useMutation({
    mutationFn: ({ id, uid }: { id: string; uid: string | null }) => assignAsset(id, uid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['metrics'] });
      qc.invalidateQueries({ queryKey: ['alerts'] });
      setUserId('');
    },
  });

  const save = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAssetInput }) => updateAsset(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['metrics'] });
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['lifecycle'] });
      setEditing(false);
      setForm({});
    },
  });

  const lifecycle = useQuery({
    queryKey: ['lifecycle', asset?.id],
    queryFn: () => getAssetLifecycle(asset!.id),
    enabled: !!asset,
  });

  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => listVendors() });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => listLocations() });
  const moves = useQuery({
    queryKey: ['asset-moves', asset?.id],
    queryFn: () => (asset ? listAssetMoves(asset.id) : Promise.resolve([])),
    enabled: !!asset,
  });
  const claims = useQuery({
    queryKey: ['claims', 'asset', asset?.id],
    queryFn: () => listClaims({ asset_id: asset!.id }),
    enabled: !!asset,
  });
  const [claimIssue, setClaimIssue] = useState('');
  const [claimVendor, setClaimVendor] = useState('');
  const addClaim = useMutation({
    mutationFn: (input: { vendor_id: string; issue: string }) => createClaim({ vendor_id: input.vendor_id, asset_id: asset?.id ?? null, issue: input.issue, replacement: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claims', 'asset', asset?.id] });
      setClaimIssue('');
    },
  });

  if (!asset) return null;

  const specEntries = Object.entries(asset.specs ?? {});
  const events: LifecycleEvent[] = lifecycle.data ?? [];
  const warrantyDays = asset.warranty_expiry
    ? Math.ceil((new Date(asset.warranty_expiry).getTime() - Date.now()) / 86400000)
    : null;
  const warrantyTone =
    warrantyDays === null ? 'text-muted' : warrantyDays < 0 ? 'text-red-400' : warrantyDays <= 60 ? 'text-amber-400' : 'text-emerald-400';

  const openEdit = () => {
    setForm({
      name: asset.name,
      category: asset.category,
      serial_number: asset.serial_number ?? undefined,
      status: asset.status,
      purchase_date: asset.purchase_date,
      warranty_expiry: asset.warranty_expiry,
      unit_cost: asset.unit_cost ?? undefined,
      expected_eol: asset.expected_eol,
    });
    setEditing(true);
  };

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-slide-in-right absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-edge bg-surface shadow-2xl">
        <div className="flex items-start justify-between border-b border-edge px-5 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-accent">{asset.asset_tag}</span>
              <AssetStatusBadge status={asset.status} />
            </div>
            <h2 className="mt-1 text-lg font-semibold text-primary">{asset.name}</h2>
            <p className="text-xs uppercase tracking-wide text-muted">{asset.category}</p>
          </div>
          <div className="flex items-center gap-1">
            {!editing && isAdmin && (
              <button
                type="button"
                onClick={openEdit}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-elevated"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-secondary transition-colors hover:bg-elevated hover:text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {editing ? (
            <form
              className="space-y-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                save.mutate({ id: asset.id, input: form });
              }}
            >
              <div>
                <label className={labelCls}>Name</label>
                <input
                  className={inputCls}
                  value={form.name ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Category</label>
                  <input
                    className={inputCls}
                    value={form.category ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value.toUpperCase() }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>Serial Number</label>
                  <input
                    className={inputCls}
                    value={form.serial_number ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, serial_number: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Status (lifecycle)</label>
                <Select
                  value={form.status ?? asset.status}
                  onChange={(v) => setForm((f) => ({ ...f, status: v }))}
                  options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                />
                <p className="mt-1 text-[10px] text-muted">
                  Allowed: In Stock ↔ Assigned · → Maintenance · → Retired; Maintenance ↔ In Stock/Assigned; Retired → In Stock
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Purchase Date</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.purchase_date ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, purchase_date: e.target.value || null }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>Warranty Expiry</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.warranty_expiry ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, warranty_expiry: e.target.value || null }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>Unit Cost (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={inputCls}
                    value={form.unit_cost ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, unit_cost: e.target.value === '' ? null : Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>Expected EOL</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.expected_eol ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, expected_eol: e.target.value || null }))}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Vendor</label>
                <Select
                  value={form.vendor_id ?? asset.vendor_id ?? ''}
                  onChange={(v) => setForm((f) => ({ ...f, vendor_id: v || null }))}
                  options={[
                    { value: '', label: '— none —' },
                    ...(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name })),
                  ]}
                />
              </div>
              <div>
                <label className={labelCls}>Location</label>
                <Select
                  value={form.location_id ?? asset.location_id ?? ''}
                  onChange={(v) => setForm((f) => ({ ...f, location_id: v || null }))}
                  options={[
                    { value: '', label: '— unplaced —' },
                    ...(locations.data ?? []).map((l) => ({
                      value: l.id,
                      label: [l.site, l.building, l.floor, l.room].filter(Boolean).join(' / ') || l.id.slice(0, 8),
                    })),
                  ]}
                />
              </div>
              {save.isError && (
                <p className="text-xs text-red-400">
                  {save.error instanceof Error ? save.error.message : 'Update failed.'}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={save.isPending}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-opacity disabled:opacity-50"
                >
                  {save.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : 'Save changes'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setForm({});
                  }}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-edge px-4 text-sm text-secondary transition-colors hover:bg-elevated"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-edge bg-base p-3">
                  <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted">
                    <User className="h-3 w-3" /> Assigned To
                  </p>
                  <p className="mt-1 truncate text-primary">{asset.assigned_user_name ?? '—'}</p>
                </div>
                <div className="rounded-lg border border-edge bg-base p-3">
                  <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted">
                    <MapPin className="h-3 w-3" /> Location
                  </p>
                  <p className="mt-1 truncate text-primary">{asset.location_name ?? '—'}</p>
                </div>
                <div className="rounded-lg border border-edge bg-base p-3">
                  <p className="text-xs uppercase tracking-wide text-muted">Serial Number</p>
                  <p className="mt-1 truncate font-mono text-xs text-primary">{asset.serial_number ?? '—'}</p>
                </div>
                <div className="rounded-lg border border-edge bg-base p-3">
                  <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted">
                    <CalendarDays className="h-3 w-3" /> Purchased
                  </p>
                  <p className="mt-1 text-primary">{formatDateOnly(asset.purchase_date)}</p>
                </div>
                <div className="rounded-lg border border-edge bg-base p-3">
                  <p className="text-xs uppercase tracking-wide text-muted">Warranty Expiry</p>
                  <p className={`mt-1 ${warrantyTone}`}>
                    {formatDateOnly(asset.warranty_expiry)}
                    {warrantyDays !== null && (
                      <span className="ml-1 text-[10px]">
                        {warrantyDays < 0 ? `(${-warrantyDays}d expired)` : `(${warrantyDays}d left)`}
                      </span>
                    )}
                  </p>
                </div>
                <div className="rounded-lg border border-edge bg-base p-3">
                  <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted">
                    <IndianRupee className="h-3 w-3" /> Unit Cost
                  </p>
                  <p className="mt-1 text-primary">{fmtCost(asset.unit_cost)}</p>
                </div>
                <div className="rounded-lg border border-edge bg-base p-3">
                  <p className="text-xs uppercase tracking-wide text-muted">Current Value</p>
                  <p className="mt-1 text-primary">{fmtCost(asset.current_value)}</p>
                  <p className="mt-0.5 text-[10px] text-muted">{deprecBasis(asset)}</p>
                </div>
                <div className="col-span-2 rounded-lg border border-edge bg-base p-3">
                  <p className="text-xs uppercase tracking-wide text-muted">Expected EOL</p>
                  <p className="mt-1 text-primary">{formatDateOnly(asset.expected_eol) || '—'}</p>
                </div>
              </div>

              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-secondary">
                  <History className="h-3.5 w-3.5" /> Move History
                </h3>
                {moves.data && moves.data.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-edge p-3 text-center text-xs text-muted">
                    No moves recorded yet — change the location above to log one.
                  </p>
                ) : (
                  <div className="max-h-44 divide-y divide-edge/60 overflow-y-auto rounded-lg border border-edge bg-base">
                    {(moves.data ?? []).map((m: AssetMove) => (
                      <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                        <div className="min-w-0">
                          <p className="truncate text-primary">
                            <span className="text-muted">{m.from_location_name ?? '—'}</span>
                            <ArrowRight className="mx-1 inline h-3 w-3 text-muted" />
                            <span>{m.to_location_name ?? '—'}</span>
                          </p>
                          <p className="truncate text-[10px] text-muted">
                            {m.note}{m.actor_name ? ` · ${m.actor_name}` : ''}
                          </p>
                        </div>
                        <span className="shrink-0 text-[10px] text-muted">{formatDateOnly(m.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">
                  Specifications
                </h3>
                {specEntries.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-edge p-4 text-center text-xs text-muted">
                    No specifications recorded.
                  </p>
                ) : (
                  <div className="divide-y divide-edge/60 rounded-lg border border-edge bg-base">
                    {specEntries.map(([k, v]) => (
                      <div key={k} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                        <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted">{k}</span>
                        <span className="break-all text-right text-primary">{pretty(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-secondary">
                  <Wrench className="h-3.5 w-3.5" /> Vendor Claims
                </h3>
                {isAdmin && (
                  <div className="mb-2 flex gap-2">
                    <Select
                      value={claimVendor || asset.vendor_id || ''}
                      onChange={setClaimVendor}
                      options={[{ value: '', label: '— choose vendor —' }, ...(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))]}
                    />
                    <input
                      placeholder="Issue (e.g. 'RMA — power port dead')"
                      value={claimIssue}
                      onChange={(e) => setClaimIssue(e.target.value)}
                      className="h-9 min-w-0 flex-1 rounded-lg border border-edge2 bg-base px-3 text-sm outline-none focus:border-accent"
                    />
                    <button
                      onClick={() => claimVendor && claimIssue.trim() && addClaim.mutate({ vendor_id: claimVendor, issue: claimIssue.trim() })}
                      disabled={addClaim.isPending || !claimVendor || !claimIssue.trim()}
                      className="h-9 shrink-0 rounded-lg bg-accent px-3 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
                    >
                      Log
                    </button>
                  </div>
                )}
                {(claims.data?.length ?? 0) === 0 ? (
                  <p className="rounded-lg border border-dashed border-edge p-4 text-center text-xs text-muted">No claims logged for this asset.</p>
                ) : (
                  <div className="divide-y divide-edge/60 rounded-lg border border-edge bg-base">
                    {claims.data?.map((c: VendorClaim) => (
                      <div key={c.id} className="px-3 py-2 text-sm">
                        <p>{c.issue}</p>
                        <p className="mt-0.5 text-[11px] text-muted">
                          {[c.vendor_name, c.ticket_number, c.outcome].filter(Boolean).join(' · ') || '—'}
                          {c.replacement ? ' · replacement' : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-secondary">
                  <History className="h-3.5 w-3.5" /> Lifecycle History
                </h3>
                {events.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-edge p-4 text-center text-xs text-muted">
                    No lifecycle transitions recorded yet.
                  </p>
                ) : (
                  <div className="divide-y divide-edge/60 rounded-lg border border-edge bg-base">
                    {events.map((ev) => (
                      <div key={ev.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="flex items-center gap-1.5">
                          {ev.from_status ? <AssetStatusBadge status={ev.from_status} /> : <span className="text-xs text-muted">—</span>}
                          <span className="text-muted">→</span>
                          <AssetStatusBadge status={ev.to_status} />
                        </span>
                        <span className="shrink-0 text-[10px] text-muted">
                          {formatDateOnly(ev.created_at)}
                          {ev.note ? ` · ${ev.note}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {!editing && isAdmin && (
          <div className="border-t border-edge px-5 py-4">
            <p className={labelCls}>Assign / Unassign</p>
            <form
              className="flex gap-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                assign.mutate({ id: asset.id, uid: userId.trim() || null });
              }}
            >
              <input
                className={inputCls}
                placeholder="User ID (empty to unassign)"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              />
              <button
                type="submit"
                disabled={assign.isPending}
                className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 ledgerly:bg-accent ledgerly:hover:bg-accent-strong disabled:opacity-60"
              >
                {assign.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : asset.assigned_to_user_id ? 'Reassign' : 'Assign'}
              </button>
            </form>
            {asset.assigned_to_user_id && (
              <button
                type="button"
                onClick={() => assign.mutate({ id: asset.id, uid: null })}
                disabled={assign.isPending}
                className="mt-2 text-xs text-muted underline-offset-2 hover:text-red-400 hover:underline"
              >
                Unassign current user
              </button>
            )}
            {assign.isError && (
              <p className="mt-2 text-xs text-red-400">
                {assign.error instanceof Error ? assign.error.message : 'Assignment failed.'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
