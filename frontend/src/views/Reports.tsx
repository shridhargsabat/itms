import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Download, Repeat, TrendingUp, TriangleAlert } from 'lucide-react';
import { getRepeatIncidents } from '@/api/client';
import type { RepeatIncident } from '@/api/types';
import { Button } from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import FilterBar from '@/components/FilterBar';
import PageHeader from '@/components/PageHeader';
import Select from '@/components/Select';

/** CSV-escape one cell (quote-wrapping + doubled quotes). */
function csvCell(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Client-side CSV of the rendered repeat-incident findings — no new endpoint. */
function repeatIncidentsCsv(rows: RepeatIncident[]): string {
  const header = ['Title', 'Type', 'Count', 'Last occurrence', 'Asset tag', 'Tickets'].join(',');
  const lines = rows.map((r) =>
    [
      csvCell(r.title),
      csvCell(r.ticketType),
      csvCell(r.count),
      csvCell(new Date(r.lastAt).toISOString().slice(0, 10)),
      csvCell(r.assetTag),
      csvCell(r.ticketNumbers.join('; ')),
    ].join(','),
  );
  return [header, ...lines].join('\n');
}

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

  const findings = report.data ?? [];

  const exportCsv = () => {
    if (findings.length === 0) return;
    const blob = new Blob([repeatIncidentsCsv(findings)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `repeat-incidents-${days}d.csv`;
    // Fix round 1: attach before click — Firefox ignores programmatic
    // clicks on detached anchors (matches Assets/client downloadBlob).
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Reports"
        description="Repeat-incident detection — tickets grouped by title + asset to surface recurring issues (no problem records, just insight)."
        actions={
          <Button
            type="button"
            onClick={exportCsv}
            disabled={findings.length === 0 || report.isLoading}
            variant="secondary"
            size="sm"
            leftIcon={<Download className="h-4 w-4" />}
            title={findings.length === 0 ? 'No findings to export' : 'Download these findings as CSV'}
          >
            Export CSV
          </Button>
        }
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

      {/* Planned canned reports (#56) — non-interactive stubs so the hub
          reads as one live report plus a roadmap, not an empty page. */}
      <section aria-label="Planned reports" className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Planned</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <div aria-disabled="true" className="flex items-center gap-3 rounded-xl glass-card p-4 opacity-60">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <TrendingUp className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-primary">Ticket volume trends</p>
              <p className="text-[11px] text-muted">Coming soon</p>
            </div>
          </div>
          <div aria-disabled="true" className="flex items-center gap-3 rounded-xl glass-card p-4 opacity-60">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-primary">SLA compliance</p>
              <p className="text-[11px] text-muted">Coming soon</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
