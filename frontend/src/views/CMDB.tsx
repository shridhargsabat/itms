import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitBranch, LoaderCircle, MoveRight, Network } from 'lucide-react';
import { getImpact, getTopology } from '@/api/client';
import type { TopologyNode } from '@/api/types';
import { AssetStatusBadge } from '@/components/TicketBadge';
import { cn } from '@/lib/utils';

export default function CMDB() {
  const topology = useQuery({ queryKey: ['topology'], queryFn: getTopology });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && topology.data?.nodes.length) {
      setSelectedId(topology.data.nodes[0].id);
    }
  }, [selectedId, topology.data]);

  const impact = useQuery({
    queryKey: ['impact', selectedId],
    queryFn: () => getImpact(selectedId as string),
    enabled: !!selectedId,
  });

  const grouped = useMemo(() => {
    const g = new Map<string, TopologyNode[]>();
    for (const n of topology.data?.nodes ?? []) {
      const arr = g.get(n.category) ?? [];
      arr.push(n);
      g.set(n.category, arr);
    }
    return [...g.entries()];
  }, [topology.data]);

  const nodeById = useMemo(
    () => new Map((topology.data?.nodes ?? []).map((n) => [n.id, n])),
    [topology.data],
  );

  const root = impact.data ? nodeById.get(impact.data.root_asset_id) : undefined;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">CMDB</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          Configuration items and dependency impact analysis.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <div className="mb-2 flex items-center gap-2 px-2 py-1">
            <Network className="h-4 w-4 text-slate-400" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Configuration Items
            </h2>
          </div>
          {topology.isLoading && (
            <div className="space-y-3 p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-800" />
              ))}
            </div>
          )}
          <div className="max-h-[70vh] space-y-4 overflow-y-auto p-1">
            {grouped.map(([category, nodes]) => (
              <div key={category}>
                <p className="px-2 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {category.replace('_', ' ')} · {nodes.length}
                </p>
                <div className="space-y-1">
                  {nodes.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setSelectedId(n.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                        selectedId === n.id
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-300 hover:bg-slate-800/60',
                      )}
                    >
                      <span className="font-mono text-xs text-indigo-400">{n.asset_tag}</span>
                      <span className="min-w-0 flex-1 truncate">{n.name}</span>
                      <span
                        className={cn(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          n.status === 'IN_STOCK' && 'bg-emerald-400',
                          n.status === 'ASSIGNED' && 'bg-blue-400',
                          n.status === 'MAINTENANCE' && 'bg-amber-400',
                          n.status === 'RETIRED' && 'bg-slate-600',
                        )}
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {impact.isLoading && (
            <div className="flex h-40 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/60 text-slate-500">
              <LoaderCircle className="h-5 w-5 animate-spin" />
            </div>
          )}
          {impact.data && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60">
              <div className="border-b border-slate-800 px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-indigo-400">
                    {root?.asset_tag ?? impact.data.root_asset_id}
                  </span>
                  {root && <AssetStatusBadge status={root.status} />}
                  <span className="ml-auto rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-xs font-medium text-indigo-300 ring-1 ring-inset ring-indigo-500/30">
                    {impact.data.impact_count} impacted
                  </span>
                </div>
                <h2 className="mt-1 text-lg font-semibold text-slate-100">
                  {root?.name ?? 'Root asset'}
                </h2>
                {root && (
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    {root.category}
                  </p>
                )}
              </div>
              <div className="p-3">
                {impact.data.impacted.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">
                    No downstream impact found for this asset.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-800/60">
                    {impact.data.impacted.map((a) => (
                      <div
                        key={a.asset_id}
                        style={{ paddingLeft: `${a.depth * 22 + 10}px` }}
                        className="flex items-center gap-2 py-2 text-sm"
                      >
                        <span className="font-mono text-xs text-indigo-400">{a.asset_tag}</span>
                        <span className="text-slate-200">{a.name}</span>
                        <span className="hidden text-xs text-slate-500 sm:inline">
                          {a.category.replace('_', ' ')}
                        </span>
                        <span className="ml-auto shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                          depth {a.depth}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-800 bg-slate-900/60">
            <div className="flex items-center gap-2 border-b border-slate-800 px-5 py-4">
              <GitBranch className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-200">Relationships</h2>
              <span className="ml-auto text-xs text-slate-500">
                {topology.data?.edges.length ?? 0} edges
              </span>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto p-4">
              {(topology.data?.edges ?? []).length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-500">No relationships defined.</p>
              ) : (
                (topology.data?.edges ?? []).map((e) => {
                  const parent = nodeById.get(e.parent_asset_id);
                  const child = nodeById.get(e.child_asset_id);
                  return (
                    <div
                      key={e.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs"
                    >
                      <span className="font-mono text-indigo-400">
                        {parent?.asset_tag ?? e.parent_asset_id}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                        {e.relationship_type.replace('_', ' ')}
                        <MoveRight className="h-3 w-3" />
                      </span>
                      <span className="font-mono text-indigo-400">
                        {child?.asset_tag ?? e.child_asset_id}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
