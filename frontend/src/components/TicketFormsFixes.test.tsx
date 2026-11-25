import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewTicketForm from './NewTicketForm';
import ServiceQueue from './ServiceQueue';
import SlaChip from './SlaChip';
import {
  createTicket,
  getSlaPolicy,
  listAssets,
  listTemplates,
  listTickets,
  listUsers,
  patchTicketStatus,
  suggestArticles,
} from '@/api/client';
import type { Ticket, TicketStatus } from '@/api/types';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(cleanup);
afterEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
});

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    createTicket: vi.fn(),
    listAssets: vi.fn(),
    listTemplates: vi.fn(),
    listTickets: vi.fn(),
    listUsers: vi.fn(),
    patchTicketStatus: vi.fn(),
    getSlaPolicy: vi.fn(),
    suggestArticles: vi.fn(),
  };
});

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom lacks Element.scrollIntoView (Select.toggle calls it on open).
window.HTMLElement.prototype.scrollIntoView = vi.fn();

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function setUser(role: string) {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u-1', email: 't@itms.local', name: 'T User', role, department: 'IT' }),
  );
}

function ticket(over: Partial<Ticket> & Pick<Ticket, 'id' | 'ticket_number' | 'title'>): Ticket {
  return {
    description: '',
    ticket_type: 'INCIDENT',
    priority: 'MEDIUM',
    status: 'OPEN',
    sla_due_at: null,
    sla_escalated_at: null,
    requester_id: 'u-1',
    requester_name: 'T User',
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

const FULL_SLA_POLICY = {
  URGENT: { hours: 4, label: 'Urgent' },
  HIGH: { hours: 8, label: 'High' },
  MEDIUM: { hours: 24, label: 'Medium' },
  LOW: { hours: 72, label: 'Low' },
};

beforeEach(() => {
  vi.mocked(listUsers).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(listAssets).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(listTemplates).mockResolvedValue([]);
  vi.mocked(suggestArticles).mockResolvedValue([]);
  vi.mocked(listTickets).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(getSlaPolicy).mockResolvedValue(FULL_SLA_POLICY);
});

function renderForm(opts?: { onNewTicket?: (id: string) => void }) {
  const onDone = vi.fn();
  render(
    <QueryClientProvider client={queryClient()}>
      <MemoryRouter initialEntries={['/']}>
        <NewTicketForm onDone={onDone} onNewTicket={opts?.onNewTicket} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onDone };
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

describe('TicketFormsFixes (FE2: TFE-02/06/14/15/17/20/37)', () => {
  it('TFE-17: whitespace-only title is rejected with an inline error and no create call', async () => {
    setUser('ADMIN');
    const { onDone } = renderForm();

    const title = screen.getByPlaceholderText("What's the issue?") as HTMLInputElement;
    expect(title).toHaveAttribute('maxlength', '200');
    expect(screen.getByPlaceholderText('Details (optional)')).toHaveAttribute('maxlength', '4000');

    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Ticket' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/title is required/i);
    expect(createTicket).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('TFE-15: applying a template preserves a typed description but fills untouched priority', async () => {
    setUser('ADMIN');
    vi.mocked(listTemplates).mockResolvedValue([
      {
        id: 'tpl-1',
        name: 'VPN fix',
        ticket_type: 'INCIDENT',
        priority: 'HIGH',
        description: 'Template-provided steps',
        active: true,
        created_by: null,
        updated_by: null,
        created_at: '2026-11-20T00:00:00Z',
        updated_at: '2026-11-20T00:00:00Z',
      },
    ]);
    renderForm();

    fireEvent.change(screen.getByPlaceholderText('Details (optional)'), {
      target: { value: 'My typed details' },
    });
    // The skeleton trigger is unnamed; the real picker resolves once templates load.
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a template' }));
    fireEvent.click(await screen.findByRole('option', { name: /VPN fix/ }));

    expect(screen.getByPlaceholderText('Details (optional)')).toHaveValue('My typed details');
    expect(screen.getByRole('button', { name: 'Priority' })).toHaveTextContent('HIGH');
  });

  it('TFE-06: EMPLOYEE sees no requester picker (and no users fetch)', async () => {
    setUser('EMPLOYEE');
    renderForm();

    expect(await screen.findByRole('button', { name: 'Create Ticket' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Requester' })).not.toBeInTheDocument();
    expect(screen.queryByText('Requester')).not.toBeInTheDocument();
    expect(listUsers).not.toHaveBeenCalled();
    // The asset picker is unaffected.
    expect(screen.getByRole('button', { name: 'Linked Asset' })).toBeInTheDocument();
  });

  it('TFE-14/C4: successful create calls onNewTicket with the created id', async () => {
    setUser('ADMIN');
    vi.mocked(createTicket).mockResolvedValue(
      ticket({ id: 'new-1', ticket_number: 'TKT-9001', title: 'Hello' }),
    );
    const onNewTicket = vi.fn();
    const { onDone } = renderForm({ onNewTicket });

    fireEvent.change(screen.getByPlaceholderText("What's the issue?"), {
      target: { value: 'Hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Ticket' }));

    await waitFor(() => expect(createTicket).toHaveBeenCalledTimes(1));
    expect(onNewTicket).toHaveBeenCalledWith('new-1');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('TFE-02/TFE-20: queue queries OPEN,IN_PROGRESS and re-selecting the current status fires no PATCH', async () => {
    const T1 = ticket({
      id: 't1',
      ticket_number: 'TKT-1048',
      title: 'PostgreSQL pool exhaustion on ITMS API',
      priority: 'URGENT',
      status: 'OPEN',
    });
    vi.mocked(listTickets).mockResolvedValue({ items: [T1], total: 1 });
    vi.mocked(patchTicketStatus).mockImplementation((id: string, status: string) =>
      Promise.resolve({ ...T1, id, status: status as TicketStatus }),
    );
    renderQueue();

    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    expect(listTickets).toHaveBeenCalledWith({ status: 'OPEN,IN_PROGRESS', limit: 50 });

    fireEvent.click(within(queue).getByText('TKT-1048'));
    const drawer = await screen.findByTestId('service-queue-drawer');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Update Status' }));
    fireEvent.click(await screen.findByRole('option', { name: 'OPEN' }));

    expect(patchTicketStatus).not.toHaveBeenCalled();
    expect(within(drawer).queryByText(/Status updated to/)).not.toBeInTheDocument();
  });

  it('TFE-37: SlaChip renders red within 10 minutes of breach', () => {
    render(<SlaChip dueAt={new Date(Date.now() + 5 * 60_000).toISOString()} policyHours={24} />);
    const chip = screen.getByTitle(/SLA due /);
    expect(chip.className).toContain('text-red-400');
  });

  it('TFE-37: SlaChip stays green with most of the window left', () => {
    render(<SlaChip dueAt={new Date(Date.now() + 20 * 3_600_000).toISOString()} policyHours={24} />);
    const chip = screen.getByTitle(/SLA due /);
    expect(chip.className).toContain('text-emerald-400');
  });
});
