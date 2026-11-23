import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarNav from './SidebarNav';
import BottomNav from './BottomNav';
import QuickCapture from './QuickCapture';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly:
// with several tests per file one render would otherwise leak into the next.
afterEach(cleanup);
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// AddAssetForm fires listLocations/listVendors on mount — stub the network,
// keep getCachedUser (localStorage-backed) real.
vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    listLocations: () => Promise.resolve([]),
    listVendors: () => Promise.resolve([]),
  };
});

function setUser(role: string) {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u1', email: 'a@x.com', name: 'A', role, department: 'IT' }),
  );
}

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

describe('FloatingShell (task 5: QuickCapture dock + floating nav)', () => {
  it('admin: Invoice opens the Add Asset modal with AddAssetForm', async () => {
    setUser('ADMIN');
    render(
      <QueryClientProvider client={queryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <QuickCapture wide />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /invoice/i }));
    expect(await screen.findByRole('heading', { name: 'Add Asset' })).toBeInTheDocument();
    // AddAssetForm body (same form AddAssetButton opens).
    expect(screen.getByText('Asset Tag')).toBeInTheDocument();
  });

  it('non-admin: Invoice is hidden but Scan stays', () => {
    setUser('AGENT');
    render(
      <QueryClientProvider client={queryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <QuickCapture wide />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: /invoice/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /scan/i })).toBeInTheDocument();
  });

  it('Scan navigates to /scan', () => {
    setUser('AGENT');
    render(
      <MemoryRouter initialEntries={['/']}>
        <QuickCapture wide />
        <LocationProbe />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/');
    fireEvent.click(screen.getByRole('button', { name: /scan/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/scan');
  });

  it('collapsed rail renders an icon-only stack with titles', () => {
    setUser('ADMIN');
    render(
      <MemoryRouter initialEntries={['/']}>
        <QuickCapture wide={false} />
      </MemoryRouter>,
    );
    // Icon-only: accessible names come from title/aria-label, no visible text.
    const invoice = screen.getByRole('button', { name: 'Invoice' });
    const scan = screen.getByRole('button', { name: 'Scan' });
    expect(invoice).toHaveAttribute('title', 'Invoice');
    expect(scan).toHaveAttribute('title', 'Scan');
    expect(invoice.textContent).toBe('');
    expect(scan.textContent).toBe('');
  });

  it('BottomNav bar floats as a rounded capsule', () => {
    setUser('ADMIN');
    render(
      <MemoryRouter initialEntries={['/']}>
        <BottomNav />
      </MemoryRouter>,
    );
    const bar = screen.getByRole('navigation');
    expect(bar).toHaveClass('rounded-[26px]');
    expect(bar).toHaveClass('inset-x-4');
    expect(bar).toHaveClass('bottom-4');
  });

  it('SidebarNav active link is a rounded-full pill', () => {
    setUser('ADMIN');
    render(
      <MemoryRouter initialEntries={['/']}>
        <SidebarNav wide user={{ role: 'ADMIN' }} onExpandSidebar={() => {}} />
      </MemoryRouter>,
    );
    const active = screen.getByRole('link', { name: 'Dashboard' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active).toHaveClass('rounded-full');
  });
});
