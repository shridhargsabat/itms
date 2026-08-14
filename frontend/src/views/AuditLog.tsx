import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getAuditLog } from '@/api/client';
import { formatDate } from '@/lib/utils';

export default function AuditLog() {
  const { data, isLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: () => getAuditLog(100),
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const rows = data ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-primary">Audit Log</h1>
        <p className="mt-0.5 text-sm text-secondary">
          {rows.length} recent events — click a row to inspect the diff.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-edge">
        {isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-elevated/70" />
            ))}
          </div>
        ) : (
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-secondary">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Target Type</th>
                <th className="px-4 py-3 font-medium">Target ID</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/60 bg-base">
              {rows.map((e) => {
                const expanded = expandedId === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr
                      onClick={() => setExpandedId(expanded ? null : e.id)}
                      className="cursor-pointer transition-colors hover:bg-surface"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-secondary">
                        {formatDate(e.created_at)}
                      </td>
                      <td className="px-4 py-3 text-secondary">
                        {e.actor_name ?? (
                          <span className="text-muted">system</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-elevated px-2 py-0.5 font-mono text-xs text-secondary">
                          {e.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-secondary">{e.target_type}</td>
                      <td className="px-4 py-3 font-mono text-xs text-accent">
                        {e.target_id}
                      </td>
                      <td className="px-4 py-3 text-right text-muted">
                        {expanded ? (
                          <ChevronDown className="ml-auto h-4 w-4" />
                        ) : (
                          <ChevronRight className="ml-auto h-4 w-4" />
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-surface/60">
                        <td colSpan={6} className="px-4 py-3">
                          <pre className="max-h-72 overflow-auto rounded-lg bg-base p-3 font-mono text-xs leading-relaxed text-secondary">
                            {JSON.stringify(e.diff, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted">
                    No audit entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
