import { describe, expect, it } from 'vitest';
import { licenseDaysLeft, topExpiringAlerts } from './chartData';

describe('chartData', () => {
  it('sorts expiring alerts by days_left, nulls last', () => {
    const rows = topExpiringAlerts([
      { id: 'a', days_left: null } as never,
      { id: 'b', days_left: 12 } as never,
      { id: 'c', days_left: -2 } as never,
    ], 5).map((r) => r.id);
    expect(rows).toEqual(['c', 'b', 'a']);
  });
  it('computes license days-left like Licenses view', () => {
    expect(licenseDaysLeft(null)).toBeNull();
  });
});
