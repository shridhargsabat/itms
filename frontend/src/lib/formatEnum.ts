/** Title-case an UPPER_SNAKE enum for display: `SERVICE_REQUEST` → `Service Request`. */
export function formatEnum(v: string): string {
  if (!v) return '';
  return v
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
