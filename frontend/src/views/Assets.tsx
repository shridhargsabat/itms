import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Download, FileUp, LoaderCircle, Search, TriangleAlert } from 'lucide-react';
import { exportAssetsCsv, importAssetsCsv, listAssets } from '@/api/client';
import type { ImportResult } from '@/api/client';
import { ASSET_CATEGORIES, ASSET_STATUSES } from '@/api/types';
import type { Asset } from '@/api/types';
import AssetSpecModal from '@/components/AssetSpecModal';
import DataTable, { type Column } from '@/components/DataTable';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { AssetStatusBadge } from '@/components/TicketBadge';
import { inputCls } from '@/lib/utils';

export default function Assets() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<Asset | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [importOpen, setImportOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const importMutation = useMutation({
    mutationFn: (csvText: string) => importAssetsCsv(csvText),
    onSuccess: (result) => {
      setImportResult(result);
      if (result.imported > 0) {
        qc.invalidateQueries({ queryKey: ['assets'] });
        qc.invalidateQueries({ queryKey: ['metrics'] });
        qc.invalidateQueries({ queryKey: ['cmdb'] });
      }
    },
  });

  const onImport = async () => {
    if (!file) return;
    const csvText = await file.text();
    importMutation.mutate(csvText);
  };

  const onDownloadTemplate = () => {
    const esc = (v: string) =>
      v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
    const tpl = [
      ['name', 'category', 'serial_number', 'status', 'purchase_date', 'warranty_expiry', 'asset_tag', 'assigned_to', 'specs'].join(','),
      [
        'Dell Latitude 7420',
        'LAPTOP',
        'SN-DELL-001',
        'IN_STOCK',
        '2026-01-15',
        '2029-01-15',
        '',
        'admin@itms.local',
        esc(JSON.stringify({ cpu: 'i7-1185G7', ram: '16GB' })),
      ].join(','),
      ['HP ProBook 450', 'DESKTOP', 'SN-HP-002', 'ASSIGNED', '2025-08-01', '2028-08-01', '', 'pratik@sonalapparels.in', ''].join(','),
    ].join('\n');
    const blob = new Blob([tpl], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'assets-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onExport = () => {
    exportAssetsCsv({
      search: search || undefined,
      category: category || undefined,
      status: status || undefined,
      sort: sort ?? undefined,
      order: order ?? undefined,
    });
  };

  const search = params.get('search') ?? '';
  const category = params.get('category') ?? '';
  const status = params.get('status') ?? '';
  const sort = params.get('sort') ?? null;
  const order = (params.get('order') as 'asc' | 'desc' | null) ?? null;

  const filters = {
    search: search || undefined,
    category: category || undefined,
    status: status || undefined,
    sort: sort ?? undefined,
    order: order ?? undefined,
  };
  const { data, isLoading } = useQuery({
    queryKey: ['assets', filters, page, pageSize],
    queryFn: () => listAssets({ ...filters, limit: pageSize, offset: (page - 1) * pageSize }),
  });

  // any filter change resets to page 1
  useEffect(() => {
    setPage(1);
  }, [search, category, status, sort, order]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setParams(next, { replace: true });
  };

  const onSortChange = (s: { key: string; dir: 'asc' | 'desc' } | null) => {
    const next = new URLSearchParams(params);
    if (s) {
      next.set('sort', s.key);
      next.set('order', s.dir);
    } else {
      next.delete('sort');
      next.delete('order');
    }
    setParams(next, { replace: true });
  };

  const columns: Column<Asset>[] = [
    {
      key: 'asset_tag',
      header: 'Tag',
      sortable: true,
      sortKey: 'tag',
      render: (a) => <span className="font-mono text-xs text-accent">{a.asset_tag}</span>,
    },
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (a) => <span className="font-medium text-primary">{a.name}</span>,
    },
    { key: 'category', header: 'Category', sortable: true },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (a) => <AssetStatusBadge status={a.status} />,
    },
    {
      key: 'serial_number',
      header: 'Serial',
      render: (a) => (
        <span className="font-mono text-xs text-secondary">{a.serial_number ?? '—'}</span>
      ),
    },
    {
      key: 'assigned_user_name',
      header: 'Assigned To',
      render: (a) => <span className="text-secondary">{a.assigned_user_name ?? '—'}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-primary">Assets</h1>
          <p className="mt-0.5 text-sm text-secondary">
            {data?.total ?? 0} asset{data?.total === 1 ? '' : 's'} in the registry
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setImportOpen(true);
              setFile(null);
              setImportResult(null);
            }}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-edge2 bg-surface px-3 text-sm text-secondary transition-colors hover:bg-elevated hover:text-primary"
          >
            <FileUp className="h-4 w-4" /> Import
          </button>
          <button
            type="button"
            onClick={onExport}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-edge2 bg-surface px-3 text-sm text-secondary transition-colors hover:bg-elevated hover:text-primary"
          >
            <Download className="h-4 w-4" /> Export
          </button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              className={`${inputCls} w-56 pl-9`}
              placeholder="Search assets…"
              value={search}
              onChange={(e) => update('search', e.target.value)}
            />
          </div>
          <Select
            className="w-auto min-w-[130px]"
            value={category}
            onChange={(v) => update('category', v)}
            options={[
              { value: '', label: 'All Categories' },
              ...ASSET_CATEGORIES.map((c) => ({ value: c, label: c.replace('_', ' ') })),
            ]}
          />
          <Select
            className="w-auto min-w-[130px]"
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
        sort={sort ? { key: sort, dir: order === 'desc' ? 'desc' : 'asc' } : null}
        onSortChange={onSortChange}
        loading={isLoading}
        emptyMessage="No assets match the current filters."
        onRowClick={(a) => setSelected(a)}
      />

      <AssetSpecModal asset={selected} onClose={() => setSelected(null)} />

      {importOpen && (
        <Modal title="Import assets (CSV)" onClose={() => setImportOpen(false)}>
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              Upload a CSV with columns{' '}
              <code className="rounded bg-elevated px-1 py-0.5 font-mono text-xs text-primary">
                name, category, serial_number
              </code>{' '}
              (required) plus optional{' '}
              <code className="rounded bg-elevated px-1 py-0.5 font-mono text-xs text-primary">
                status, purchase_date, warranty_expiry, asset_tag, assigned_to, specs
              </code>
              . Valid rows are imported; invalid rows are reported per line.
            </p>
            <button
              type="button"
              onClick={onDownloadTemplate}
              className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
            >
              <Download className="h-4 w-4" /> Download template CSV
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setImportResult(null);
              }}
              className="block w-full cursor-pointer rounded-lg border border-dashed border-edge2 bg-elevated/40 p-3 text-sm text-secondary file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:text-white hover:border-accent/50"
            />
            {file && (
              <p className="text-xs text-secondary">
                Selected: <span className="font-medium text-primary">{file.name}</span> (
                {(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
            <button
              type="button"
              onClick={onImport}
              disabled={!file || importMutation.isPending}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-opacity disabled:opacity-50"
            >
              {importMutation.isPending ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" /> Importing…
                </>
              ) : (
                <>
                  <FileUp className="h-4 w-4" /> Import {file ? file.name : 'CSV'}
                </>
              )}
            </button>
            {importMutation.isError && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {(importMutation.error as Error).message}
              </p>
            )}
            {importResult && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {importResult.imported} asset{importResult.imported === 1 ? '' : 's'} imported
                  {importResult.failed.length > 0 &&
                    `, ${importResult.failed.length} row${importResult.failed.length === 1 ? '' : 's'} failed`}
                </div>
                {importResult.failed.length > 0 && (
                  <div className="max-h-56 space-y-2 overflow-y-auto">
                    {importResult.failed.map((f) => (
                      <div
                        key={f.row}
                        className="rounded-lg border border-red-500/20 bg-elevated/60 px-3 py-2 text-xs"
                      >
                        <div className="flex items-start gap-2">
                          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                          <div className="min-w-0">
                            <p className="font-medium text-primary">
                              Row {f.row} — {f.error}
                            </p>
                            {Object.keys(f.data).length > 0 && (
                              <p className="mt-0.5 truncate text-secondary">
                                {Object.entries(f.data)
                                  .map(([k, v]) => `${k}: ${v}`)
                                  .join(' · ')}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
