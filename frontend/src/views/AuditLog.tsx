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
        <h1 className="text-xl font-semibold text-slate-100">Audit Log</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          {rows.length} recent events — click a row to inspect the diff.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800">
        {isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-800/70" />
            ))}
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Target Type</th>
                <th className="px-4 py-3 font-medium">Target ID</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-950">
              {rows.map((e) => {
                const expanded = expandedId === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr
                      onClick={() => setExpandedId(expanded ? null : e.id)}
                      className="cursor-pointer transition-colors hover:bg-slate-900"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">
                        {formatDate(e.created_at)}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {e.actor_name ?? (
                          <span className="text-slate-500">system</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-300">
                          {e.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">{e.target_type}</td>
                      <td className="px-4 py-3 font-mono text-xs text-indigo-400">
                        {e.target_id}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500">
                        {expanded ? (
                          <ChevronDown className="ml-auto h-4 w-4" />
                        ) : (
                          <ChevronRight className="ml-auto h-4 w-4" />
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-slate-900/60">
                        <td colSpan={6} className="px-4 py-3">
                          <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-300">
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
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
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
