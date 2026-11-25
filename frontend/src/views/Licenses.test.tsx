import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import Licenses from './Licenses';
import type { License } from '@/api/types';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(cleanup);
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function license(partial: Partial<License> & { id: string; name: string }): License {
  return {
    vendor: 'Acme',
    license_type: 'SUBSCRIPTION',
    seats_total: 10,
    seats_used: 6,
    cost_per_seat: 29304,
    cost_total: null,
    currency: 'INR',
    expiry_date: null,
    renewal_cost: null,
    notes: null,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

// Nested buckets (backend semantics): expiring_30 ⊆ expiring_60 ⊆ expiring_90.
const licA = license({ id: 'a', name: 'Alpha Suite' });
const licB = license({ id: 'b', name: 'Beta Suite' });
const licC = license({ id: 'c', name: 'Gamma Suite' });
const licD = license({ id: 'd', name: 'Delta Suite' });

const ALERTS = {
  expired: [licD],
  expiring_30: [licA],
  expiring_60: [licA, licB],
  expiring_90: [licA, licB, licC],
};

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getLicenses: (params?: { scope?: string }) =>
      params?.scope === 'expiring'
        ? Promise.resolve({ items: [licA, licB, licC], total: 3 })
        : params?.scope === 'expired'
          ? Promise.resolve({ items: [licD], total: 1 })
          : Promise.resolve({ items: [licA, licB, licC, licD], total: 4 }),
    getLicenseAlerts: () => Promise.resolve(ALERTS),
    getLicenseDetail: () => Promise.resolve({ license: licA, allocations: [] }),
  };
});

function setUser(role: string) {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u1', email: 'a@x.com', name: 'A', role, department: 'IT' }),
  );
}

function renderLicenses() {
  setUser('ADMIN');
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/licenses']}>
        <Licenses />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('expiry KPI equals expired + expiring tab counts and each tab renders its badge count', async () => {
  renderLicenses();
  const kpi = await screen.findByText('Expiry alerts');
  const expiringTab = screen.getByRole('button', { name: /expiring ≤90d/i });
  const expiredTab = screen.getByRole('button', { name: /^expired \(/i });
  const n = (s: string | null) => Number(s!.match(/\((\d+)\)/)![1]);
  // Expired badge is stable pre/post fix — awaiting it settles the alerts query.
  await screen.findByRole('button', { name: /^expired \(1\)/i });
  const kpiValue = kpi.parentElement!.querySelector('.tabular-nums')!.textContent;
  expect(Number(kpiValue)).toBe(n(expiringTab.textContent) + n(expiredTab.textContent));
  fireEvent.click(expiringTab);
  expect((await screen.findAllByTestId('license-card')).length).toBe(n(expiringTab.textContent));
});

it('license cards show total cost, never a blank — total', async () => {
  renderLicenses();
  const cards = await screen.findAllByTestId('license-card');
  expect(cards.length).toBeGreaterThan(0);
  for (const c of cards) expect(c.textContent).not.toMatch(/— total/);
});

it('KPI labels meet 12px minimum', async () => {
  renderLicenses();
  await screen.findByText('Utilization');
  expect(document.body.innerHTML).not.toMatch(/text-\[10px\]/);
});
