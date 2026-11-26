import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('UX minors (issues 187/209/213)', () => {
  it('UX-13a (#187): chip and no-SLA text honour the 12px floor', () => {
    const { unmount } = render(<SlaChip dueAt={hoursFromNow(20)} policyHours={24} />);
    const chip = screen.getByText(/SLA /);
    expect(chip.className).toContain('text-xs');
    expect(chip.className).not.toContain('text-[10px]');
    unmount();

    render(<SlaChip dueAt={null} />);
    const none = screen.getByText('No SLA');
    expect(none.className).toContain('text-xs');
    expect(none.className).not.toContain('text-[10px]');
  });

  it('UX-35 (#209): resolved/closed tickets get one coherent neutral state, no dash chip', () => {
    const { unmount } = render(<SlaChip dueAt={hoursFromNow(-5)} policyHours={24} status="RESOLVED" />);
    const closed = screen.getByText('SLA closed');
    expect(closed.className).toContain('rounded-full');
    expect(closed.className).toContain('px-2.5');
    expect(closed.getAttribute('title')).toContain('RESOLVED');
    expect(screen.queryByText(/SLA —/)).toBeNull();
    unmount();

    render(<SlaChip dueAt={null} status="CLOSED" />);
    expect(screen.getByText('SLA closed')).toBeInTheDocument();
    expect(screen.queryByText(/SLA —/)).toBeNull();
  });

  it('UX-35 (#209): open tickets without an SLA say "No SLA", not a dash', () => {
    render(<SlaChip dueAt={null} status="OPEN" />);
    expect(screen.getByText('No SLA')).toBeInTheDocument();
    expect(screen.queryByText(/SLA —/)).toBeNull();
  });

  it('UX-39 (#213): pre-breach red chips carry "due soon" text', () => {
    render(<SlaChip dueAt={new Date(Date.now() + 5 * 60_000).toISOString()} policyHours={24} />);
    const chip = screen.getByText(/due soon/);
    expect(chip.className).toContain('text-red-700');
    expect(chip.textContent).toContain('SLA');
  });

  it('UX-39 (#213): overdue chips keep OVERDUE without "due soon"', () => {
    render(<SlaChip dueAt={hoursFromNow(-1)} policyHours={24} />);
    expect(screen.getByText(/OVERDUE/)).toBeInTheDocument();
    expect(screen.queryByText(/due soon/)).toBeNull();
  });
});
