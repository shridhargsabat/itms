import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WarrantyView from './Warranty';
import type { WarrantyAlert } from '@/api/types';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(cleanup);
afterEach(() => {
  vi.restoreAllMocks();
});

const { mockGetWarrantyAlerts } = vi.hoisted(() => ({ mockGetWarrantyAlerts: vi.fn() }));

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getWarrantyAlerts: (...args: unknown[]) => mockGetWarrantyAlerts(...args),
  };
});

function alert(overrides: Partial<WarrantyAlert> = {}): WarrantyAlert {
  return {
    id: 'a-1',
    asset_tag: 'AST-05033',
    name: 'Cisco Switch 2960',
    status: 'ASSIGNED',
    warranty_expiry: '2022-01-01',
    days_left: -1502,
    ...overrides,
  };
}

const EXPIRED_ITEM = alert();
const EXPIRING_ITEM = alert({
  id: 'a-2',
  asset_tag: 'AST-00012',
  name: 'Dell Latitude 5440',
  warranty_expiry: '2026-12-06',
  days_left: 12,
});

mockGetWarrantyAlerts.mockImplementation((scope?: string) =>
  Promise.resolve(scope === 'expired' ? [EXPIRED_ITEM] : [EXPIRING_ITEM]),
);

function renderWarranty() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <WarrantyView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Warranty view (task 9)', () => {
  it('filters warranty alerts by search text', async () => {
    renderWarranty();
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'Cisco' } });
    expect(screen.getByText(/AST-05033/)).toBeInTheDocument();
    expect(screen.queryByText(/Dell Latitude/)).not.toBeInTheDocument();
  });

  it('separates expired from expiring soon via tabs', async () => {
    renderWarranty();
    fireEvent.click(await screen.findByRole('tab', { name: /expired/i }));
    expect(screen.queryByText(/12d remaining/)).not.toBeInTheDocument();
    expect(screen.getByText(/AST-05033/)).toBeInTheDocument();
  });

  it('urgency bars expose text labels, not color alone', async () => {
    renderWarranty();
    const bars = await screen.findAllByRole('img', { name: /warranty/i });
    expect(bars.length).toBeGreaterThan(0);
  });
});
