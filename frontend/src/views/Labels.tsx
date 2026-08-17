import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { CheckCircle2, Download, Printer, Search } from 'lucide-react';
import { listAssets } from '@/api/client';
import type { Asset } from '@/api/types';
import { payloadFor } from '@/lib/qr';
import Select from '@/components/Select';

/**
 * Phase 2 (#65): printable QR label sheets + audit-run target picker.
 * Labels carry the compact ITMS payload (see lib/qr.ts) so /scan can
 * look the asset up even when the payload is truncated to fit tiny labels.
 */
const STATUS_OPTIONS = ['ALL', 'IN_STOCK', 'ASSIGNED', 'MAINTENANCE', 'RETIRED'];

export default function Labels() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [printing, setPrinting] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const assets = useQuery({
    queryKey: ['assets', search, category, status],
    queryFn: () =>
      listAssets({
        search: search || undefined,
        category: category === 'ALL' ? undefined : category,
        status: status === 'ALL' ? undefined : status,
        limit: 500,
      }),
  });

  const rows: Asset[] = assets.data?.items ?? [];
  const selectedRows = rows.filter((a) => selected.has(a.id));
  const nonRetired = rows.filter((a) => a.status !== 'RETIRED');

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startRun = () => {
    const targets = rows.filter((a) => selected.has(a.id) && a.status !== 'RETIRED').map((a) => ({ id: a.id, tag: a.asset_tag, name: a.name }));
    try {
      localStorage.setItem('itms-audit-targets', JSON.stringify(targets));
      localStorage.removeItem('itms-audit-run');
    } catch { /* storage unavailable */ }
    window.location.href = '/scan';
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold">QR Labels</h1>
        <p className="mt-0.5 text-xs text-muted">
          Pick assets and print an A4 label sheet, or start an audit run for the factory floor. Labels embed tag + serial — scan them with the{' '}
          <span className="text-accent">Scan</span> page.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-edge bg-surface/60 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tag / name / serial…"
            className="h-9 w-full rounded-lg border border-edge2 bg-base pl-9 pr-3 text-sm outline-none focus:border-accent"
          />
        </div>
        <Select value={category} onChange={setCategory} options={[{ value: 'ALL', label: 'All categories' }, ...getCategories(rows).map((c) => ({ value: c, label: c }))]} />
        <Select value={status} onChange={setStatus} options={STATUS_OPTIONS.map((s) => ({ value: s, label: s === 'ALL' ? 'All statuses' : s }))} />
      </div>

      <div className="overflow-hidden rounded-xl border border-edge">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface/80 text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  className="accent-indigo-500"
                  checked={nonRetired.length > 0 && selected.size === nonRetired.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(nonRetired.map((a) => a.id)) : new Set())}
                />
              </th>
              <th className="px-3 py-2">Tag</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Serial</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge/60">
            {rows.map((a) => (
              <tr key={a.id} className={selected.has(a.id) ? 'bg-accent/5' : undefined}>
                <td className="px-3 py-2">
                  <input type="checkbox" className="accent-indigo-500" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                </td>
                <td className="px-3 py-2 font-mono text-xs">{a.asset_tag}</td>
                <td className="px-3 py-2">{a.name}</td>
                <td className="px-3 py-2 text-xs text-secondary">{a.category}</td>
                <td className="px-3 py-2 text-xs text-secondary">{a.status}</td>
                <td className="px-3 py-2 text-right font-mono text-[11px] text-muted">{a.serial_number ?? '—'}</td>
              </tr>
            ))}
            {!assets.isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-muted">No assets match — widen the filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setPrinting(true)}
          disabled={selectedRows.length === 0}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
        >
          <Printer className="h-4 w-4" /> Print labels ({selectedRows.length})
        </button>
        <button
          onClick={startRun}
          disabled={selectedRows.length === 0}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-edge2 px-4 text-xs font-medium text-secondary hover:bg-elevated disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" /> Start audit run → Scan
        </button>
        <p className="text-[11px] text-muted">Labels: 38×21 mm (A4 3×8 grid) · audit guidance: 5% monthly, 100% annual, &lt;3% ghost target</p>
      </div>

      {printing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 print:static print:bg-transparent print:p-0">
          <div ref={printRef} className="w-full max-w-2xl rounded-xl bg-base p-5 print:w-auto print:max-w-none print:rounded-none print:p-0 print:shadow-none">
            <div className="mb-3 flex items-center justify-between print:hidden">
              <h2 className="text-sm font-semibold">Label sheet — {selectedRows.length} assets</h2>
              <div className="flex gap-2">
                <button onClick={() => window.print()} className="h-8 rounded-lg bg-accent px-3 text-xs font-semibold text-white hover:bg-accent/90">Print</button>
                <button onClick={() => setPrinting(false)} className="h-8 rounded-lg border border-edge2 px-3 text-xs text-secondary hover:bg-elevated">Close</button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 print:gap-3">
              {selectedRows.map((a) => (
                <LabelCard key={a.id} asset={a} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getCategories(rows: Asset[]): string[] {
  return [...new Set(rows.map((r) => r.category))].sort();
}

function LabelCard({ asset }: { asset: Asset }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, payloadFor(asset), { width: 92, margin: 1, color: { dark: '#111827', light: '#ffffff' } }).catch(() => {});
    }
  }, [asset]);

  const download = async () => {
    try {
      setDownloading(true);
      const url = await QRCode.toDataURL(payloadFor(asset), { width: 512, margin: 2 });
      const a = document.createElement('a');
      a.href = url;
      a.download = `${asset.asset_tag}.png`;
      a.click();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-edge2 p-2 print:break-inside-avoid" title={asset.serial_number ?? ''}>
      <canvas ref={canvasRef} className="h-[46px] w-[46px] shrink-0 print:h-[92px] print:w-[92px]" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[10px] font-semibold print:text-xs">{asset.asset_tag}</div>
        <div className="truncate text-[10px] text-secondary print:text-[11px]">{asset.name}</div>
        <div className="truncate font-mono text-[9px] text-muted print:hidden">{asset.serial_number ?? ''}</div>
        <button onClick={download} disabled={downloading} className="mt-0.5 hidden items-center gap-1 text-[10px] text-accent hover:underline print:hidden sm:flex">
          <Download className="h-3 w-3" /> PNG
        </button>
      </div>
    </div>
  );
}