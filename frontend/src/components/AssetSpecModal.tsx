import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, LoaderCircle, User, X } from 'lucide-react';
import { assignAsset } from '@/api/client';
import type { Asset } from '@/api/types';
import { AssetStatusBadge } from '@/components/TicketBadge';
import { formatDateOnly, inputCls, labelCls, pretty } from '@/lib/utils';

interface AssetSpecModalProps {
  asset: Asset | null;
  onClose: () => void;
}

export default function AssetSpecModal({ asset, onClose }: AssetSpecModalProps) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState('');

  const assign = useMutation({
    mutationFn: ({ id, uid }: { id: string; uid: string | null }) => assignAsset(id, uid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['metrics'] });
      setUserId('');
    },
  });

  if (!asset) return null;

  const specEntries = Object.entries(asset.specs ?? {});

  return (
    <div className="fixed inset-0 z-50">
      <div className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-slide-in-right absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-indigo-400">{asset.asset_tag}</span>
              <AssetStatusBadge status={asset.status} />
            </div>
            <h2 className="mt-1 text-lg font-semibold text-slate-100">{asset.name}</h2>
            <p className="text-xs uppercase tracking-wide text-slate-500">{asset.category}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500">
                <User className="h-3 w-3" /> Assigned To
              </p>
              <p className="mt-1 truncate text-slate-200">
                {asset.assigned_user_name ?? '—'}
                {asset.assigned_to_user_id && (
                  <span className="ml-1 font-mono text-[10px] text-slate-500">
                    ({asset.assigned_to_user_id})
                  </span>
                )}
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Serial Number</p>
              <p className="mt-1 truncate font-mono text-xs text-slate-200">
                {asset.serial_number ?? '—'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500">
                <CalendarDays className="h-3 w-3" /> Purchased
              </p>
              <p className="mt-1 text-slate-200">{formatDateOnly(asset.purchase_date)}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Warranty Expiry</p>
              <p className="mt-1 text-slate-200">{formatDateOnly(asset.warranty_expiry)}</p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Specifications
            </h3>
            {specEntries.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">
                No specifications recorded.
              </p>
            ) : (
              <div className="divide-y divide-slate-800/60 rounded-lg border border-slate-800 bg-slate-950">
                {specEntries.map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                    <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">
                      {k}
                    </span>
                    <span className="break-all text-right text-slate-200">{pretty(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-slate-800 px-5 py-4">
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
              className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-60"
            >
              {assign.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : asset.assigned_to_user_id ? (
                'Reassign'
              ) : (
                'Assign'
              )}
            </button>
          </form>
          {asset.assigned_to_user_id && (
            <button
              type="button"
              onClick={() => assign.mutate({ id: asset.id, uid: null })}
              disabled={assign.isPending}
              className="mt-2 text-xs text-slate-500 underline-offset-2 hover:text-red-400 hover:underline"
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
      </div>
    </div>
  );
}
