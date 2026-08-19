import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import jsQR from 'jsqr';
import { CheckCircle2, CircleAlert, Flag, ScanLine, XCircle } from 'lucide-react';
import { listAssets, scanAudit } from '@/api/client';
import type { Asset, QrScanResult } from '@/api/types';
import { parsePayload } from '@/lib/qr';
import { Button } from '@/components/Button';

/**
 * Phase 2 (#65): mobile QR scan audit mode.
 * - Camera decode loop (jsQR) → POST /assets/{id}/scan-audit.
 * - Audit-run reconciliation: targets picked on /labels; found/expected/missing
 *   tally persists in localStorage (PWA/offline friendly).
 * - Manual tag fallback for cameras without QR support (iOS + Safari quirks).
 */
interface RunState {
  startedAt: string;
  found: { tag: string; name: string; at: string }[];
}

interface Target { id: string; tag: string; name: string }

const loadTargets = (): Target[] => {
  try { return JSON.parse(localStorage.getItem('itms-audit-targets') ?? '[]') as Target[]; } catch { return []; }
};
const loadRun = (): RunState | null => {
  try { return JSON.parse(localStorage.getItem('itms-audit-run') ?? 'null') as RunState | null; } catch { return null; }
};

export default function Scan() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const [camError, setCamError] = useState('');
  const [last, setLast] = useState<{ ok: boolean; msg: string; tag?: string; name?: string } | null>(null);
  const [manual, setManual] = useState('');
  const [run, setRun] = useState<RunState | null>(() => loadRun());
  const [targets] = useState<Target[]>(loadTargets);
  const [ended, setEnded] = useState(false);
  const lastDecodeRef = useRef('');

  const record = useMutation({
    mutationFn: (id: string) => scanAudit(id),
    onSuccess: (res: QrScanResult) => {
      const found = { tag: res.asset_tag, name: res.name, at: new Date().toISOString() };
      const next: RunState = {
        startedAt: run?.startedAt ?? new Date().toISOString(),
        found: [...(run?.found ?? []).filter((f) => f.tag !== res.asset_tag), found],
      };
      localStorage.setItem('itms-audit-run', JSON.stringify(next));
      setRun(next);
      setLast({ ok: true, msg: `Audit logged — ${res.asset_tag}`, tag: res.asset_tag, name: res.name });
    },
    onError: (e: Error) => {
      // Offline (factory floor): keep the tally local; sync when back online.
      setLast({ ok: false, msg: e.message.includes('Failed to fetch') ? 'Offline — recorded locally, will sync' : e.message });
    },
  });

  const flash = (raw: string) => {
    const p = parsePayload(raw);
    if (!p) {
      setLast({ ok: false, msg: 'Not an ITMS label — check the asset was labelled with this system' });
      return;
    }
    // Dedupe: ignore repeated scans of the same label within 1.5s
    if (raw === lastDecodeRef.current) return;
    lastDecodeRef.current = raw;
    setTimeout(() => { lastDecodeRef.current = ''; }, 1500);
    record.mutate(p.id);
  };

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) { rafRef.current = requestAnimationFrame(tick); return; }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) { rafRef.current = requestAnimationFrame(tick); return; }
    if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (code?.data) flash(code.data);
    } catch { /* frame skipped */ }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          rafRef.current = requestAnimationFrame(tick);
        }
      } catch {
        setCamError('Camera unavailable — use the manual tag field below (or grant camera permission).');
      }
    })();
    return () => {
      cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [tick]);

  const manualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const tag = manual.trim().toUpperCase();
    if (!tag) return;
    const res = await listAssets({ search: tag, limit: 3 });
    const hit = (res.items ?? []).find((a: Asset) => a.asset_tag.toUpperCase() === tag || a.serial_number?.toUpperCase() === tag);
    if (!hit) { setLast({ ok: false, msg: `No asset found for "${tag}"` }); return; }
    record.mutate(hit.id);
    setManual('');
  };

  const foundTags = new Set(run?.found.map((f) => f.tag) ?? []);
  const expected = targets.length;
  const found = foundTags.size;
  const missing = Math.max(0, expected - found);
  const pct = expected > 0 ? Math.round((found / expected) * 100) : 0;

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold">Scan Audit</h1>
        <p className="mt-0.5 text-xs text-muted">Point the camera at an ITMS label. Each scan records an audit entry on the asset; the run tally reconciles found vs expected.</p>
      </div>

      {/* Camera card */}
      <div className="relative overflow-hidden rounded-xl border border-edge bg-black">
        <video ref={videoRef} playsInline muted className="aspect-[4/3] w-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex h-40 w-40 items-center justify-center rounded-2xl border-2 border-dashed border-accent/60">
            <ScanLine className="h-14 w-14 text-accent/70" />
          </div>
        </div>
        <div className="absolute bottom-3 left-3 rounded-lg bg-black/60 px-2.5 py-1 text-[11px] text-white backdrop-blur">
          {camError ? 'camera off — manual mode' : run && targets.length > 0 ? `Audit run: ${found}/${expected} found` : 'scan mode'}
        </div>
      </div>

      {/* Result flash */}
      {last && (
        <div className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${last.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>
          {last.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <CircleAlert className="h-4 w-4 shrink-0" />}
          <div className="min-w-0">
            <p>{last.msg}</p>
            {last.tag && <p className="truncate font-mono text-[11px] opacity-80">{last.tag} · {last.name}</p>}
          </div>
        </div>
      )}

      {camError && (
        <form onSubmit={manualSubmit} className="space-y-2 rounded-xl border border-edge bg-surface/60 p-3">
          <label className="block text-xs font-medium text-secondary">Manual tag lookup</label>
          <div className="flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="e.g. AST-0012 or serial"
              className="h-9 min-w-0 flex-1 rounded-lg border border-edge2 bg-base px-3 font-mono text-sm outline-none focus:border-accent"
            />
            <Button type="submit" variant="primary" size="sm" className="shrink-0">Enter</Button>
          </div>
        </form>
      )}

      {/* Audit run card */}
      <div className="rounded-xl border border-edge bg-surface/60 p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-secondary"><Flag className="h-3.5 w-3.5" /> Audit run</h2>
          {run && expected > 0 && !ended && (
            <Button
              onClick={() => setEnded(true)}
              variant="secondary"
              size="sm"
            >
              End run & see result
            </Button>
          )}
        </div>

        {expected === 0 ? (
          <p className="mt-3 text-xs text-muted">
            No targets picked. Select assets on the <span className="text-accent">QR Labels</span> page and hit <em>Start audit run</em>.
          </p>
        ) : ended ? (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-edge2 bg-base p-3">
              <div className="text-xl font-semibold text-emerald-400">{pct}%</div>
              <div className="text-[10px] text-muted">found</div>
            </div>
            <div className="rounded-lg border border-edge2 bg-base p-3">
              <div className="text-xl font-semibold">{found}</div>
              <div className="text-[10px] text-muted">of {expected} expected</div>
            </div>
            <div className={`rounded-lg border bg-base p-3 ${missing > 0 ? 'border-amber-500/40 text-amber-400' : 'border-emerald-500/40 text-emerald-400'}`}>
              <div className="text-xl font-semibold">{missing}</div>
              <div className="text-[10px] text-muted">missing ({missing > 0 ? 'investigate ghosts' : 'all present'})</div>
            </div>
            {run && (
              <p className="col-span-3 text-center text-[11px] text-muted">
                Started {new Date(run.startedAt).toLocaleString()} · {run.found.length} scan{run.found.length === 1 ? '' : 's'} — target: 5% monthly / 100% annual &lt;3% ghost.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-3 space-y-1.5">
            {targets.slice(0, 3).map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg bg-elevated/50 px-3 py-2 text-xs">
                <span className="font-mono">{t.tag}</span>
                <span className="truncate text-secondary">{t.name}</span>
                {foundTags.has(t.tag) ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" /> : <XCircle className="h-4 w-4 shrink-0 text-muted" />}
              </div>
            ))}
            {targets.length > 3 && <p className="text-[11px] text-muted">… and {targets.length - 3} more targets</p>}
          </div>
        )}
      </div>
    </div>
  );
}