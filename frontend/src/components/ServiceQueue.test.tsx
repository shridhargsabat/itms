import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ServiceQueue from './ServiceQueue';
import { listTickets, patchTicketStatus } from '@/api/client';
import type { Ticket, TicketStatus } from '@/api/types';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(cleanup);
afterEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
});

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return { ...mod, listTickets: vi.fn(), patchTicketStatus: vi.fn() };
});

// jsdom lacks Element.scrollIntoView (Select.toggle calls it on open).
window.HTMLElement.prototype.scrollIntoView = vi.fn();

function ticket(over: Partial<Ticket> & Pick<Ticket, 'id' | 'ticket_number' | 'title'>): Ticket {
  return {
    description: '',
    ticket_type: 'INCIDENT',
    priority: 'MEDIUM',
    status: 'OPEN',
    sla_due_at: null,
    sla_escalated_at: null,
    requester_id: 'u1',
    requester_name: 'Priya Nair',
    assignee_id: null,
    assignee_name: null,
    asset_id: null,
    asset_tag: null,
    asset_name: null,
    created_at: '2026-11-20T10:00:00Z',
    updated_at: '2026-11-20T10:00:00Z',
    ...over,
  };
}

const T1 = ticket({
  id: 't1',
  ticket_number: 'TKT-1048',
  title: 'PostgreSQL pool exhaustion on ITMS API',
  description: 'Spike in concurrent CMDB impact queries saturated the pool.',
  priority: 'URGENT',
  status: 'OPEN',
  asset_tag: 'SRV-MUM-001',
  assignee_name: 'Aarav Mehta',
  sla_due_at: new Date(Date.now() + 2 * 3_600_000).toISOString(),
});
const T2 = ticket({
  id: 't2',
  ticket_number: 'TKT-1047',
  title: 'Cisco uplink flapping on Floor 4 IDF',
  priority: 'HIGH',
  status: 'IN_PROGRESS',
  asset_tag: 'NET-MUM-004',
  assignee_name: 'Rohan Kulkarni',
  sla_due_at: new Date(Date.now() + 8 * 3_600_000).toISOString(),
});
// Closed-loop ticket: fetched but never rendered in the live queue.
const T3 = ticket({
  id: 't3',
  ticket_number: 'TKT-1040',
  title: 'Old resolved printer ticket',
  priority: 'LOW',
  status: 'RESOLVED',
});

beforeEach(() => {
  vi.mocked(listTickets).mockResolvedValue({ items: [T1, T2, T3], total: 3 });
  vi.mocked(patchTicketStatus).mockImplementation((id: string, status: string) =>
    Promise.resolve({ ...T1, id, status: status as TicketStatus }),
  );
});

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderQueue() {
  return render(
    <QueryClientProvider client={queryClient()}>
      <MemoryRouter initialEntries={['/']}>
        <ServiceQueue />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ServiceQueue (task 9)', () => {
  it('fetches 25 tickets and renders only OPEN/IN_PROGRESS rows with badges', async () => {
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');

    expect(listTickets).toHaveBeenCalledWith({ limit: 25 });
    expect(within(queue).getByText('TKT-1048')).toBeInTheDocument();
    expect(within(queue).getByText('PostgreSQL pool exhaustion on ITMS API')).toBeInTheDocument();
    expect(within(queue).getByText('TKT-1047')).toBeInTheDocument();
    // Resolved tickets are filtered out of the live queue.
    expect(within(queue).queryByText('TKT-1040')).not.toBeInTheDocument();
    // Badges per row.
    expect(within(queue).getByText('URGENT')).toBeInTheDocument();
    expect(within(queue).getByText('HIGH')).toBeInTheDocument();
  });

  it('narrows rows client-side by title, ticket number, and asset tag', async () => {
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    const filter = within(queue).getByPlaceholderText('Filter tickets...');

    fireEvent.change(filter, { target: { value: 'flapping' } });
    expect(within(queue).queryByText('TKT-1048')).not.toBeInTheDocument();
    expect(within(queue).getByText('TKT-1047')).toBeInTheDocument();

    fireEvent.change(filter, { target: { value: 'tkt-1048' } });
    expect(within(queue).getByText('TKT-1048')).toBeInTheDocument();
    expect(within(queue).queryByText('TKT-1047')).not.toBeInTheDocument();

    fireEvent.change(filter, { target: { value: 'net-mum' } });
    expect(within(queue).queryByText('TKT-1048')).not.toBeInTheDocument();
    expect(within(queue).getByText('TKT-1047')).toBeInTheDocument();
  });

  it('opens the inspect slide-over on row click and closes via Escape/backdrop', async () => {
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    fireEvent.click(within(queue).getByText('TKT-1048'));

    const drawer = await screen.findByTestId('service-queue-drawer');
    expect(within(drawer).getByText('TKT-1048')).toBeInTheDocument();
    expect(
      within(drawer).getByText('Spike in concurrent CMDB impact queries saturated the pool.'),
    ).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: /open in service desk/i })).toHaveAttribute(
      'href',
      '/tickets',
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('service-queue-drawer')).not.toBeInTheDocument();

    // Reopen, then close via the scrim.
    fireEvent.click(within(queue).getByText('TKT-1048'));
    await screen.findByTestId('service-queue-drawer');
    fireEvent.click(screen.getByTestId('service-queue-scrim'));
    expect(screen.queryByTestId('service-queue-drawer')).not.toBeInTheDocument();
  });

  it('status change calls patchTicketStatus and shows an inline confirm', async () => {
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    fireEvent.click(within(queue).getByText('TKT-1048'));
    const drawer = await screen.findByTestId('service-queue-drawer');

    // App-native Select: open the trigger, then pick the portaled option.
    fireEvent.click(within(drawer).getByRole('button', { name: 'OPEN' }));
    fireEvent.click(await screen.findByRole('option', { name: 'RESOLVED' }));

    expect(await within(drawer).findByText('Status updated to RESOLVED')).toBeInTheDocument();
    expect(patchTicketStatus).toHaveBeenCalledWith('t1', 'RESOLVED');
  });

  it('is visible to non-admin users (no admin gate)', async () => {
    localStorage.setItem(
      'itms_user',
      JSON.stringify({ id: 'u9', email: 'e@x.com', name: 'E', role: 'EMPLOYEE', department: 'IT' }),
    );
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    expect(within(queue).getByText('TKT-1048')).toBeInTheDocument();
    expect(within(queue).getByText('TKT-1047')).toBeInTheDocument();
  });

  it('shows an empty state when no open tickets match', async () => {
    vi.mocked(listTickets).mockResolvedValue({ items: [], total: 0 });
    renderQueue();
    expect(await screen.findByText('Queue is clear')).toBeInTheDocument();
  });
});
