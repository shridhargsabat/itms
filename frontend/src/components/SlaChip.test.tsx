import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SlaChip from './SlaChip';

afterEach(cleanup);

function hoursFromNow(h: number) {
  return new Date(Date.now() + h * 3_600_000).toISOString();
}

it('uses light-readable text with dark-mode fallback in every state', () => {
  vi.useFakeTimers();
  try {
    // >50% left: emerald
    const { unmount: u1 } = render(<SlaChip dueAt={hoursFromNow(20)} policyHours={24} />);
    const ok = screen.getByText(/SLA /);
    expect(ok.className).toContain('text-emerald-700');
    expect(ok.className).toContain('dark:text-emerald-400');
    u1();
    // <=50% left: amber
    const { unmount: u2 } = render(<SlaChip dueAt={hoursFromNow(10)} policyHours={24} />);
    const warn = screen.getByText(/SLA /);
    expect(warn.className).toContain('text-amber-700');
    expect(warn.className).toContain('dark:text-amber-400');
    u2();
    // overdue: red
    render(<SlaChip dueAt={hoursFromNow(-1)} policyHours={24} />);
    const bad = screen.getByText(/OVERDUE /);
    expect(bad.className).toContain('text-red-700');
    expect(bad.className).toContain('dark:text-red-400');
  } finally {
    vi.useRealTimers();
  }
});
