import type { WarrantyAlert } from '@/api/types';

/**
 * Top-n alerts by urgency: days_left ascending (expired, i.e. days_left < 0,
 * first), rows with unknown days_left (null) last.
 */
export function topExpiringAlerts(alerts: WarrantyAlert[], n: number): WarrantyAlert[] {
  return [...alerts]
    .sort((a, b) => {
      if (a.days_left == null && b.days_left == null) return 0;
      if (a.days_left == null) return 1;
      if (b.days_left == null) return -1;
      return a.days_left - b.days_left;
    })
    .slice(0, n);
}

/**
 * Whole days from today (local midnight) to the expiry date.
 * Same day-math as `daysLeft` in `src/views/Licenses.tsx`.
 */
export function licenseDaysLeft(expiry_date: string | null): number | null {
  if (!expiry_date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry_date + 'T00:00:00');
  return Math.round((exp.getTime() - today.getTime()) / 86400000);
}
