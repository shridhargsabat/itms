import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, PackageX } from 'lucide-react';
import { getWarrantyAlerts } from '@/api/client';
import type { WarrantyAlert } from '@/api/types';
import { AssetStatusBadge } from '@/components/TicketBadge';
import { formatDateOnly } from '@/lib/utils';

function bucket(a: WarrantyAlert): 'expired' | '30' | '60' | '90' {
  const d = a.days_left ?? 999;
  if (d < 0) return 'expired';
  if (d <= 30) return '30';
  if (d <= 60) return '60';
  return '90';
}

const BUCKET_META = {
  expired: { label: 'Expired', icon: PackageX, cls: 'text-red-400', bar: 'bg-red-500/80' },
  '30': { label: 'Expiring ≤ 30 days', icon: AlertTriangle, cls: 'text-red-400', bar: 'bg-red-500/60' },
  '60': { label: 'Expiring ≤ 60 days', icon: Clock, cls: 'text-amber-400', bar: 'bg-amber-500/70' },
  '90': { label: 'Expiring ≤ 90 days', icon: Clock, cls: 'text-sky-400', bar: 'bg-sky-500/70' },
} as const;

export default function WarrantyView() {
  const nav = useNavigate();
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: getWarrantyAlerts });

  const data = alerts.data ?? [];
  const grouped = (['expired', '30', '60', '90'] as const)
    .map((k) => ({ key: k, meta: BUCKET_META[k], items: data.filter((a) => bucket(a) === k) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-primary">Warranty Alerts</h1>
          <p className="mt-0.5 text-sm text-secondary">
            {data.length} asset{data.length === 1 ? '' : 's'} with a warranty expiring in the next 90 days (or already expired).
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => nav('/assets')}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-edge px-3 text-sm text-secondary transition-colors hover:bg-elevated"
          >
            <CheckCircle2 className="h-4 w-4" /> Open Assets
          </button>
        </div>
      </div>

      {alerts.isLoading ? (
        <p className="py-10 text-center text-sm text-muted">Loading warranty alerts…</p>
      ) : grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed border-edge py-14 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
          <p className="mt-3 text-sm font-medium text-primary">No warranty alerts right now</p>
          <p className="mt-1 text-xs text-muted">Everything has ≥ 90 days of warranty (or none recorded).</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ key, meta, items }) => (
            <section key={key}>
              <h2 className={`mb-2 flex items-center gap-2 text-sm font-semibold ${meta.cls}`}>
                <meta.icon className="h-4 w-4" /> {meta.label}
                <span className="rounded-full bg-elevated px-2 py-0.5 text-xs text-secondary">{items.length}</span>
              </h2>
              <div className="overflow-hidden rounded-xl border border-edge bg-surface">
                {items.map((a, i) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => nav(`/assets?search=${encodeURIComponent(a.asset_tag)}`)}
                    className={`block w-full text-left transition-colors hover:bg-elevated/60 ${
                      i > 0 ? 'border-t border-edge/60' : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-accent">{a.asset_tag}</span>
                          <span className="truncate text-sm font-medium text-primary">{a.name}</span>
                          <AssetStatusBadge status={a.status} />
                        </div>
                        <p className="mt-0.5 text-xs text-muted">
                          Expires {formatDateOnly(a.warranty_expiry)}
                          {a.days_left !== null && (
                            <span className={a.days_left < 0 ? 'text-red-400' : ''}>
                              {' '}
                              · {a.days_left < 0 ? `${-a.days_left}d past` : `${a.days_left}d remaining`}
                            </span>
                          )}
                        </p>
                      </div>
                      <span className={`h-1.5 w-24 shrink-0 rounded-full bg-elevated`}>
                        <span
                          className={`block h-full rounded-full ${meta.bar}`}
                          style={{
                            width:
                              key === 'expired'
                                ? '100%'
                                : `${Math.max(8, ((a.days_left ?? 0) / 90) * 100)}%`,
                          }}
                        />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
