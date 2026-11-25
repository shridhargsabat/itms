import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Licenses from './Licenses';
import * as api from '@/api/client';
import type { License } from '@/api/types';

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
    getLicenses: vi.fn(),
    getLicenseAlerts: vi.fn(),
    createLicense: vi.fn(),
  };
});

function license(partial: Partial<License> & { id: string; name: string }): License {
  return {
    vendor: 'Acme',
    license_type: 'SUBSCRIPTION',
    seats_total: 10,
    seats_used: 6,
    cost_per_seat: 1000,
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

const LIC = license({ id: 'a', name: 'Alpha Suite' });

beforeEach(() => {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u-admin', email: 'admin@itms.local', name: 'IT Admin', role: 'ADMIN', department: 'IT' }),
  );
  vi.mocked(api.getLicenses).mockResolvedValue({ items: [LIC], total: 1 });
  vi.mocked(api.getLicenseAlerts).mockResolvedValue({
    expired: [],
    expiring_30: [],
    expiring_60: [],
    expiring_90: [],
  });
  vi.mocked(api.createLicense).mockResolvedValue(LIC);
});

function renderLicenses() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/licenses']}>
        <Licenses />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openRegisterModal() {
  renderLicenses();
  await screen.findByTestId('license-card');
  fireEvent.click(screen.getByRole('button', { name: /register license/i }));
  await screen.findByText('Software name *');
}

describe('Licenses form validation (FORM-02)', () => {
  it('empty submit shows inline errors, blocks createLicense, and focuses the first invalid field', async () => {
    await openRegisterModal();
    // Seats defaults to 1, so clear it to exercise the empty-submit path fully.
    fireEvent.change(document.getElementById('license-seats')!, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^register$/i }));

    expect(await screen.findByText('Software name is required')).toHaveRole('alert');
    expect(screen.getByText('Seats is required')).toBeInTheDocument();
    expect(api.createLicense).not.toHaveBeenCalled();
    const nameInput = document.getElementById('license-name')!;
    expect(nameInput).toHaveFocus();
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput).toHaveAttribute('aria-describedby', 'license-name-error');
  });

  it('invalid seats shows a seats error and focuses seats', async () => {
    await openRegisterModal();
    fireEvent.change(document.getElementById('license-name')!, { target: { value: 'Zoom Pro' } });
    fireEvent.change(document.getElementById('license-seats')!, { target: { value: '-3' } });
    fireEvent.click(screen.getByRole('button', { name: /^register$/i }));

    expect(await screen.findByText('Seats must be a whole number of 0 or more')).toBeInTheDocument();
    expect(api.createLicense).not.toHaveBeenCalled();
    expect(document.getElementById('license-seats')).toHaveFocus();
  });

  it('valid submit sends the payload via createLicense', async () => {
    await openRegisterModal();
    fireEvent.change(document.getElementById('license-name')!, { target: { value: 'Zoom Pro' } });
    fireEvent.change(document.getElementById('license-seats')!, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /^register$/i }));

    await waitFor(() => expect(api.createLicense).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createLicense).mock.calls[0][0]).toEqual(
      expect.objectContaining({ name: 'Zoom Pro', seats_total: 5 }),
    );
  });
});
