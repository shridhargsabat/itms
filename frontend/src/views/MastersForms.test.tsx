import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Masters from './Masters';
import * as api from '@/api/client';
import type { LookupOption, MastersMap, UserRecord, Vendor } from '@/api/types';

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
window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    listUsers: vi.fn(),
    getMasters: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    listVendors: vi.fn(),
    createVendor: vi.fn(),
    updateVendor: vi.fn(),
  };
});

const USER: UserRecord = {
  id: 'u-1',
  name: 'Aarav Gupta',
  email: 'aarav@itms.local',
  role: 'EMPLOYEE',
  department: 'IT',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
};

const DEPT: LookupOption = {
  id: 'd-1',
  family: 'department',
  code: 'IT',
  label: 'IT',
  sort_order: 0,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
};

const MASTERS: MastersMap = {
  department: [DEPT],
  asset_category: [],
  ticket_type: [],
  ticket_priority: [],
  ticket_status: [],
};

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderMasters() {
  render(
    <QueryClientProvider client={makeQc()}>
      <MemoryRouter initialEntries={['/masters']}>
        <Masters />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setInput(id: string, value: string) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing input #${id}`);
  fireEvent.change(el, { target: { value } });
}

beforeEach(() => {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u-admin', email: 'admin@itms.local', name: 'IT Admin', role: 'ADMIN', department: 'IT' }),
  );
  vi.mocked(api.listUsers).mockResolvedValue({ items: [USER], total: 1 });
  vi.mocked(api.getMasters).mockResolvedValue(MASTERS);
  vi.mocked(api.listVendors).mockResolvedValue([]);
  vi.mocked(api.createUser).mockResolvedValue({ ...USER, id: 'u-2' });
  vi.mocked(api.updateUser).mockResolvedValue(USER);
  const vendor: Vendor = {
    id: 'v-1',
    name: 'Acme Corp',
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    support_link: null,
    amc_expiry: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
  vi.mocked(api.createVendor).mockResolvedValue(vendor);
  vi.mocked(api.updateVendor).mockResolvedValue(vendor);
});

describe('Masters forms validation (FORM-02B, FORM-04)', () => {
  it('New User empty submit renders inline errors and blocks createUser; valid submit sends the payload', async () => {
    renderMasters();
    await screen.findByText('Aarav Gupta');

    fireEvent.click(screen.getByRole('button', { name: /new user/i }));
    fireEvent.click(screen.getByRole('button', { name: /^create user$/i }));

    expect(await screen.findByText('Full name is required')).toBeInTheDocument();
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(api.createUser).not.toHaveBeenCalled();
    expect(document.getElementById('user-name')).toHaveFocus();

    setInput('user-name', 'New Person');
    setInput('user-email', 'new@itms.local');
    setInput('user-password', 'password123');
    fireEvent.click(screen.getByRole('button', { name: /^create user$/i }));

    await waitFor(() => expect(api.createUser).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createUser).mock.calls[0][0]).toEqual(
      expect.objectContaining({ name: 'New Person', email: 'new@itms.local', password: 'password123' }),
    );
  });

  it('Add vendor empty submit renders inline errors and blocks createVendor; valid submit sends normalized input', async () => {
    renderMasters();
    await screen.findByText('Aarav Gupta');

    fireEvent.click(screen.getByRole('tab', { name: /^vendors$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /add vendor/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(api.createVendor).not.toHaveBeenCalled();
    expect(document.getElementById('vendor-name')).toHaveFocus();

    setInput('vendor-name', 'Acme Corp');
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.createVendor).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createVendor).mock.calls[0][0]).toEqual(
      expect.objectContaining({ name: 'Acme Corp' }),
    );
  });
});
