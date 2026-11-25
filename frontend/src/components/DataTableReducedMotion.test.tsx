import { cleanup, render, within } from '@testing-library/react';
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

// This file lives apart from DataTableMotion.test.tsx on purpose: motion
// caches the reduced-motion preference module-wide (externalized dep, so
// vi.resetModules can't clear it). This file's module-scope stub runs
// before any motion render in this file's isolated registry.
window.matchMedia = ((query: string): MediaQueryList => ({
  // motion's useReducedMotion queries "(prefers-reduced-motion)" (no : reduce suffix).
  matches: query.includes('prefers-reduced-motion'),
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

interface Row {
  id: string;
  name: string;
}

const columns: Column<Row>[] = [{ key: 'name', header: 'Name' }];

describe('DataTable reduced motion', () => {
  it('renders zero motion rows when reduced motion is preferred', () => {
    const { container } = render(
      <DataTable
        columns={columns}
        rows={Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }))}
      />,
    );
    expect(container.querySelectorAll('[data-motion-row]')).toHaveLength(0);
    // Content still renders, instantly and fully.
    expect(within(container).getByText('Row 19')).toBeInTheDocument();
  });
});
