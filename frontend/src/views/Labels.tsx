import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { CheckCircle2, Download, Printer, Search } from 'lucide-react';
import { listAssets } from '@/api/client';
import type { Asset } from '@/api/types';
import { payloadFor } from '@/lib/qr';
import Select from '@/components/Select';
import Modal from '@/components/Modal';
import DataTable, { type Column } from '@/components/DataTable';
import { useClientPagination } from '@/lib/usePagination';
import { LabelPrinter, type LabelPrinterStage } from '@/components/LabelPrinter';

/**
 * Phase 2 (#65): printable QR label sheets + audit-run target picker.
 * Labels carry the compact ITMS payload (see lib/qr.ts) so /scan can
 * look the asset up even when the payload is truncated to fit tiny labels.
 *
 * feat/label-printer: single-row 🖨️ icon → animated label-print modal.
 * feat/label-printer-multi: "Print labels (N)" now runs the SAME printer
 * animation with a label-grid paper, then auto-prints only the sheet
 * (.print-area isolation in index.css). Static batch modal removed.
 */
const STATUS_OPTIONS = ['ALL', 'IN_STOCK', 'ASSIGNED', 'MAINTENANCE', 'RETIRED'];

const PRINT_STATUS: Record<LabelPrinterStage, string> = {
  processing: 'Generating QR label…',
  printing: 'Printing label…',
  complete: 'Label printed',
};

const BATCH_STATUS: Record<LabelPrinterStage, string> = {
  processing: 'Generating QR labels…',
  printing: 'Printing labels…',
  complete: 'Labels printed',
};

/** Cap the animation's paper preview so a huge selection stays tidy; the
    actual print sheet always contains every selected asset. */
const PAPER_PREVIEW_MAX = 12;

