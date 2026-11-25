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

  it('keeps row DOM identity when reordering moves rows across the motion boundary', () => {
    const thirteen = rows(13);
    const { container, rerender } = render(
      <DataTable columns={columns} rows={thirteen} />,
    );
    const before = within(container).getByText('Row 11').closest('tr');
    expect(before).not.toBeNull();
    // Rotate right: Row 11 moves from index 11 (motion) to index 12 (static).
    const rotated = [thirteen[12], ...thirteen.slice(0, 12)];
    rerender(<DataTable columns={columns} rows={rotated} />);
    const after = within(container).getByText('Row 11').closest('tr');
    expect(after).toBe(before);
  });

  it('clears instantly on empty and re-enters on refill with no stuck rows', async () => {
    const { container, rerender } = render(
      <DataTable columns={columns} rows={rows(3)} emptyMessage="Nothing here." />,
    );
    rerender(<DataTable columns={columns} rows={[]} emptyMessage="Nothing here." />);
    expect(within(container).getByText('Nothing here.')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-motion-row]')).toHaveLength(0);
    rerender(<DataTable columns={columns} rows={rows(3)} emptyMessage="Nothing here." />);
    await waitFor(() => {
      expect(within(container).getByText('Row 2')).toBeInTheDocument();
    });
    expect(container.querySelectorAll('[data-motion-row]')).toHaveLength(3);
  });
});
