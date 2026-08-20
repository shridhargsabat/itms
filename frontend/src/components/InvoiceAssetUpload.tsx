import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  FileUp,
  Loader2,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import {
  createAsset,
  linkInvoiceDocument,
  parseInvoicePdf,
} from '@/api/client';
import { ASSET_CATEGORIES } from '@/api/types';
import type { AssetCategory, InvoiceDraft, InvoiceParseResult } from '@/api/types';
import { Button } from '@/components/Button';
import Select from '@/components/Select';
import { inputCls, labelCls } from '@/lib/utils';
/** Editable per-line-item state carved out of an InvoiceDraft. */
interface DraftForm {
  name: string;
  serialNumber: string;
  category: AssetCategory | '';
  purchaseDate: string;
  warrantyExpiry: string;
  unitCost: number | null;
  confidence: Record<string, number>;
}

/** Map a backend category guess onto the 6 real AssetCategory values. */
function mapCategory(raw?: string | null): AssetCategory | '' {
  const up = (raw ?? '').trim().toUpperCase();
  return (ASSET_CATEGORIES as string[]).includes(up) ? (up as AssetCategory) : '';
}

/** Normalise a draft into an editable form, applying the category mapping. */
function toDraftForm(d: InvoiceDraft): DraftForm {
  return {
    name: d.name ?? '',
    serialNumber: d.serialNumber ?? '',
    category: mapCategory(d.category),
    purchaseDate: d.purchaseDate ?? '',
    warrantyExpiry: d.warrantyExpiry ?? '',
    unitCost: d.unitCost ?? null,
    confidence: d.confidence,
  };
}

/** Small per-field "auto" badge shown when the backend extracted the field. */
function ConfidenceBadge({ value }: { value: number | undefined }) {
  if (typeof value !== 'number') return null;
  return (
    <span
      title={`Confidence ${Math.round(value * 100)}%`}
      className="ml-2 inline-flex shrink-0 items-center rounded-full border border-edge bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-accent"
    >
      auto
    </span>
  );
}

interface Props {
  /** Invoked once the LAST draft has been created (all parsed items added). */
  onDone: () => void;
  /** Invoked when parsing failed / yielded nothing so the user can fill manually. */
  onSwitchManual: () => void;
}

