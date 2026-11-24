import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Assets from './Assets';
import * as api from '@/api/client';
import type { Asset, UserRecord } from '@/api/types';

// RTL auto-cleanup is off in this repo — clean up explicitly.
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

// jsdom lacks ResizeObserver; DataTable's fill-height effect mounts one.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    listAssets: vi.fn(),
    listLocations: vi.fn(),
    listUsers: vi.fn(),
    listVendors: vi.fn(),
    getAssetLifecycle: vi.fn(),
    listClaims: vi.fn(),
    listAssetMoves: vi.fn(),
    listAssetDocuments: vi.fn(),
    assignAsset: vi.fn(),
  };
});

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'u-priya',
    email: 'priya.sharma@example.com',
    name: 'Priya Sharma',
    role: 'EMPLOYEE',
    department: 'Engineering',
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const PRIYA = user();
const ARJUN = user({ id: 'u-arjun', email: 'arjun.mehta@example.com', name: 'Arjun Mehta' });

const ASSET: Asset = {
  id: 'a-1',
  asset_tag: 'AST-10014',
  name: 'Lenovo IdeaPad',
  category: 'LAPTOP',
  serial_number: 'SN-1',
  status: 'IN_STOCK',
  assigned_to_user_id: null,
  assigned_user_name: null,
  specs: {},
  purchase_date: null,
  warranty_expiry: null,
  unit_cost: null,
  expected_eol: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u-admin', email: 'admin@itms.local', name: 'IT Admin', role: 'ADMIN', department: 'IT' }),
  );
  vi.mocked(api.listAssets).mockResolvedValue({ items: [ASSET], total: 1 });
  vi.mocked(api.listLocations).mockResolvedValue([]);
  vi.mocked(api.listVendors).mockResolvedValue([]);
  vi.mocked(api.getAssetLifecycle).mockResolvedValue([]);
  vi.mocked(api.listClaims).mockResolvedValue([]);
  vi.mocked(api.listAssetMoves).mockResolvedValue([]);
  vi.mocked(api.listAssetDocuments).mockResolvedValue([]);
  vi.mocked(api.listUsers).mockResolvedValue({ items: [PRIYA, ARJUN], total: 2 });
});

function renderAssets() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Assets />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Assets assignment user combobox (task 12)', () => {
  it('assigns assets via searchable user list, not raw user id', async () => {
    renderAssets();
    fireEvent.click(await screen.findByText('AST-10014')); // opens spec modal
    expect(screen.queryByLabelText(/user id/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/user id/i)).not.toBeInTheDocument();
    const combo = await screen.findByRole('combobox', { name: /assign/i });
    fireEvent.click(combo);
    fireEvent.change(combo, { target: { value: 'priya' } });
    expect(await screen.findByText(/priya.*@.*\./i)).toBeInTheDocument();
  });

  it('offers an explicit unassign action', async () => {
    renderAssets();
    fireEvent.click(await screen.findByText('AST-10014')); // opens spec modal
    expect(await screen.findByRole('button', { name: /unassign/i })).toBeInTheDocument();
  });
});
