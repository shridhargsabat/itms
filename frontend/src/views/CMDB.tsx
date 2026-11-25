import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitBranch, LoaderCircle, MoveRight, Network, Search } from 'lucide-react';
import { getImpact, getTopology } from '@/api/client';
import type { TopologyNode } from '@/api/types';
import DataTable, { type Column } from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import PageHeader from '@/components/PageHeader';
import { AssetStatusBadge } from '@/components/TicketBadge';
import { formatEnum } from '@/lib/formatEnum';
import { inputCls } from '@/lib/utils';

// CMDB carve-out: the CI table is embedded in a narrow sidebar column —
// geometry/typography still uses the shared spec (TableView covers it), only
// the scroll threshold is narrower. 320px fits a 375px phone minus card
// padding, so the table never forces a stray horizontal scroll.
const CI_TABLE_MIN_WIDTH = 'min-w-[320px]' as const;

export default function CMDB() {
  const topology = useQuery({ queryKey: ['topology'], queryFn: getTopology });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ciPage, setCiPage] = useState(1);
  const [ciPageSize, setCiPageSize] = useState(20);
  const [ciSort, setCiSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [ciSearch, setCiSearch] = useState('');

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

  // CI search filters the table (name/tag/category) and the relationships
  // list (either endpoint matches) so one query narrows the whole graph view.
  const query = ciSearch.trim().toLowerCase();
  const matchesQuery = (n: TopologyNode | undefined) =>
    !query ||
    !n ||
    n.name.toLowerCase().includes(query) ||
    n.asset_tag.toLowerCase().includes(query) ||
    n.category.toLowerCase().includes(query);
  const filteredNodes = allNodes.filter((n) => matchesQuery(n));
  const allEdges = topology.data?.edges ?? [];
  const visibleEdges = allEdges.filter(
    (e) => matchesQuery(nodeById.get(e.parent_asset_id)) || matchesQuery(nodeById.get(e.child_asset_id)),
  );

  const ciColumns: Column<TopologyNode>[] = [
    {
      key: 'asset_tag',
      header: 'Tag',
      sortable: true,
      sortKey: 'asset_tag',
      className: 'px-2',
      render: (n) => <span className="whitespace-nowrap font-mono text-xs text-accent">{n.asset_tag}</span>,
    },
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      className: 'max-w-[110px] px-2',
      render: (n) => <span className="block min-w-0 truncate font-medium text-primary">{n.name}</span>,
    },
    {
      key: 'category',
      header: 'Category',
      sortable: true,
      // Category hides below sm: 4 columns don't fit a 375px phone, and the
      // full category stays one tap away in CI Detail (row click selects).
      className: 'hidden px-2 sm:table-cell',
      render: (n) => <span className="whitespace-nowrap text-xs text-secondary">{formatEnum(n.category)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      className: 'px-2',
      render: (n) => <AssetStatusBadge status={n.status} />,
    },
  ];

  const root = impact.data ? nodeById.get(impact.data.root_asset_id) : undefined;
  const selected = selectedId ? nodeById.get(selectedId) : undefined;

  return (
    <div className="space-y-5">
      <PageHeader
        title="CMDB"
        description="Configuration items and dependency impact analysis."
      />

      <div className="grid gap-4 lg:grid-cols-[480px_1fr]">
        <div className="min-w-0 rounded-xl glass-card liquid-glass-panel rounded-[26px] p-3">
          <div className="mb-2 flex items-center gap-2 px-2 py-1">
            <Network className="h-4 w-4 text-secondary" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-secondary">
              Configuration Items
            </h2>
          </div>
          <div className="relative mb-2 px-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              inputMode="search"
              aria-label="Search configuration items"
              placeholder="Search by name, tag, or type…"
              value={ciSearch}
              onChange={(e) => {
                setCiSearch(e.target.value);
                setCiPage(1);
              }}
              className={`${inputCls} pl-9`}
            />
          </div>
          {topology.isLoading && (
            <div className="space-y-3 p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse rounded-lg bg-elevated" />
              ))}
            </div>
          )}
          {!topology.isLoading && allNodes.length === 0 ? (
            <div className="p-1">
              <EmptyState
                icon={Network}
                title="No configuration items"
                description="No configuration items found in the topology yet."
              />
            </div>
          ) : (
            <div className="p-1">
              {/* CMDB carve-out: the CI table lives in the left column and
                  slices the in-memory topology graph (DataTable owns the
                  internal scroll container + sticky header + footer). */}
              <DataTable<TopologyNode>
                columns={ciColumns}
                rows={filteredNodes.slice((ciPage - 1) * ciPageSize, ciPage * ciPageSize)}
                total={filteredNodes.length}
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
                emptyMessage={
                  query
                    ? `No configuration items match "${ciSearch.trim()}".`
                    : 'No configuration items found.'
                }
                minWidth={CI_TABLE_MIN_WIDTH}
                caption="Configuration items"
                highlightId={selectedId ?? undefined}
                onRowClick={(n) => setSelectedId(n.id)}
              />
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {impact.isLoading && (
            <div className="flex h-40 items-center justify-center rounded-xl glass-card liquid-glass-panel rounded-[26px] text-muted">
              <LoaderCircle className="h-5 w-5 animate-spin" />
            </div>
          )}
          {impact.data && (
            <div className="rounded-xl glass-card liquid-glass-panel rounded-[26px]">
              <div className="border-b border-edge px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="whitespace-nowrap font-mono text-xs text-accent cmdb-root-tag">
                    {root?.asset_tag ?? impact.data.root_asset_id}
                  </span>
                  {root && <AssetStatusBadge status={root.status} />}
                  <span className="ml-auto rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent ring-1 ring-inset ring-accent/30">
                    {impact.data.impact_count} impacted
                  </span>
                </div>
                <h2 className="mt-1 text-lg font-semibold text-primary">
                  {root?.name ?? 'Root asset'}
                </h2>
                {root && (
                  <p className="text-xs uppercase tracking-wide text-muted">
                    {formatEnum(root.category)}
                  </p>
                )}
              </div>
              <div className="p-3">
                {impact.data.impacted.length === 0 ? (
                  <EmptyState
                    icon={GitBranch}
                    title="No downstream impact"
                    description="No downstream impact found for this asset."
                  />
                ) : (
                  <div className="divide-y divide-edge/60">
                    {impact.data.impacted.map((a) => (
                      <div
                        key={a.asset_id}
                        style={{ paddingLeft: `${a.depth * 22 + 10}px` }}
                        className="flex items-center gap-2 py-2 text-sm"
                      >
                        <span className="whitespace-nowrap font-mono text-xs text-accent">{a.asset_tag}</span>
                        <span className="truncate text-primary">{a.name}</span>
                        <span className="hidden shrink-0 whitespace-nowrap text-xs text-muted sm:inline">
                          {formatEnum(a.category)}
                        </span>
                        <span className="ml-auto shrink-0 rounded bg-elevated px-1.5 py-0.5 text-[10px] text-secondary cmdb-depth">
                          depth {a.depth}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {selected && (
            <div
              data-testid="ci-detail"
              className="rounded-xl glass-card liquid-glass-panel rounded-[26px] px-5 py-4"
            >
              <h2 className="text-sm font-semibold text-primary">CI Detail</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="whitespace-nowrap font-mono text-xs text-accent">
                  {selected.asset_tag}
                </span>
                <AssetStatusBadge status={selected.status} />
              </div>
              <p className="mt-1 truncate text-lg font-semibold text-primary">{selected.name}</p>
              <p className="text-xs uppercase tracking-wide text-muted">
                {formatEnum(selected.category)}
              </p>
            </div>
          )}

          <div className="rounded-xl glass-card liquid-glass-panel rounded-[26px]">
            <div className="flex items-center gap-2 border-b border-edge px-5 py-4">
              <GitBranch className="h-4 w-4 text-secondary" />
              <h2 className="text-sm font-semibold text-primary">Relationships</h2>
              <span className="ml-auto text-xs text-muted">
                {query ? `${visibleEdges.length} of ${allEdges.length} edges` : `${allEdges.length} edges`}
              </span>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto p-4">
              {allEdges.length === 0 ? (
                <EmptyState
                  icon={GitBranch}
                  title="No relationships"
                  description="No relationships defined between configuration items yet."
                />
              ) : visibleEdges.length === 0 ? (
                <p className="p-2 text-center text-sm text-muted">
                  {`No relationships match "${ciSearch.trim()}".`}
                </p>
              ) : (
                visibleEdges.map((e) => {
                  const parent = nodeById.get(e.parent_asset_id);
                  const child = nodeById.get(e.child_asset_id);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setSelectedId(e.child_asset_id)}
                      aria-label={`${parent?.name ?? e.parent_asset_id} (${parent?.asset_tag ?? '?'}) ${formatEnum(e.relationship_type)} ${child?.name ?? e.child_asset_id} (${child?.asset_tag ?? '?'})`}
                      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg glass-dense px-3 py-2 text-left text-xs transition-colors hover:border-accent/40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-primary">
                          {parent?.name ?? e.parent_asset_id}
                        </span>
                        <span className="block whitespace-nowrap font-mono text-[10px] text-accent">
                          {parent?.asset_tag ?? e.parent_asset_id}
                        </span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded bg-elevated px-2 py-0.5 text-[10px] uppercase tracking-wide text-secondary">
                        {formatEnum(e.relationship_type)}
                        <MoveRight className="h-3 w-3" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-primary">
                          {child?.name ?? e.child_asset_id}
                        </span>
                        <span className="block whitespace-nowrap font-mono text-[10px] text-accent">
                          {child?.asset_tag ?? e.child_asset_id}
                        </span>
                      </span>
                    </button>
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
