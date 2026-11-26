import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ServiceQueue from './ServiceQueue';
import { listTickets, getSlaPolicy } from '@/api/client';
import type { Ticket } from '@/api/types';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(cleanup);
afterEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
});

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return { ...mod, listTickets: vi.fn(), patchTicketStatus: vi.fn(), getSlaPolicy: vi.fn() };
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

beforeEach(() => {
  vi.mocked(getSlaPolicy).mockResolvedValue({});
});

function renderQueue() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/']}>
        <ServiceQueue />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FE-15 service queue reports its 50-row window (issue 167)', () => {
  it('shows "Showing 50 of N" plus a link to the full Tickets view when total exceeds the window', async () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      ticket({ id: `t-${i}`, ticket_number: `TKT-${2000 + i}`, title: `Queue ticket ${i}` }),
    );
    vi.mocked(listTickets).mockResolvedValue({ items, total: 120 });
    renderQueue();

    const queue = await screen.findByTestId('service-queue');
    expect(await within(queue).findByText(/Showing 50 of 120 tickets/)).toBeInTheDocument();
    const link = within(queue).getByRole('link', { name: 'View all in Tickets' });
    expect(link).toHaveAttribute('href', '/tickets');
  });

  it('shows no window notice when everything fits', async () => {
    const items = [
      ticket({ id: 't-1', ticket_number: 'TKT-1048', title: 'Only ticket' }),
    ];
    vi.mocked(listTickets).mockResolvedValue({ items, total: 1 });
    renderQueue();

    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    expect(within(queue).queryByText(/Showing \d+ of \d+/)).not.toBeInTheDocument();
    expect(within(queue).queryByRole('link', { name: 'View all in Tickets' })).not.toBeInTheDocument();
  });
});