export default function InvoiceAssetUpload({ onDone, onSwitchManual }: Props) {
  const qc = useQueryClient();

  // Parse phase.
  const parseMutation = useMutation({
    mutationFn: (file: File) => parseInvoicePdf(file),
  });

  // ONE hidden file input drives all three picker triggers ("Choose PDF",
  // "Try another file", "Replace PDF"). Programmatic .click() via this ref is
  // required: wrapping a <Button> (a real <button>) inside a <label> does NOT
  // forward the click to the input in browsers, so label-wrapped buttons were
  // dead (bug fixed 2026-08-20).
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickFile = () => fileInputRef.current?.click();
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFile(e.target.files?.[0]);
    // Reset the input value so picking the SAME file again re-fires onChange.
    e.target.value = '';
  };

  // Creation state, keyed per-draft so each 'Add this asset' is independent.
  const [drafts, setDrafts] = useState<DraftForm[]>([]);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [source, setSource] = useState<'digital' | 'ocr'>('digital');
  const [rawPreview, setRawPreview] = useState('');
  const [created, setCreated] = useState<boolean[]>([]);
  const [parseFailed, setParseFailed] = useState(false);

  const result = parseMutation.data;
  const uploading = parseMutation.isPending;

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    // Reset to the fresh-parse state each time a new file is chosen.
    setDrafts([]);
    setCreated([]);
    setParseFailed(false);
    setDocumentId(null);
    parseMutation.mutate(file, {
      onSuccess: (r: InvoiceParseResult) => {
        const usable = r.drafts && r.drafts.length > 0 && !r.parseError;
        if (!usable) {
          setParseFailed(true);
          return;
        }
        setDrafts(r.drafts.map(toDraftForm));
        setCreated(r.drafts.map(() => false));
        setDocumentId(r.documentId);
        setSource(r.source);
        setRawPreview(r.rawPreview);
      },
    });
  };

  const lastIndex = created.lastIndexOf(false);

  // Per-draft create mutation. On success we link the parsed PDF and, when the
  // just-created draft was the LAST uncreated one, close the modal.
  const createMutation = useMutation({
    mutationFn: async ({ draft, index }: { draft: DraftForm; index: number }) => {
      const createdAsset = await createAsset({
        name: draft.name,
        category: draft.category as AssetCategory,
        serial_number: draft.serialNumber || undefined,
        purchase_date: draft.purchaseDate || undefined,
        warranty_expiry: draft.warrantyExpiry || undefined,
      });
      if (documentId) {
        // Attach the parsed invoice PDF to the newly created asset.
        await linkInvoiceDocument(documentId, createdAsset.id);
      }
      return { index, createdAsset };
    },
    onSuccess: ({ index }) => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['metrics'] });
      setCreated((prev) => prev.map((c, i) => (i === index ? true : c)));
      if (lastIndex === index) {
        onDone();
      }
    },
  });

  const setField = (index: number, patch: Partial<DraftForm>) =>
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  // Error handling: a create error is tracked per draft index.
  const errorIndex = createMutation.error
    ? (() => {
        const v = createMutation.variables;
        return v ? v.index : null;
      })()
    : null;

  let body: React.ReactNode;

  if (uploading) {
    body = (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
        <p className="text-sm text-secondary">Parsing invoice…</p>
        <p className="max-w-xs text-xs text-muted">
          The backend will OCR / extract each line item and prep drafts for review.
        </p>
      </div>
    );
  } else if (parseFailed) {
    body = (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <TriangleAlert className="h-8 w-8 text-amber-400" />
        <p className="text-sm font-medium text-primary">
          Couldn't auto-extract this invoice — fill manually
        </p>
        <p className="max-w-sm text-xs text-muted">
          The PDF couldn't be parsed into line items. Switch back to the manual form
          and add the assets by hand.
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            leftIcon={<FileUp className="h-4 w-4" />}
            onClick={pickFile}
          >
            Try another file
          </Button>
          <Button type="button" variant="primary" onClick={onSwitchManual}>
            Fill manually
          </Button>
        </div>
      </div>
    );
  } else if (drafts.length === 0) {
    body = (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-edge bg-elevated">
          <Upload className="h-6 w-6 text-accent" />
        </div>
        <p className="text-sm font-medium text-primary">Upload an invoice PDF</p>
        <p className="max-w-xs text-xs text-muted">
          Line items are extracted into editable drafts. Each draft becomes its own
          asset with the invoice attached.
        </p>
        <Button type="button" leftIcon={<FileUp className="h-4 w-4" />} onClick={pickFile}>
          Choose PDF
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="space-y-5">
        {result && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="rounded-full border border-edge bg-elevated px-2 py-0.5">
              {drafts.length} line item{drafts.length === 1 ? '' : 's'}
            </span>
            <span className="rounded-full border border-edge bg-elevated px-2 py-0.5">
              {source === 'digital' ? 'PDF text' : 'OCR'}
            </span>
            <Button
              type="button"
              variant="text"
              size="sm"
              className="ml-auto px-0"
              onClick={pickFile}
            >
              Replace PDF
            </Button>
          </div>
        )}

        {drafts.map((draft, i) => {
          const isCreated = created[i];
          const isLast = lastIndex === i;
          return (
            <div
              key={i}
              className="rounded-xl border border-edge bg-elevated/40 p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-secondary">
                  Line item {i + 1}
                </p>
                {isCreated ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Created
                  </span>
                ) : (
                  <span className="text-xs text-muted">not created yet</span>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <label className={labelCls}>
                    Name
                    <ConfidenceBadge value={draft.confidence?.name} />
                  </label>
                  <input
                    className={inputCls}
                    value={draft.name}
                    placeholder="e.g. Dell XPS 15"
                    onChange={(e) => setField(i, { name: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelCls}>
                    Serial Number
                    <ConfidenceBadge value={draft.confidence?.serialNumber} />
                  </label>
                  <input
                    className={inputCls}
                    value={draft.serialNumber}
                    placeholder="Optional"
                    onChange={(e) => setField(i, { serialNumber: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelCls}>
                    Category
                    <ConfidenceBadge value={draft.confidence?.category} />
                  </label>
                  <Select
                    className="w-full"
                    value={draft.category}
                    onChange={(v) => setField(i, { category: v as AssetCategory | '' })}
                    options={[
                      ...ASSET_CATEGORIES.map((c) => ({
                        value: c,
                        label: c.replace('_', ' '),
                      })),
                    ]}
                    placeholder={
                      draft.category ? undefined : 'Select category…'
                    }
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>
                      Purchase Date
                      <ConfidenceBadge value={draft.confidence?.purchaseDate} />
                    </label>
                    <input
                      type="date"
                      className={inputCls}
                      value={draft.purchaseDate}
                      onChange={(e) => setField(i, { purchaseDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      Warranty Expiry
                      <ConfidenceBadge value={draft.confidence?.warrantyExpiry} />
                    </label>
                    <input
                      type="date"
                      className={inputCls}
                      value={draft.warrantyExpiry}
                      onChange={(e) => setField(i, { warrantyExpiry: e.target.value })}
                    />
                  </div>
                </div>
                {draft.unitCost != null && (
                  <div>
                    <label className={labelCls}>Unit Cost</label>
                    <p className="rounded-lg border border-dashed border-edge bg-surface px-3 py-2 text-sm text-secondary">
                      <span className="font-medium text-primary">
                        {draft.unitCost.toLocaleString(undefined, {
                          style: 'currency',
                          currency: 'INR',
                        })}
                      </span>{' '}
                      <span className="text-xs text-muted">
                        (read from invoice — informational)
                      </span>
                    </p>
                  </div>
                )}
              </div>

              {isCreated ? (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-green-500/10 px-3 py-2 text-xs text-green-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Asset created and invoice attached.
                </div>
              ) : (
                <>
                  {createMutation.isError && errorIndex === i && (
                    <p className="mt-3 text-xs text-red-400">
                      {createMutation.error instanceof Error
                        ? createMutation.error.message
                        : 'Failed to create this asset.'}
                    </p>
                  )}
                  <div className="mt-3 flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => onSwitchManual()}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      disabled={!draft.name || !draft.category}
                      loading={createMutation.isPending && errorIndex === i}
                      leftIcon={isLast && <Upload className="h-4 w-4" />}
                      onClick={() => createMutation.mutate({ draft, index: i })}
                    >
                      {isLast ? 'Add this asset & finish' : 'Add this asset'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          );
        })}

        {rawPreview && (
          <details className="group rounded-lg border border-edge bg-elevated/40">
            <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs font-medium text-secondary">
              Extracted text
            </summary>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-edge px-3 py-2 text-xs text-muted">
              {rawPreview}
            </pre>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleInputChange}
      />
      {body}
    </div>
  );
}
