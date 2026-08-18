import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitBranch, LoaderCircle, MoveRight, Network } from 'lucide-react';
import { getImpact, getTopology } from '@/api/client';
import type { TopologyNode } from '@/api/types';
import DataTable, { type Column } from '@/components/DataTable';
import { AssetStatusBadge } from '@/components/TicketBadge';

// CMDB carve-out: the CI table is embedded in a narrow 300px sidebar column —
// geometry/typography still uses the shared spec (TableView covers it), only
// the scroll threshold is narrower. All other tables use the DataTable default.
const CI_TABLE_MIN_WIDTH = 'min-w-[380px]' as const;

export default function CMDB() {
  const topology = useQuery({ queryKey: ['topology'], queryFn: getTopology });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ciPage, setCiPage] = useState(1);
  const [ciPageSize, setCiPageSize] = useState(20);
  const [ciSort, setCiSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

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

  const nodeById = useMemo(
    () => new Map((topology.data?.nodes ?? []).map((n) => [n.id, n])),
    [topology.data],
  );

  const allNodes = useMemo(() => {
    const nodes = topology.data?.nodes ?? [];
    if (!ciSort) return nodes;
    const dir = ciSort.dir === 'asc' ? 1 : -1;
    return [...nodes].sort((a, b) => {
      const av = String(a[ciSort.key as keyof TopologyNode] ?? '');
      const bv = String(b[ciSort.key as keyof TopologyNode] ?? '');
      return av.localeCompare(bv) * dir;
    });
  }, [topology.data, ciSort]);

  const ciColumns: Column<TopologyNode>[] = [
    {
      key: 'asset_tag',
      header: 'Tag',
      sortable: true,
      sortKey: 'tag',
      render: (n) => <span className="font-mono text-xs text-accent">{n.asset_tag}</span>,
    },
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (n) => <span className="min-w-0 truncate font-medium text-primary">{n.name}</span>,
    },
    {
      key: 'category',
      header: 'Category',
      sortable: true,
      render: (n) => <span className="text-secondary">{n.category.replace('_', ' ')}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (n) => <AssetStatusBadge status={n.status} />,
    },
  ];

  const root = impact.data ? nodeById.get(impact.data.root_asset_id) : undefined;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-primary">CMDB</h1>
        <p className="mt-0.5 text-sm text-secondary">
          Configuration items and dependency impact analysis.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="min-w-0 rounded-xl border border-edge bg-surface/60 p-3">
          <div className="mb-2 flex items-center gap-2 px-2 py-1">
            <Network className="h-4 w-4 text-secondary" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-secondary">
              Configuration Items
            </h2>
          </div>
          {topology.isLoading && (
            <div className="space-y-3 p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse rounded-lg bg-elevated" />
              ))}
            </div>
          )}
          <div className="max-h-[70vh] overflow-y-auto p-1">
            {/* CMDB carve-out: the CI table lives in a narrow 300px sidebar and
                slices the in-memory topology graph (unpaginated by design —
                the graph is loaded whole). */}
            <DataTable<TopologyNode>
              columns={ciColumns}
              rows={allNodes.slice((ciPage - 1) * ciPageSize, ciPage * ciPageSize)}
              total={allNodes.length}
              page={ciPage}
              pageSize={ciPageSize}
              onPageChange={(p) => setCiPage(Math.max(1, p))}
              onPageSizeChange={(s) => {
                setCiPageSize(s);
                setCiPage(1);
              }}
              sort={ciSort}
              onSortChange={(s) => {
                setCiSort(s);
                setCiPage(1);
              }}
              loading={topology.isLoading}
              emptyMessage="No configuration items found."
              minWidth={CI_TABLE_MIN_WIDTH}
              onRowClick={(n) => setSelectedId(n.id)}
            />
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          {impact.isLoading && (
            <div className="flex h-40 items-center justify-center rounded-xl border border-edge bg-surface/60 text-muted">
              <LoaderCircle className="h-5 w-5 animate-spin" />
            </div>
          )}
          {impact.data && (
            <div className="rounded-xl border border-edge bg-surface/60">
              <div className="border-b border-edge px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-accent">
                    {root?.asset_tag ?? impact.data.root_asset_id}
                  </span>
                  {root && <AssetStatusBadge status={root.status} />}
                  <span className="ml-auto rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent ring-1 ring-inset ring-indigo-500/30">
                    {impact.data.impact_count} impacted
                  </span>
                </div>
                <h2 className="mt-1 text-lg font-semibold text-primary">
                  {root?.name ?? 'Root asset'}
                </h2>
                {root && (
                  <p className="text-xs uppercase tracking-wide text-muted">
                    {root.category}
                  </p>
                )}
              </div>
              <div className="p-3">
                {impact.data.impacted.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-edge p-6 text-center text-sm text-muted">
                    No downstream impact found for this asset.
                  </p>
                ) : (
                  <div className="divide-y divide-edge/60">
                    {impact.data.impacted.map((a) => (
                      <div
                        key={a.asset_id}
                        style={{ paddingLeft: `${a.depth * 22 + 10}px` }}
                        className="flex items-center gap-2 py-2 text-sm"
                      >
                        <span className="font-mono text-xs text-accent">{a.asset_tag}</span>
                        <span className="text-primary">{a.name}</span>
                        <span className="hidden text-xs text-muted sm:inline">
                          {a.category.replace('_', ' ')}
                        </span>
                        <span className="ml-auto shrink-0 rounded bg-elevated px-1.5 py-0.5 text-[10px] text-secondary">
                          depth {a.depth}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-edge bg-surface/60">
            <div className="flex items-center gap-2 border-b border-edge px-5 py-4">
              <GitBranch className="h-4 w-4 text-secondary" />
              <h2 className="text-sm font-semibold text-primary">Relationships</h2>
              <span className="ml-auto text-xs text-muted">
                {topology.data?.edges.length ?? 0} edges
              </span>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto p-4">
              {(topology.data?.edges ?? []).length === 0 ? (
                <p className="py-4 text-center text-sm text-muted">No relationships defined.</p>
              ) : (
                (topology.data?.edges ?? []).map((e) => {
                  const parent = nodeById.get(e.parent_asset_id);
                  const child = nodeById.get(e.child_asset_id);
                  return (
                    <div
                      key={e.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-base px-3 py-2 text-xs"
                    >
                      <span className="font-mono text-accent">
                        {parent?.asset_tag ?? e.parent_asset_id}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded bg-elevated px-2 py-0.5 text-[10px] uppercase tracking-wide text-secondary">
                        {e.relationship_type.replace('_', ' ')}
                        <MoveRight className="h-3 w-3" />
                      </span>
                      <span className="font-mono text-accent">
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
