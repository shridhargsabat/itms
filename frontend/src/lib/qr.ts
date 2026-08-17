import type { Asset } from '@/api/types';

/**
 * ITMS QR label payload — compact JSON kept stable so old labels keep working.
 * { v: 1, id: <uuid>, tag: <asset_tag> }
 */
export const QR_VERSION = 1;

export interface QrPayload {
  v: number;
  id: string;
  tag: string;
}

/** Encode an asset into the QR payload string (rendered by the qrcode lib). */
export function payloadFor(a: Pick<Asset, 'id' | 'asset_tag'>): string {
  return JSON.stringify({ v: QR_VERSION, id: a.id, tag: a.asset_tag });
}

/** Parse + validate a scanned payload; null when it's not an ITMS label. */
export function parsePayload(raw: string): QrPayload | null {
  try {
    const p = JSON.parse(raw) as QrPayload;
    if (typeof p === 'object' && p && p.v === QR_VERSION && typeof p.id === 'string' && typeof p.tag === 'string') {
      return p;
    }
  } catch {
    /* not JSON */
  }
  return null;
}
