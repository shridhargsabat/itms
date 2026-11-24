import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import QuickCapture from './QuickCapture';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom lacks Element.scrollIntoView (Select calls it on open).
window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getCachedUser: () => ({
      id: 'u-admin',
      email: 'admin@itms.local',
      name: 'Admin',
      role: 'ADMIN',
      department: 'IT',
    }),
    listLocations: () => Promise.resolve([]),
    listVendors: () => Promise.resolve([]),
  };
});

function qc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('QuickCapture invoice tab', () => {
  it('clicking Invoice opens the Upload invoice tab (invoice UI visible, manual Name absent)', async () => {
    render(
      <QueryClientProvider client={qc()}>
        <MemoryRouter initialEntries={['/']}>
          <QuickCapture wide />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Invoice' }));

    expect(await screen.findByText('Upload an invoice PDF')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Upload invoice/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Name *')).not.toBeInTheDocument();
  });
});
