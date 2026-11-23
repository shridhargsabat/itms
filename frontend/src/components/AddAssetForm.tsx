import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, FileUp } from 'lucide-react';
import { createAsset, listVendors, listLocations } from '@/api/client';
import { ASSET_CATEGORIES, ASSET_STATUSES } from '@/api/types';
import type { CreateAssetInput } from '@/api/types';
import { cn, inputCls, labelCls } from '@/lib/utils';
import { Button } from '@/components/Button';
import Select from '@/components/Select';
import InvoiceAssetUpload from '@/components/InvoiceAssetUpload';

/**
 * Shared Add-Asset form used by BOTH the Dashboard and Assets page (via
 * AddAssetButton). Merged superset of the two prior divergent forms:
 *  - Dashboard: Asset Tag, dynamic Specifications rows, manual|invoice mode
 *  - Assets:    Location + Vendor selects
 * Single source of truth — a user sees the identical dialog + behavior
 * regardless of which page they add the asset from.
 */
export default function AddAssetForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  // manual (default) keeps the original form byte-for-byte; invoice
  // swaps in the PDF line-item upload flow.
  const [mode, setMode] = useState<'manual' | 'invoice'>('manual');
  const [form, setForm] = useState<CreateAssetInput>({
    name: '',
    asset_tag: '',
    serial_number: '',
    category: 'LAPTOP',
    status: 'IN_STOCK',
  });
  const [specRows, setSpecRows] = useState<Array<[string, string]>>([]);
  const [purchaseDate, setPurchaseDate] = useState('');
  const [warrantyExpiry, setWarrantyExpiry] = useState('');
  const [locationId, setLocationId] = useState('');
  const [vendorId, setVendorId] = useState('');

  const locationsQ = useQuery({ queryKey: ['locations'], queryFn: () => listLocations() });
  const vendorsQ = useQuery({ queryKey: ['vendors'], queryFn: () => listVendors() });

  const mutation = useMutation({
    mutationFn: () => {
      const specs: Record<string, string> = {};
      for (const [k, v] of specRows) {
        const key = k.trim();
        if (key) specs[key] = v.trim();
      }
      return createAsset({
        ...form,
        purchase_date: purchaseDate || undefined,
        warranty_expiry: warrantyExpiry || undefined,
        specs: Object.keys(specs).length ? specs : undefined,
        location_id: locationId || null,
        vendor_id: vendorId || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['metrics'] });
      qc.invalidateQueries({ queryKey: ['cmdb'] });
      onDone();
    },
  });
  const set = <K extends keyof CreateAssetInput>(k: K, v: CreateAssetInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      {/* segmented mode toggle — the manual form below stays exactly
          as it was whenever 'manual' mode is active. */}
      <div className="grid grid-cols-2 gap-1 rounded-lg glass-dense p-1">
        <button
          type="button"
          onClick={() => setMode('manual')}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            mode === 'manual'
              ? 'bg-accent text-on-accent'
              : 'text-secondary hover:text-primary',
          )}
        >
          Fill manually
        </button>
        <button
          type="button"
          onClick={() => setMode('invoice')}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            mode === 'invoice'
              ? 'bg-accent text-on-accent'
              : 'text-secondary hover:text-primary',
          )}
        >
          <FileUp className="h-3.5 w-3.5" />
          Upload invoice
        </button>
      </div>

      {mode === 'invoice' ? (
        <InvoiceAssetUpload onDone={onDone} onSwitchManual={() => setMode('manual')} />
      ) : (
      <form
      className="space-y-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="asset-name">Name *</label>
          <input
            id="asset-name"
            required
            className={inputCls}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Dell XPS 15"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="asset-tag">Asset Tag</label>
          <input
            id="asset-tag"
            className={inputCls}
            value={form.asset_tag ?? ''}
            onChange={(e) => set('asset_tag', e.target.value)}
            placeholder="e.g. IT-0001"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="asset-serial">Serial Number</label>
          <input
            id="asset-serial"
            className={inputCls}
            value={form.serial_number ?? ''}
            onChange={(e) => set('serial_number', e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div>
          <label className={labelCls}>Category</label>
          <Select
            className="w-full"
            value={form.category}
            onChange={(v) => set('category', v as CreateAssetInput['category'])}
            options={ASSET_CATEGORIES.map((c) => ({ value: c, label: c.replace('_', ' ') }))}
          />
        </div>
      </div>
      <div>
        <label className={labelCls}>Status</label>
        <Select
          className="w-full"
          value={form.status ?? ''}
          onChange={(v) => set('status', v as CreateAssetInput['status'])}
          options={ASSET_STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') }))}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="asset-purchase-date">Purchase Date</label>
          <input
            id="asset-purchase-date"
            type="date"
            className={inputCls}
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="asset-warranty-expiry">Warranty Expiry</label>
          <input
            id="asset-warranty-expiry"
            type="date"
            className={inputCls}
            value={warrantyExpiry}
            onChange={(e) => setWarrantyExpiry(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Location</label>
          <Select
            className="w-full"
            value={locationId}
            onChange={setLocationId}
            options={[
              { value: '', label: '— unplaced —' },
              ...(locationsQ.data ?? []).map((l) => ({
                value: l.id,
                label: [l.site, l.building, l.floor, l.room].filter(Boolean).join(' / ') || l.id.slice(0, 8),
              })),
            ]}
          />
        </div>
        <div>
          <label className={labelCls}>Vendor</label>
          <Select
            className="w-full"
            value={vendorId}
            onChange={setVendorId}
            options={[
              { value: '', label: '— none —' },
              ...(vendorsQ.data ?? []).map((v) => ({ value: v.id, label: v.name })),
            ]}
          />
        </div>
      </div>
      <div>
        <label className={labelCls}>Specifications</label>
        <div className="space-y-2">
          {specRows.map(([k, v], i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={cn(inputCls, 'w-2/5')}
                placeholder="Key (e.g. processor)"
                value={k}
                onChange={(e) =>
                  setSpecRows((rows) => rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))
                }
              />
              <input
                className={cn(inputCls, 'flex-1')}
                placeholder="Value (e.g. Intel i7-13700H)"
                value={v}
                onChange={(e) =>
                  setSpecRows((rows) => rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))
                }
              />
              <Button
                type="button"
                aria-label={`Remove spec ${k || i + 1}`}
                onClick={() => setSpecRows((rows) => rows.filter((_, j) => j !== i))}
                variant="ghost"
                className="shrink-0 border border-edge p-2 hover:text-red-400"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            onClick={() => setSpecRows((rows) => [...rows, ['', '']])}
            variant="secondary"
            size="sm"
            className="border-dashed"
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Add specification
          </Button>
        </div>
      </div>
      {mutation.isError && (
        <p className="text-xs text-red-400">
          {mutation.error instanceof Error ? mutation.error.message : 'Failed to create asset.'}
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
          Add Asset
        </Button>
      </div>
    </form>
      )}
    </div>
  );
}
