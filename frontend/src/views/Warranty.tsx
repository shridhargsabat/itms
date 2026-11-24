import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, PackageX } from 'lucide-react';
import { getWarrantyAlerts } from '@/api/client';
import type { WarrantyAlert } from '@/api/types';
import { AssetStatusBadge } from '@/components/TicketBadge';
import { Button } from '@/components/Button';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { formatDateOnly } from '@/lib/utils';
import { useClientPagination } from '@/lib/usePagination';
import PaginationFooter from '@/components/PaginationFooter';

function bucket(a: WarrantyAlert): 'expired' | '30' | '60' | '90' {
  const d = a.days_left ?? 999;
  if (d < 0) return 'expired';
  if (d <= 30) return '30';
  if (d <= 60) return '60';
  return '90';
}

const alertsCount = (expired: WarrantyAlert[], expiring: WarrantyAlert[]) =>
  expired.length + expiring.length;

const BUCKET_META = {
  expired: { label: 'Expired', icon: PackageX, cls: 'text-red-400', bar: 'bg-red-500/80' },
  '30': { label: 'Expiring ≤ 30 days', icon: AlertTriangle, cls: 'text-red-400', bar: 'bg-red-500/60' },
  '60': { label: 'Expiring ≤ 60 days', icon: Clock, cls: 'text-amber-400', bar: 'bg-amber-500/70' },
  '90': { label: 'Expiring ≤ 90 days', icon: Clock, cls: 'text-sky-400', bar: 'bg-sky-500/70' },
} as const;

/** One bucketed group: its items are client-paginated at the shared 20/page
 *  default so every Warranty bucket gets the SAME per-page count + footer. */
function BucketSection({
  meta,
  items,
  onOpen,
}: {
  meta: (typeof BUCKET_META)[keyof typeof BUCKET_META];
  items: WarrantyAlert[];
  onOpen: (tag: string) => void;
}) {
  const { page, pageSize, setPage, setPageSize, pageRows, total } = useClientPagination(items, 20);
  return (
    <section>
      <h2 className={`mb-2 flex items-center gap-2 text-sm font-semibold ${meta.cls}`}>
        <meta.icon className="h-4 w-4" /> {meta.label}
        <span className="rounded-full bg-elevated px-2 py-0.5 text-xs text-secondary">{total}</span>
      </h2>
      <div className="overflow-hidden rounded-xl glass-card liquid-glass-panel">
        {pageRows.map((a, i) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onOpen(a.asset_tag)}
            className={`block w-full text-left transition-colors hover:bg-elevated ${
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
              <span className="h-1.5 w-24 shrink-0 rounded-full bg-elevated">
                <span
                  className={`block h-full rounded-full ${meta.bar}`}
                  style={{
                    width:
                      a.days_left != null && a.days_left < 0
                        ? '100%'
                        : `${Math.max(8, ((a.days_left ?? 90) / 90) * 100)}%`,
                  }}
                />
              </span>
            </div>
          </button>
        ))}
      </div>
      {total > 0 && (
        <PaginationFooter
          variant="static"
          page={page}
          pageSize={pageSize}
          total={total}
          rowsLength={pageRows.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}
    </section>
  );
}

export default function WarrantyView() {
  const nav = useNavigate();
  const expired = useQuery({ queryKey: ['alerts', 'expired'], queryFn: () => getWarrantyAlerts('expired') });
  const expiring = useQuery({ queryKey: ['alerts', 'expiring'], queryFn: () => getWarrantyAlerts('expiring') });

  const loading = expired.isLoading || expiring.isLoading;
  const expiredData = expired.data ?? [];
  const expiringData = expiring.data ?? [];
  // Expiring bucket is based on days_left; expired list = scope=expired.
  const groups = (['expired', '30', '60', '90'] as const)
    .map((k) => ({
      key: k,
      meta: BUCKET_META[k],
      items: k === 'expired' ? expiredData : expiringData.filter((a) => bucket(a) === k),
    }))
    .filter((g) => g.items.length > 0);

  const open = (tag: string) => nav(`/assets?search=${encodeURIComponent(tag)}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warranty Alerts"
        description={`${expiredData.length + expiringData.length} asset${alertsCount(expiredData, expiringData) === 1 ? '' : 's'} with a warranty expiring in the next 90 days (or already expired).`}
        className="mb-0"
        actions={
          <Button
            type="button"
            onClick={() => nav('/assets')}
            variant="secondary"
            size="sm"
            className="border-edge px-3 text-sm"
            leftIcon={<CheckCircle2 className="h-4 w-4" />}
          >
            Open Assets
          </Button>
        }
      />

      {loading ? (
        <p className="py-10 text-center text-sm text-muted">Loading warranty alerts…</p>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No warranty alerts right now"
          description="Everything has ≥ 90 days of warranty (or none recorded)."
        />
      ) : (
        <div className="space-y-6">
          {groups.map(({ key, meta, items }) => (
            <BucketSection key={key} meta={meta} items={items} onOpen={open} />
          ))}
        </div>
      )}
    </div>
  );
}
