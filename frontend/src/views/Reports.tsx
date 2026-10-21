import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Repeat, TriangleAlert } from 'lucide-react';
import { getRepeatIncidents } from '@/api/client';

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
      <div>
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="mt-0.5 text-xs text-muted">
          Repeat-incident detection — tickets grouped by title + asset to surface recurring issues (no problem records, just insight).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl glass-card p-3">
        <label className="flex items-center gap-2 text-xs text-secondary">
          Look back
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="h-8 rounded-lg glass-dense px-2 text-xs outline-none focus:border-accent"
          >
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={180}>6 months</option>
            <option value={365}>12 months</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-secondary">
          Show groups with
          <select
            value={minCount}
            onChange={(e) => setMinCount(Number(e.target.value))}
            className="h-8 rounded-lg glass-dense px-2 text-xs outline-none focus:border-accent"
          >
            <option value={2}>≥ 2 tickets</option>
            <option value={3}>≥ 3 tickets</option>
            <option value={5}>≥ 5 tickets</option>
          </select>
          occurrences
        </label>
        {report.isFetching && <span className="text-[11px] text-muted">refreshing…</span>}
      </div>

      <div className="space-y-2">
        {report.data?.map((r) => (
          <div key={`${r.title}|${r.assetTag ?? ''}`} className="rounded-xl glass-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Repeat className="h-4 w-4 shrink-0 text-indigo-400" />
                  <span className="truncate text-sm font-medium">{r.title}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                  <span className="rounded-md border border-edge2 px-1.5 py-0.5">{r.ticketType}</span>
                  {r.assetTag && <span className="rounded-md border border-edge2 px-1.5 py-0.5">{r.assetTag}</span>}
                  <span>last: {new Date(r.lastAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="shrink-0 rounded-lg bg-red-500/10 px-2.5 py-1 text-right">
                <div className="text-lg font-semibold leading-none text-red-400">{r.count}</div>
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
          <div className="rounded-xl glass-card border-dashed p-8 text-center">
            <TriangleAlert className="mx-auto mb-2 h-6 w-6 text-muted" />
            <p className="text-xs text-muted">No repeat patterns in this window — the service desk is healthy.</p>
          </div>
        )}
      </div>
    </div>
  );
}
