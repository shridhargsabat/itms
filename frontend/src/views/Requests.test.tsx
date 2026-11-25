import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Requests from './Requests';
import type { ServiceRequest } from '@/api/types';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly:
// with several tests per file one render would otherwise leak into the next.
afterEach(cleanup);
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const { mockGetRequests } = vi.hoisted(() => ({ mockGetRequests: vi.fn() }));

// Live queries stubbed; getCachedUser stays real (localStorage-backed).
// Default mock emulates the backend pending filter: the SUBMITTED queue is
// returned only when the view asks with `pending: true`.
vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getRequests: (...args: unknown[]) => mockGetRequests(...args),
    getCatalog: () => Promise.resolve([]),
  };
});

function req(overrides: Partial<ServiceRequest> = {}): ServiceRequest {
  return {
    id: 'req-1',
    request_number: 'REQ-00003',
    catalog_item_id: 'cat-1',
    requester_id: 'u2',
    subject: 'Need a mouse',
    details: {},
    priority: 'MEDIUM',
    status: 'SUBMITTED',
    assignee_id: null,
    approved_by: null,
    approved_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    requester_name: 'Requester',
    assignee_name: null,
    catalog_name: 'Hardware',
    catalog_code: 'HW',
    ...overrides,
  };
}

const PENDING_ITEM = req();

beforeEach(() => {
  mockGetRequests.mockImplementation((params?: { pending?: boolean }) =>
    Promise.resolve(
      params?.pending ? { items: [PENDING_ITEM], total: 1 } : { items: [], total: 0 },
    ),
  );
});

function setUser(role: string) {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u1', email: 'a@x.com', name: 'A', role, department: 'IT' }),
  );
}

function renderRequests(tab: string) {
  setUser('ADMIN');
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/requests?tab=${tab}`]}>
        <Requests />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Requests view (task 3)', () => {
  it('renders nested details without [object Object]', async () => {
    mockGetRequests.mockResolvedValue({
      items: [req({ details: { items: [{ name: 'Mouse' }], cfg: { ram: '16GB' } } })],
      total: 1,
    });
    renderRequests('all');
    expect(await screen.findByText(/Mouse/)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/object Object/);
  });

  it('Approvals tab lists SUBMITTED requests with action buttons', async () => {
    renderRequests('pending');
    expect(await screen.findByText('REQ-00003')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(mockGetRequests).toHaveBeenCalledWith(expect.objectContaining({ pending: true }));
  });

  it('view tabs expose tablist semantics', async () => {
    renderRequests('all');
    expect(await screen.findByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('All Requests');
  });
});
