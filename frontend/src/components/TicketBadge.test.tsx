import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetStatusBadge, PriorityBadge, StatusBadge } from './TicketBadge';

afterEach(() => {
  cleanup();
});

describe('TicketBadge light & dark mode contrast classes', () => {
  it('uses dark-700 ink in light mode and -400 ink in dark mode for asset statuses', () => {
    render(
      <>
        <AssetStatusBadge status="MAINTENANCE" />
        <AssetStatusBadge status="IN_STOCK" />
        <AssetStatusBadge status="ASSIGNED" />
      </>,
    );
    expect(screen.getByText('MAINTENANCE').className).toContain('text-amber-700');
    expect(screen.getByText('MAINTENANCE').className).toContain('dark:text-amber-400');
    expect(screen.getByText('IN STOCK').className).toContain('text-emerald-700');
    expect(screen.getByText('IN STOCK').className).toContain('dark:text-emerald-400');
    expect(screen.getByText('ASSIGNED').className).toContain('text-blue-700');
    expect(screen.getByText('ASSIGNED').className).toContain('dark:text-blue-400');
  });

  it('uses dark-700 ink in light mode and -400 ink in dark mode for ticket priorities and statuses', () => {
    render(
      <>
        <PriorityBadge priority="URGENT" />
        <PriorityBadge priority="HIGH" />
        <PriorityBadge priority="MEDIUM" />
        <StatusBadge status="OPEN" />
        <StatusBadge status="IN_PROGRESS" />
        <StatusBadge status="RESOLVED" />
      </>,
    );
    expect(screen.getByText('URGENT').className).toContain('text-red-700');
    expect(screen.getByText('HIGH').className).toContain('text-orange-700');
    expect(screen.getByText('MEDIUM').className).toContain('text-yellow-700');
    expect(screen.getByText('OPEN').className).toContain('text-blue-700');
    expect(screen.getByText('IN PROGRESS').className).toContain('text-amber-700');
    expect(screen.getByText('RESOLVED').className).toContain('text-emerald-700');
  });
});
