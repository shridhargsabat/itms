import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Download, FileUp, PackageSearch, Search, Tags, Trash2, TriangleAlert, UserCog, X } from 'lucide-react';
import {
  bulkAssignAssets,
  bulkDeleteAssets,
  bulkUpdateAssetStatus,
  exportAssetsCsv,
  getCachedUser,
  importAssetsCsv,
  listAssets,
  listLocations,
  listUsers,
} from '@/api/client';
import type { ImportResult } from '@/api/client';
import { ASSET_CATEGORIES, ASSET_STATUSES } from '@/api/types';
import type { Asset } from '@/api/types';
import AssetSpecModal from '@/components/AssetSpecModal';
import DataTable, { type Column } from '@/components/DataTable';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { Button } from '@/components/Button';
import AddAssetButton from '@/components/AddAssetButton';
import PageHeader from '@/components/PageHeader';
import FilterBar from '@/components/FilterBar';
import EmptyState from '@/components/EmptyState';
import { AssetStatusBadge } from '@/components/TicketBadge';
import { inputCls } from '@/lib/utils';
import { useServerPagination } from '@/lib/usePagination';

type BulkAction = 'status' | 'assign' | 'delete' | null;

export default function Assets() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<Asset | null>(null);
  const { page, pageSize, setPage, setPageSize, reset, offset } = useServerPagination(20);
  const [importOpen, setImportOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction>(null);
  const [bulkStatus, setBulkStatus] = useState('IN_STOCK');
  const [bulkUserId, setBulkUserId] = useState('');
  // Admin-only mutations (backend gated since PR #96) — hide the controls for other roles.
  const isAdmin = getCachedUser()?.role === 'ADMIN';

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => listUsers({ limit: 1000 }),
    enabled: bulkAction === 'assign',
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['assets'] });
    qc.invalidateQueries({ queryKey: ['metrics'] });
    qc.invalidateQueries({ queryKey: ['cmdb'] });
  };

  const bulkStatusMutation = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: string }) => bulkUpdateAssetStatus(ids, status),
    onSuccess: () => {
      setBulkAction(null);
      setSelectedIds(new Set());
      refresh();
    },
  });
  const bulkAssignMutation = useMutation({
    mutationFn: ({ ids, userId }: { ids: string[]; userId: string | null }) => bulkAssignAssets(ids, userId),
    onSuccess: () => {
      setBulkAction(null);
      setSelectedIds(new Set());
      refresh();
    },
  });
  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteAssets(ids),
    onSuccess: () => {
      setBulkAction(null);
      setSelectedIds(new Set());
      refresh();
    },
  });

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
      location_id: location || undefined,
      sort: sort ?? undefined,
      order: order ?? undefined,
    });
  };

  const search = params.get('search') ?? '';
  const category = params.get('category') ?? '';
  const status = params.get('status') ?? '';
  const location = params.get('location') ?? '';
  const sort = params.get('sort') ?? null;
  const order = (params.get('order') as 'asc' | 'desc' | null) ?? null;

  const locationsQ = useQuery({ queryKey: ['locations'], queryFn: () => listLocations() });

  const filters = {
    search: search || undefined,
    category: category || undefined,
    status: status || undefined,
    location_id: location || undefined,
    sort: sort ?? undefined,
    order: order ?? undefined,
  };
  const { data, isLoading } = useQuery({
    queryKey: ['assets', filters, page, pageSize],
    queryFn: () => listAssets({ ...filters, limit: pageSize, offset }),
  });

  // any filter change resets to page 1 + clears row selection
  useEffect(() => {
    reset();
    setSelectedIds(new Set());
  }, [search, category, status, location, sort, order]);

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

  const hasActiveFilters = Boolean(search || category || status || location);
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    ['search', 'category', 'status', 'location'].forEach((k) => next.delete(k));
    setParams(next, { replace: true });
  };

  const columns: Column<Asset>[] = [
    {
      key: 'asset_tag',
      header: 'Tag',
      sortable: true,
      sortKey: 'tag',
      render: (a) => <span className="whitespace-nowrap font-mono text-xs text-accent">{a.asset_tag}</span>,
    },
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (a) => <span className="font-medium text-primary">{a.name}</span>,
    },
    { key: 'category', header: 'Category', sortable: true },
    {
      key: 'location_name',
      header: 'Location',
      render: (a) => <span className="text-secondary">{a.location_name ?? '—'}</span>,
    },
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
        <span className="whitespace-nowrap font-mono text-xs text-secondary">{a.serial_number ?? '—'}</span>
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
      <PageHeader
        title="Assets"
        description={`${data?.total ?? 0} asset${data?.total === 1 ? '' : 's'} in the registry`}
        className="mb-0"
        actions={
          <>
            <AddAssetButton />
            {isAdmin && (
              <Button
                type="button"
                onClick={() => {
                  setImportOpen(true);
                  setFile(null);
                  setImportResult(null);
                }}
                variant="secondary"
                size="lg"
                leftIcon={<FileUp className="h-4 w-4" />}
              >
                Import
              </Button>
            )}
            <Button
              type="button"
              onClick={onExport}
              variant="secondary"
              size="lg"
              leftIcon={<Download className="h-4 w-4" />}
            >
              Export
            </Button>
          </>
        }
      />

      <FilterBar>
        <div className="relative min-w-[200px] basis-full flex-1 sm:max-w-xs sm:flex-none sm:basis-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            inputMode="search"
            className={`${inputCls} pl-9`}
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
        <Select
          className="w-auto min-w-[150px]"
          value={location}
          onChange={(v) => update('location', v)}
          options={[
            { value: '', label: 'All Locations' },
            ...(locationsQ.data ?? []).map((l) => ({
              value: l.id,
              label: [l.site, l.building, l.floor, l.room].filter(Boolean).join(' / ') || '—',
            })),
          ]}
        />
      </FilterBar>

      {selectedIds.size > 0 && (
        <div className="sticky top-[calc(2.8125rem+env(safe-area-inset-top))] z-30 -mx-6 -mt-5 flex flex-wrap items-center gap-2 glass-chrome border-x-0 border-t-0 px-6 py-2.5 lg:mx-0 lg:mt-0 lg:rounded-t-xl lg:border lg:px-4">
          <span className="text-sm font-medium text-primary">
            {selectedIds.size} selected
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => {
                setBulkStatus('IN_STOCK');
                setBulkAction('status');
              }}
              variant="secondary"
              size="sm"
              leftIcon={<Tags className="h-3.5 w-3.5" />}
            >
              Status…
            </Button>
            <Button
              type="button"
              onClick={() => {
                setBulkUserId('');
                setBulkAction('assign');
              }}
              variant="secondary"
              size="sm"
              leftIcon={<UserCog className="h-3.5 w-3.5" />}
            >
              Assign…
            </Button>
            <Button
              type="button"
              onClick={() => setBulkAction('delete')}
              variant="secondary"
              size="sm"
              className="border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            >
              Delete…
            </Button>
            <Button
              type="button"
              onClick={() => exportAssetsCsv({ ids: [...selectedIds] })}
              variant="secondary"
              size="sm"
              leftIcon={<Download className="h-3.5 w-3.5" />}
            >
              Export CSV
            </Button>
            <Button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              aria-label="Clear selection"
              variant="ghost"
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {!isLoading && (data?.items ?? []).length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="No assets found"
          description={
            hasActiveFilters
              ? 'No assets match the current filters.'
              : 'No assets in the registry yet. Add your first asset to get started.'
          }
          action={
            hasActiveFilters ? (
              <Button type="button" onClick={clearFilters} variant="secondary" size="lg">
                Clear filters
              </Button>
            ) : isAdmin ? (
              <AddAssetButton />
            ) : undefined
          }
        />
      ) : (
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          total={data?.total}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          sort={sort ? { key: sort, dir: order === 'desc' ? 'desc' : 'asc' } : null}
          onSortChange={onSortChange}
          loading={isLoading}
          emptyMessage="No assets match the current filters."
          onRowClick={(a) => setSelected(a)}
          selectedIds={isAdmin ? selectedIds : undefined}
          onSelectionChange={isAdmin ? setSelectedIds : undefined}
        />
      )}

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
            <Button
              type="button"
              onClick={onDownloadTemplate}
              variant="text"
              leftIcon={<Download className="h-4 w-4" />}
            >
              Download template CSV
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setImportResult(null);
              }}
              className="block w-full cursor-pointer rounded-lg glass-dense border-dashed p-3 text-sm text-secondary file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:text-on-accent hover:border-accent/50"
            />
            {file && (
              <p className="text-xs text-secondary">
                Selected: <span className="font-medium text-primary">{file.name}</span> (
                {(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                onClick={() => setImportOpen(false)}
                variant="secondary"
                size="lg"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={onImport}
                disabled={!file}
                loading={importMutation.isPending}
                variant="primary"
                size="lg"
                leftIcon={!importMutation.isPending ? <FileUp className="h-4 w-4" /> : undefined}
              >
                Import {file ? file.name : 'CSV'}
              </Button>
            </div>
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
                        className="rounded-lg glass-dense border-red-500/20 px-3 py-2 text-xs"
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

      {bulkAction === 'status' && (
        <Modal title={`Set status for ${selectedIds.size} asset${selectedIds.size === 1 ? '' : 's'}`} onClose={() => setBulkAction(null)}>
          <div className="space-y-4">
            <Select
              className="w-full"
              value={bulkStatus}
              onChange={setBulkStatus}
              options={ASSET_STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') }))}
            />
            <Button
              type="button"
              onClick={() => bulkStatusMutation.mutate({ ids: [...selectedIds], status: bulkStatus })}
              disabled={bulkStatusMutation.isPending}
              loading={bulkStatusMutation.isPending}
              fullWidth
              variant="primary"
              size="lg"
            >
              Update status
            </Button>
            {bulkStatusMutation.isError && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {(bulkStatusMutation.error as Error).message}
              </p>
            )}
          </div>
        </Modal>
      )}

      {bulkAction === 'assign' && (
        <Modal title={`Assign ${selectedIds.size} asset${selectedIds.size === 1 ? '' : 's'}`} onClose={() => setBulkAction(null)}>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Select
                className="min-w-0 flex-1"
                value={bulkUserId}
                onChange={setBulkUserId}
                placeholder="Select user…"
                options={(usersData?.items ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
              />
              <Button
                type="button"
                onClick={() => bulkAssignMutation.mutate({ ids: [...selectedIds], userId: null })}
                disabled={bulkAssignMutation.isPending}
                variant="secondary"
                size="lg"
                className="shrink-0"
              >
                Unassign
              </Button>
            </div>
            <Button
              type="button"
              onClick={() => bulkAssignMutation.mutate({ ids: [...selectedIds], userId: bulkUserId || null })}
              disabled={!bulkUserId}
              loading={bulkAssignMutation.isPending}
              fullWidth
              variant="primary"
              size="lg"
            >
              Assign to user
            </Button>
            {bulkAssignMutation.isError && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {(bulkAssignMutation.error as Error).message}
              </p>
            )}
          </div>
        </Modal>
      )}

      {bulkAction === 'delete' && (
        <Modal title={`Delete ${selectedIds.size} asset${selectedIds.size === 1 ? '' : 's'}?`} onClose={() => setBulkAction(null)}>
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              This permanently removes {selectedIds.size} asset{selectedIds.size === 1 ? '' : 's'} from the registry. Tickets keep their history (asset link cleared); CMDB relationships are removed. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => setBulkAction(null)}
                variant="secondary"
                size="lg"
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => bulkDeleteMutation.mutate([...selectedIds])}
                disabled={bulkDeleteMutation.isPending}
                loading={bulkDeleteMutation.isPending}
                variant="danger"
                size="lg"
                className="flex-1"
                leftIcon={!bulkDeleteMutation.isPending ? <Trash2 className="h-4 w-4" /> : undefined}
              >
                Delete
              </Button>
            </div>
            {bulkDeleteMutation.isError && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {(bulkDeleteMutation.error as Error).message}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
