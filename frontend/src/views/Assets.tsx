import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { listAssets } from '@/api/client';
import { ASSET_CATEGORIES, ASSET_STATUSES } from '@/api/types';
import type { Asset } from '@/api/types';
import AssetSpecModal from '@/components/AssetSpecModal';
import DataTable, { type Column } from '@/components/DataTable';
import Select from '@/components/Select';
import { AssetStatusBadge } from '@/components/TicketBadge';
import { inputCls } from '@/lib/utils';

export default function Assets() {
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<Asset | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const search = params.get('search') ?? '';
  const category = params.get('category') ?? '';
  const status = params.get('status') ?? '';

  const filters = {
    search: search || undefined,
    category: category || undefined,
    status: status || undefined,
  };
  const { data, isLoading } = useQuery({
    queryKey: ['assets', filters, page, pageSize],
    queryFn: () => listAssets({ ...filters, limit: pageSize, offset: (page - 1) * pageSize }),
  });

  // any filter change resets to page 1
  useEffect(() => {
    setPage(1);
  }, [search, category, status]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setParams(next, { replace: true });
  };

  const columns: Column<Asset>[] = [
    {
      key: 'asset_tag',
      header: 'Tag',
      render: (a) => <span className="font-mono text-xs text-indigo-400">{a.asset_tag}</span>,
    },
    {
      key: 'name',
      header: 'Name',
      render: (a) => <span className="font-medium text-slate-200">{a.name}</span>,
    },
    { key: 'category', header: 'Category' },
    {
      key: 'status',
      header: 'Status',
      render: (a) => <AssetStatusBadge status={a.status} />,
    },
    {
      key: 'serial_number',
      header: 'Serial',
      render: (a) => (
        <span className="font-mono text-xs text-slate-400">{a.serial_number ?? '—'}</span>
      ),
    },
    {
      key: 'assigned_user_name',
      header: 'Assigned To',
      render: (a) => <span className="text-slate-300">{a.assigned_user_name ?? '—'}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Assets</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            {data?.length ?? 0} asset{data?.length === 1 ? '' : 's'} in the registry
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              className={`${inputCls} w-56 pl-9`}
              placeholder="Search assets…"
              value={search}
              onChange={(e) => update('search', e.target.value)}
            />
          </div>
          <Select
            className="w-auto"
            value={category}
            onChange={(v) => update('category', v)}
            options={[
              { value: '', label: 'All Categories' },
              ...ASSET_CATEGORIES.map((c) => ({ value: c, label: c.replace('_', ' ') })),
            ]}
          />
          <Select
            className="w-auto"
            value={status}
            onChange={(v) => update('status', v)}
            options={[
              { value: '', label: 'All Statuses' },
              ...ASSET_STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') })),
            ]}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        total={data?.total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        loading={isLoading}
        emptyMessage="No assets match the current filters."
        onRowClick={(a) => setSelected(a)}
      />

      <AssetSpecModal asset={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
