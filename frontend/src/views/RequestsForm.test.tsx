import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Requests from './Requests';
import * as api from '@/api/client';
import type { CatalogItem, ServiceRequest } from '@/api/types';

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
    getRequests: vi.fn(),
    getCatalog: vi.fn(),
    getMasters: vi.fn(),
    createRequest: vi.fn(),
  };
});

const LAPTOP: CatalogItem = {
  id: 'c-laptop',
  code: 'NEW_LAPTOP',
  name: 'New Laptop Request',
  description: 'Request a new laptop for onboarding or replacement.',
  category: 'Hardware',
  approval_required: true,
  form_fields: [
    { key: 'employee_name', label: 'Employee name', type: 'text', required: true },
    { key: 'department', label: 'Department', type: 'text', required: true },
  ],
  active: true,
  sort_order: 10,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const ACCESS: CatalogItem = {
  id: 'c-access',
  code: 'SYSTEM_ACCESS',
  name: 'Access to System X',
  description: 'Request access to a shared system, folder or drive.',
  category: 'Accounts',
  approval_required: false,
  form_fields: [{ key: 'system_name', label: 'System', type: 'text', required: true }],
  active: true,
  sort_order: 40,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderRequests() {
  render(
    <QueryClientProvider client={makeQc()}>
      <MemoryRouter initialEntries={['/requests']}>
        <Requests />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openModal() {
  renderRequests();
  fireEvent.click(await screen.findByRole('button', { name: /new request/i }));
  await screen.findByText('Choose a request type…');
}

async function pickRequestType(name: RegExp) {
  fireEvent.click(screen.getByLabelText(/request type/i));
  fireEvent.click(await screen.findByRole('option', { name }));
}

function subjectInput() {
  return screen.getByLabelText(/subject/i) as HTMLInputElement;
}

beforeEach(() => {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u-1', email: 'emp@itms.local', name: 'Emp', role: 'EMPLOYEE', department: 'IT' }),
  );
  vi.mocked(api.getRequests).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(api.getCatalog).mockResolvedValue([LAPTOP, ACCESS]);
  vi.mocked(api.getMasters).mockResolvedValue({
    department: [
      { id: 'd1', family: 'department', code: 'ENG', label: 'Engineering', sort_order: 1, active: true, created_at: '' },
      { id: 'd2', family: 'department', code: 'HR', label: 'Human Resources', sort_order: 2, active: true, created_at: '' },
    ],
    asset_category: [],
    ticket_type: [],
    ticket_priority: [],
    ticket_status: [],
  });
});

describe('Requests FORM-05 subject defaulting', () => {
  it('resets an unmodified subject to the new type name on switch', async () => {
    await openModal();
    await pickRequestType(/New Laptop Request/);
    expect(subjectInput().value).toBe('New Laptop Request');

    await pickRequestType(/Access to System X/);
    expect(subjectInput().value).toBe('Access to System X');
  });

  it('preserves a manually edited subject across type switches', async () => {
    await openModal();
    await pickRequestType(/New Laptop Request/);
    fireEvent.change(subjectInput(), { target: { value: 'My custom subject' } });

    await pickRequestType(/Access to System X/);
    expect(subjectInput().value).toBe('My custom subject');
  });

  it('submits subject, priority and Masters department answer via createRequest', async () => {
    vi.mocked(api.createRequest).mockResolvedValue({} as ServiceRequest);
    await openModal();
    await pickRequestType(/New Laptop Request/);

    fireEvent.change(screen.getByLabelText(/employee name/i), { target: { value: 'Priya' } });
    fireEvent.click(screen.getByLabelText(/department/i));
    fireEvent.click(await screen.findByRole('option', { name: 'Engineering' }));

    fireEvent.click(screen.getByRole('button', { name: /^submit request$/i }));
    await waitFor(() => expect(api.createRequest).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createRequest).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        catalog_item_id: 'c-laptop',
        subject: 'New Laptop Request',
        priority: 'MEDIUM',
        details: expect.objectContaining({ employee_name: 'Priya', department: 'ENG' }),
      }),
    );
  });
});
