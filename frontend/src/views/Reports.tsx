import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Repeat, TriangleAlert } from 'lucide-react';
import { getRepeatIncidents } from '@/api/client';
import EmptyState from '@/components/EmptyState';
import FilterBar from '@/components/FilterBar';
import PageHeader from '@/components/PageHeader';
import Select from '@/components/Select';

/**
 * Reports hub — Phase 2 (#49 repeat-incident detection, problem-lite).
 * More canned reports (#56) land here later.
 */
export default function Reports() {
  const [days, setDays] = useState(90);
  const [minCount, setMinCount] = useState(2);

  const report = useQuery({
    queryKey: ['repeat-incidents', days, minCount],
    queryFn: () => getRepeatIncidents({ days, min_count: minCount }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Reports"
        description="Repeat-incident detection — tickets grouped by title + asset to surface recurring issues (no problem records, just insight)."
      />

      <FilterBar>
        <div className="flex items-center gap-2 text-xs text-secondary">
          <span>Look back</span>
          <Select
            className="w-32"
            triggerClassName="h-8 py-1 text-xs"
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            options={[
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
              { value: '180', label: '6 months' },
              { value: '365', label: '12 months' },
            ]}
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-secondary">
          <span>Show groups with</span>
          <Select
            className="w-36"
            triggerClassName="h-8 py-1 text-xs"
            value={String(minCount)}
            onChange={(v) => setMinCount(Number(v))}
            options={[
              { value: '2', label: '≥ 2 tickets' },
              { value: '3', label: '≥ 3 tickets' },
              { value: '5', label: '≥ 5 tickets' },
            ]}
          />
          <span>occurrences</span>
        </div>
        {report.isFetching && <span className="text-[11px] text-muted">refreshing…</span>}
      </FilterBar>

      <div className="space-y-2">
        {report.data?.map((r) => (
          <div key={`${r.title}|${r.assetTag ?? ''}`} className="rounded-xl glass-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Repeat className="h-4 w-4 shrink-0 text-accent" />
                  <span className="truncate text-sm font-medium text-primary">{r.title}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                  <span className="rounded-md border border-edge2 px-1.5 py-0.5">{r.ticketType}</span>
                  {r.assetTag && <span className="rounded-md border border-edge2 px-1.5 py-0.5 font-mono">{r.assetTag}</span>}
                  <span>last: {new Date(r.lastAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="shrink-0 rounded-lg bg-red-500/10 px-2.5 py-1 text-right">
                <div className="text-lg font-semibold leading-none tabular-nums text-red-700 dark:text-red-400">{r.count}</div>
                <div className="text-[10px] text-muted">tickets</div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {r.ticketNumbers.map((n) => (
                <span key={n} className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-secondary">{n}</span>
              ))}
            </div>
          </div>
        ))}
        {!report.isLoading && (report.data?.length ?? 0) === 0 && (
          <EmptyState
            icon={TriangleAlert}
            title="No repeat patterns"
            description="No repeat patterns in this window — the service desk is healthy."
          />
        )}
      </div>
    </div>
  );
}