export default function Labels() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [printAsset, setPrintAsset] = useState<Asset | null>(null);
  const [printStage, setPrintStage] = useState<LabelPrinterStage>('processing');
  /** Bumped on every print click — react-query returns the SAME asset object
      ref for a cached row, so setPrintAsset alone wouldn't re-trigger the effect. */
  const [printRun, setPrintRun] = useState(0);
  const [printBatch, setPrintBatch] = useState<Asset[] | null>(null);
  const [batchStage, setBatchStage] = useState<LabelPrinterStage>('processing');
  const [batchRun, setBatchRun] = useState(0);

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

  const allRows: Asset[] = assets.data?.items ?? [];
  // Client-side pagination of the fetched list (batch-selection page — the
  // full list is kept for the selection count below).
  const { page, pageSize, setPage, setPageSize, pageRows } = useClientPagination(allRows, 50);
  const rows = pageRows;
  // Selection must span ALL fetched rows, not just the current page, or the
  // "Print labels (N)" / "Start audit run" counts silently drop off-page
  // selections (the Set persists across page changes).
  const selectedRows = assets.data?.items.filter((a) => selected.has(a.id)) ?? [];

  const columns: Column<Asset>[] = [
    {
      key: 'asset_tag',
      header: 'Tag',
      render: (a) => <span className="font-mono text-xs">{a.asset_tag}</span>,
    },
    { key: 'name', header: 'Name' },
    {
      key: 'category',
      header: 'Category',
      render: (a) => <span className="text-xs text-secondary">{a.category}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (a) => <span className="text-xs text-secondary">{a.status}</span>,
    },
    {
      key: 'serial_number',
      header: 'Serial',
      className: 'text-right',
      render: (a) => <span className="font-mono text-[11px] text-muted">{a.serial_number ?? '—'}</span>,
    },
    {
      key: 'print',
      header: 'Print',
      className: 'text-right',
      render: (a) => (
        <button
          type="button"
          onClick={() => {
            setPrintAsset(a);
            setPrintRun((n) => n + 1);
          }}
          aria-label={`Print label for ${a.asset_tag}`}
          title="Animated single-label print"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-secondary transition-colors hover:bg-elevated hover:text-primary"
        >
          <Printer className="h-3.5 w-3.5" />
        </button>
      ),
    },
  ];

  /* Single-label print: processing → printing (feed animation ~1.75s) →
     complete → auto window.print(). Only the .print-area renders on paper.
     printRun dep restarts the chain even for re-prints of the same asset. */
  useEffect(() => {
    if (!printAsset) return;
    setPrintStage('processing');
    const t1 = setTimeout(() => setPrintStage('printing'), 650);
    const t2 = setTimeout(() => setPrintStage('complete'), 650 + 1750);
    const t3 = setTimeout(() => window.print(), 650 + 1750 + 350);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [printAsset, printRun]);

  /* Batch print: same stage machine; the paper shows a label-grid preview. */
  useEffect(() => {
    if (!printBatch || printBatch.length === 0) return;
    setBatchStage('processing');
    const t1 = setTimeout(() => setBatchStage('printing'), 650);
    const t2 = setTimeout(() => setBatchStage('complete'), 650 + 1750);
    const t3 = setTimeout(() => window.print(), 650 + 1750 + 350);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [printBatch, batchRun]);

  const closePrint = () => {
    setPrintAsset(null);
    setPrintStage('processing');
  };

  const closeBatch = () => {
    setPrintBatch(null);
    setBatchStage('processing');
  };

  const startRun = () => {
    // Scan targets span all selected rows across pages, not just the page.
    const targets = (assets.data?.items ?? [])
      .filter((a) => selected.has(a.id) && a.status !== 'RETIRED')
      .map((a) => ({ id: a.id, tag: a.asset_tag, name: a.name }));
    try {
      localStorage.setItem('itms-audit-targets', JSON.stringify(targets));
      localStorage.removeItem('itms-audit-run');
    } catch {
      /* storage unavailable */
    }
    window.location.href = '/scan';
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold">QR Labels</h1>
        <p className="mt-0.5 text-xs text-muted">
          Pick assets and print an A4 label sheet, start an audit run for the factory floor, or use the print icon on a row for an animated single-label print. Labels embed tag + serial — scan them with the{' '}
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

      <DataTable
        columns={columns}
        rows={rows}
        selectedIds={selected}
        onSelectionChange={setSelected}
        isRowSelectable={(a) => a.status !== 'RETIRED'}
        loading={assets.isLoading}
        emptyMessage="No assets match — widen the filters."
        page={page}
        pageSize={pageSize}
        total={allRows.length}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => {
            setPrintBatch(selectedRows);
            setBatchRun((n) => n + 1);
          }}
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

      {printAsset && (
        <Modal title={`Print label — ${printAsset.asset_tag}`} onClose={closePrint}>
          <div className="flex flex-col items-center gap-4">
            <LabelPrinter.Root stage={printStage}>
              <LabelPrinter.Machine>
                <LabelPrinter.Header>
                  <span className="mt-1 font-mono text-[10px] uppercase tracking-widest text-secondary">
                    ITMS · Label printer
                  </span>
                </LabelPrinter.Header>
                <LabelPrinter.Screen>
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-100">{printAsset.asset_tag}</p>
                      <p className="truncate text-[10px] text-slate-400">{printAsset.name}</p>
                    </div>
                    <LabelPrinter.Status>{PRINT_STATUS[printStage]}</LabelPrinter.Status>
                  </div>
                </LabelPrinter.Screen>
              </LabelPrinter.Machine>
              <LabelPrinter.Output>
                <LabelPrinter.Paper className="flex items-center gap-3">
                  <QrCanvas asset={printAsset} width={112} className="h-16 w-16 shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm font-bold">{printAsset.asset_tag}</div>
                    <div className="truncate text-[11px] text-slate-600">{printAsset.name}</div>
                    {printAsset.serial_number ? (
                      <div className="truncate font-mono text-[10px] text-slate-400">{printAsset.serial_number}</div>
                    ) : null}
                  </div>
                </LabelPrinter.Paper>
              </LabelPrinter.Output>
            </LabelPrinter.Root>

            {printStage === 'complete' && (
              <button
                onClick={() => window.print()}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-semibold text-white hover:bg-accent/90"
              >
                <Printer className="h-4 w-4" /> Print again
              </button>
            )}
          </div>
        </Modal>
      )}

      {printBatch && printBatch.length > 0 && (
        <Modal title={`Print labels — ${printBatch.length} assets`} onClose={closeBatch}>
          <div className="flex flex-col items-center gap-4">
            <LabelPrinter.Root stage={batchStage}>
              <LabelPrinter.Machine>
                <LabelPrinter.Header>
                  <span className="mt-1 font-mono text-[10px] uppercase tracking-widest text-secondary">
                    ITMS · Label printer
                  </span>
                </LabelPrinter.Header>
                <LabelPrinter.Screen>
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-100">
                        {printBatch.length} label{printBatch.length === 1 ? '' : 's'} selected
                      </p>
                      <p className="truncate text-[10px] text-slate-400">A4 sheet — 38×21 mm labels</p>
                    </div>
                    <LabelPrinter.Status>{BATCH_STATUS[batchStage]}</LabelPrinter.Status>
                  </div>
                </LabelPrinter.Screen>
              </LabelPrinter.Machine>
              <LabelPrinter.Output className="h-80">
                <LabelPrinter.Paper className="w-full">
                  <div className="grid grid-cols-3 gap-x-3 gap-y-2">
                    {printBatch.slice(0, PAPER_PREVIEW_MAX).map((a) => (
                      <div key={a.id} className="flex min-w-0 items-center gap-1.5">
                        <QrCanvas asset={a} width={64} className="h-9 w-9 shrink-0" />
                        <div className="min-w-0">
                          <div className="truncate font-mono text-[9px] font-bold">{a.asset_tag}</div>
                          <div className="truncate text-[8px] text-slate-500">{a.name}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {printBatch.length > PAPER_PREVIEW_MAX && (
                    <p className="mt-2 text-center font-mono text-[10px] text-slate-500">
                      … and {printBatch.length - PAPER_PREVIEW_MAX} more
                    </p>
                  )}
                </LabelPrinter.Paper>
              </LabelPrinter.Output>
            </LabelPrinter.Root>

            {batchStage === 'complete' && (
              <button
                onClick={() => window.print()}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-semibold text-white hover:bg-accent/90"
              >
                <Printer className="h-4 w-4" /> Print again
              </button>
            )}
          </div>
        </Modal>
      )}

      {printAsset &&
        createPortal(
          <div className="print-area hidden print:block">
            <div className="flex items-center gap-3 p-2">
              <QrCanvas asset={printAsset} width={92} className="h-[92px] w-[92px]" />
              <div className="min-w-0">
                <div className="font-mono text-sm font-bold">{printAsset.asset_tag}</div>
                <div className="text-xs">{printAsset.name}</div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {printBatch && printBatch.length > 0 &&
        createPortal(
          <div className="print-area hidden print:block">
            <div className="grid grid-cols-3 gap-3 p-2">
              {printBatch.map((a) => (
                <LabelCard key={a.id} asset={a} />
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function getCategories(rows: Asset[]): string[] {
  return [...new Set(rows.map((r) => r.category))].sort();
}

/** Renders an asset's QR payload onto a canvas; CSS controls display size. */
function QrCanvas({
  asset,
  width,
  className,
}: {
  asset: Asset;
  width: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, payloadFor(asset), {
        width,
        margin: 1,
        color: { dark: '#111827', light: '#ffffff' },
      }).catch(() => {});
    }
  }, [asset, width]);

  return <canvas ref={canvasRef} className={className} />;
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