import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import DataTable from './DataTable';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(cleanup);

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

describe('DataTable header ARIA (task 11)', () => {
  it('headers use scope=col and expose sort state', () => {
    // NOTE: one data row — rows={[]} renders the empty state (no <table>).
    render(
      <DataTable
        columns={[{ key: 'name', header: 'Name', sortable: true }]}
        rows={[{ id: '1', name: 'Ada' }]}
        sort={{ key: 'name', dir: 'asc' }}
        onSortChange={() => {}}
      />,
    );
    const th = screen.getByRole('columnheader', { name: /name/i });
    expect(th).toHaveAttribute('scope', 'col');
    expect(th).toHaveAttribute('aria-sort', 'ascending');
  });

  it('marks inactive sortable headers as none, leaves plain headers unsorted, hides sort icons', () => {
    render(
      <DataTable
        columns={[
          { key: 'name', header: 'Name', sortable: true },
          { key: 'status', header: 'Status', sortable: true },
          { key: 'id', header: 'ID' },
        ]}
        rows={[{ id: '1', name: 'Ada', status: 'OPEN' }]}
        sort={{ key: 'name', dir: 'desc' }}
        onSortChange={() => {}}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: /status/i })).toHaveAttribute('aria-sort', 'none');
    const id = screen.getByRole('columnheader', { name: /^id$/i });
    expect(id).toHaveAttribute('scope', 'col');
    expect(id).not.toHaveAttribute('aria-sort');
    // sort icons are decorative
    const icons = document.querySelectorAll('th svg');
    expect(icons.length).toBeGreaterThan(0);
    icons.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'));
  });
});
