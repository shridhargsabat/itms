import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getVelocity } from '@/api/client';
import EmptyState from '@/components/EmptyState';
import { useLiquidGlassThemeState } from '@/components/LiquidGlass';
import { cn } from '@/lib/utils';

type Range = '7d' | '30d';

/**
 * Service velocity chart (Task 8): live `GET /dashboard/velocity?range=`
 * points with a 7d/30d toggle. Series, gradients, axes and tooltip follow
 * the AppleLiquidGlassDashboard reference verbatim; grid/axis ink follows
 * the resolved theme (day/night glass).
 */
export default function VelocityChart({ className }: { className?: string }) {
  const [range, setRange] = useState<Range>('7d');
  const { isDark } = useLiquidGlassThemeState();
  const { data, isLoading } = useQuery({
    queryKey: ['velocity', range],
    queryFn: () => getVelocity(range),
  });
  const points = data?.points ?? [];

  return (
    <section
      data-testid="velocity-chart"
      className={cn('liquid-glass-panel min-w-0 rounded-[28px] p-5 sm:p-6', className)}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-primary">Service Velocity & Resolution</h2>
          <p className="text-xs text-muted">Incidents vs resolved throughput</p>
        </div>
        <div className="liquid-glass-pill flex shrink-0 rounded-full p-0.5" role="group" aria-label="Velocity range">
          {(['7d', '30d'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={cn(
                'rounded-full px-3 py-1 text-[11px] font-medium transition',
                range === r ? 'bg-[#007AFF] text-white' : 'text-secondary',
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {isLoading ? (
        <div
          data-testid="velocity-skeleton"
          className="h-60 w-full animate-pulse rounded-2xl bg-elevated"
        />
      ) : points.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No velocity data"
          description="No ticket throughput for this range yet. New incidents and resolutions will chart here automatically."
        />
      ) : (
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points}>
              <defs>
                <linearGradient id="algBlue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#007AFF" stopOpacity={0.38} />
                  <stop offset="95%" stopColor="#007AFF" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="algGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34C759" stopOpacity={0.32} />
                  <stop offset="95%" stopColor="#34C759" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.07)'}
              />
              <XAxis dataKey="day" stroke={isDark ? '#cbd5e1' : '#475569'} fontSize={11} />
              <YAxis stroke={isDark ? '#cbd5e1' : '#475569'} fontSize={11} />
              <Tooltip />
              <Area type="monotone" dataKey="resolved" stroke="#34C759" fill="url(#algGreen)" strokeWidth={2.5} />
              <Area type="monotone" dataKey="incidents" stroke="#007AFF" fill="url(#algBlue)" strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
