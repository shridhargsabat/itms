import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { getLicenses, getWarrantyAlerts } from '@/api/client';
import EmptyState from '@/components/EmptyState';
import { licenseDaysLeft, topExpiringAlerts } from '@/lib/chartData';
import { cn } from '@/lib/utils';

function CountdownPill({ days }: { days: number | null }) {
  return (
    <span className="shrink-0 rounded-full bg-[#FF9500] px-2.5 py-1 font-mono text-[11px] font-bold text-white">
      {days == null ? '—' : `${days}d`}
    </span>
  );
}

/**
 * Expiring Soon stack (Task 8): top-5 warranty alerts by urgency plus the
 * next expiring licenses, all live. Rows and the alerts pill follow the
 * AppleLiquidGlassDashboard reference; the footer button opens the CMDB
 * Impact Lens.
 */
export default function ExpiringSoon({ className }: { className?: string }) {
  const navigate = useNavigate();
  const warranty = useQuery({
    queryKey: ['alerts', 'expiring'],
    queryFn: () => getWarrantyAlerts('expiring'),
  });
  const licenses = useQuery({
    queryKey: ['licenses', 'expiring'],
    queryFn: () => getLicenses({ scope: 'expiring', limit: 5 }),
  });

  const warrantyRows = topExpiringAlerts(warranty.data ?? [], 5);
  const licenseRows = licenses.data?.items ?? [];
  const total = warrantyRows.length + licenseRows.length;
  const isLoading = warranty.isLoading || licenses.isLoading;

  return (
    <section
      data-testid="expiring-soon"
      className={cn(
        'liquid-glass-panel flex min-w-0 flex-col justify-between space-y-4 rounded-[28px] p-5 sm:p-6',
        className,
      )}
    >
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-primary">Expiring Soon</h2>
          <span className="rounded-full bg-[#FF9500]/20 px-2.5 py-0.5 text-[11px] font-semibold text-[#FF9500]">
            {total} Alerts
          </span>
        </div>
        {isLoading ? (
          <div className="space-y-2.5" data-testid="expiring-skeleton">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[62px] animate-pulse rounded-[20px] bg-elevated" />
            ))}
          </div>
        ) : total === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nothing expiring soon"
            description="No warranties or licenses expire in the upcoming window. New alerts will stack here automatically."
          />
        ) : (
          <>
            {warrantyRows.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => navigate(`/assets?search=${encodeURIComponent(w.asset_tag)}`)}
                className="glass-card flex w-full cursor-pointer items-center justify-between gap-2 rounded-[20px] p-3.5 text-left transition-colors hover:bg-elevated/60"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-primary">{w.name}</div>
                  <div className="font-mono text-[11px] text-muted">
                    {w.asset_tag} · {w.warranty_expiry ?? '—'}
                  </div>
                </div>
                <CountdownPill days={w.days_left} />
              </button>
            ))}
            {licenseRows.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => navigate('/licenses?tab=expiring')}
                className="glass-card flex w-full cursor-pointer items-center justify-between gap-2 rounded-[20px] p-3.5 text-left transition-colors hover:bg-elevated/60"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-primary">{l.name}</div>
                  <div className="truncate font-mono text-[11px] text-muted">
                    {[l.vendor, l.expiry_date].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                <CountdownPill days={licenseDaysLeft(l.expiry_date)} />
              </button>
            ))}
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => navigate('/cmdb')}
        className="glass-card w-full rounded-full py-2.5 text-xs font-semibold text-primary transition-colors hover:bg-elevated/60"
      >
        Open CMDB Impact Lens →
      </button>
    </section>
  );
}
