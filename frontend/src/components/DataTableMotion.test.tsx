import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import DataTable, { type Column } from './DataTable';

afterEach(() => {
  cleanup();
});

// jsdom lacks ResizeObserver; DataTable's fill-height effect mounts one.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

interface Row {
  id: string;
  name: string;
}

const columns: Column<Row>[] = [{ key: 'name', header: 'Name' }];

const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));

function bodyRows(container: HTMLElement): HTMLElement[] {
  const tbody = container.querySelector('tbody');
  if (!tbody) return [];
  return Array.from(tbody.querySelectorAll(':scope > tr'));
}

describe('DataTable row motion', () => {
  it('renders the first 12 rows as motion rows and the rest as plain rows', () => {
    const { container } = render(<DataTable columns={columns} rows={rows(50)} />);
    const body = bodyRows(container);
    expect(body).toHaveLength(50);
    expect(body.filter((r) => r.hasAttribute('data-motion-row'))).toHaveLength(12);
    expect(body.filter((r) => !r.hasAttribute('data-motion-row'))).toHaveLength(38);
  });

  it('unmounts rows removed by a filter change (no invisible leftovers)', async () => {
    const { container, rerender } = render(
      <DataTable columns={columns} rows={rows(3)} />,
    );
    expect(within(container).getByText('Row 2')).toBeInTheDocument();
    rerender(<DataTable columns={columns} rows={rows(1)} />);
    await waitFor(() => {
      expect(screen.queryByText('Row 2')).not.toBeInTheDocument();
    });
    expect(within(container).getByText('Row 0')).toBeInTheDocument();
  });
});
