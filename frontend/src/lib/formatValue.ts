/**
 * Serialize an arbitrary request-detail value for display in RequestCard
 * answer chips. Guarantees no `[object Object]` leaks into the UI.
 */
export function formatDetailValue(v: unknown): string {
  return formatRec(v, 0);
}

const MAX_DEPTH = 2;

function formatRec(v: unknown, depth: number): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (depth >= MAX_DEPTH) return '';
  if (Array.isArray(v)) {
    return v
      .map((item) => formatRec(item, depth + 1))
      .filter((s) => s !== '')
      .join(', ');
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    for (const key of ['name', 'label', 'title']) {
      if (typeof obj[key] === 'string' && (obj[key] as string) !== '') return obj[key] as string;
    }
    return Object.entries(obj)
      .map(([k, val]) => {
        const rendered = formatRec(val, depth + 1);
        return rendered === '' ? '' : `${k}: ${rendered}`;
      })
      .filter((s) => s !== '')
      .join(', ');
  }
  return '';
}
