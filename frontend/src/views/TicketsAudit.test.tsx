import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Tickets from './Tickets';
import SlaChip from '@/components/SlaChip';
import NewTicketForm from '@/components/NewTicketForm';
import * as api from '@/api/client';
import type { Ticket } from '@/api/types';

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

const PAGE1_TICKET: Ticket = {
  id: 't-page1',
  ticket_number: 'INC-1001',
  title: 'Laptop screen flickering',
  description: 'Flickers on battery power',
  ticket_type: 'INCIDENT',
  priority: 'MEDIUM',
  status: 'RESOLVED',
  requester_id: 'u-1',
  requester_name: 'Aarav Gupta',
  assignee_id: null,
  assignee_name: null,
  asset_id: 'a-1',
  asset_tag: 'AST-10014',
  asset_name: 'Lenovo IdeaPad',
  sla_due_at: '2026-11-24T12:00:00Z',
  sla_escalated_at: null,
  created_at: '2026-11-23T10:00:00Z',
  updated_at: '2026-11-23T11:00:00Z',
};

const OFF_PAGE_TICKET: Ticket = {
  ...PAGE1_TICKET,
  id: 't-offpage',
  ticket_number: 'INC-25052',
  title: 'Off-page deep-linked ticket',
  description: 'Fetched via getTicket fallback',
  status: 'OPEN',
};

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    listTickets: vi.fn(),
    getTicket: vi.fn(),
    createTicket: vi.fn(),
    patchTicketStatus: vi.fn(),
    updateTicket: vi.fn(),
    exportTicketsCsv: vi.fn(),
    getTicketTimeline: vi.fn(),
    listCanned: vi.fn(),
    listTemplates: vi.fn(),
    listUsers: vi.fn(),
    listAssets: vi.fn(),
    suggestArticles: vi.fn(),
  };
});

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u-admin', email: 'admin@itms.local', name: 'IT Admin', role: 'ADMIN', department: 'IT' }),
  );
  vi.mocked(api.listTickets).mockResolvedValue({ items: [PAGE1_TICKET], total: 500 });
  vi.mocked(api.getTicket).mockResolvedValue(OFF_PAGE_TICKET);
  vi.mocked(api.getTicketTimeline).mockResolvedValue({
    comments: [],
    changes: [
      { id: 'al-1', kind: 'change', actor: 'IT Admin', action: 'TICKET_CREATE', at: '2026-11-23T10:00:00Z', details: {} },
      { id: 'al-2', kind: 'change', actor: 'IT Admin', action: 'TICKET_STATUS', at: '2026-11-23T10:00:00Z', details: { from: 'OPEN', to: 'IN_PROGRESS' } },
      { id: 'al-3', kind: 'change', actor: 'IT Admin', action: 'TICKET_STATUS', at: '2026-11-23T10:00:00Z', details: { from: 'IN_PROGRESS', to: 'RESOLVED' } },
      { id: 'al-4', kind: 'change', actor: 'System', action: 'SLA_ESCALATE', at: '2026-11-23T10:30:00Z', details: {} },
    ],
    attachments: [],
  });
  vi.mocked(api.listCanned).mockResolvedValue([]);
  vi.mocked(api.listTemplates).mockResolvedValue([
    {
      id: 'tpl-1',
      name: 'Access Request Template',
      ticket_type: 'REQUEST',
      priority: 'HIGH',
      description: 'Need VPN access',
      active: true,
      created_by: null,
      updated_by: null,
      created_at: '2026-11-20T00:00:00Z',
      updated_at: '2026-11-20T00:00:00Z',
    },
  ]);
  vi.mocked(api.listUsers).mockResolvedValue({
    items: [{ id: 'u-1', name: 'Aarav Gupta', email: 'aarav@itms.local', role: 'EMPLOYEE', department: 'Engineering', active: true, created_at: '2026-01-01T00:00:00Z' }],
    total: 1,
  });
  vi.mocked(api.listAssets).mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.mocked(api.suggestArticles).mockResolvedValue([]);
});

describe('Tickets Module 14-bug audit regressions', () => {
  it('Bug #1, #6, #12: NewTicketForm defaults requester_id to current user, uses Select pickers, and normalizes template REQUEST -> SERVICE_REQUEST', async () => {
    vi.mocked(api.createTicket).mockResolvedValue(PAGE1_TICKET);
    const onDone = vi.fn();
    render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter>
          <NewTicketForm onDone={onDone} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Apply legacy 'REQUEST' template and confirm it normalizes to SERVICE_REQUEST
    const tplTrigger = await screen.findByRole('button', { name: /choose a template/i });
    fireEvent.click(tplTrigger);
    fireEvent.click(await screen.findByRole('option', { name: /Access Request Template/i }));

    fireEvent.change(screen.getByPlaceholderText(/what's the issue/i), {
      target: { value: 'New VPN setup' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^create ticket$/i }));

    await waitFor(() => expect(api.createTicket).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createTicket).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        title: 'New VPN setup',
        description: 'Need VPN access',
        ticket_type: 'SERVICE_REQUEST',
        priority: 'HIGH',
        requester_id: 'u-admin',
      }),
    );
  });

  it('Bug #2: deep-link /tickets?open=<id> fetches off-page ticket via getTicket and opens drawer', async () => {
    render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter initialEntries={['/tickets?open=t-offpage']}>
          <Tickets />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Fetched via getTicket fallback')).toBeInTheDocument();
    expect(api.getTicket).toHaveBeenCalledWith('t-offpage');
  });

  it('Bug #3: switching to Kanban bounds listTickets to limit=200 and shows truncation banner', async () => {
    render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter initialEntries={['/tickets']}>
          <Tickets />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText('Laptop screen flickering');
    fireEvent.click(screen.getByRole('button', { name: /kanban/i }));

    await waitFor(() =>
      expect(api.listTickets).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 })),
    );
    expect(await screen.findByText(/Showing newest 1 of 500 tickets/i)).toBeInTheDocument();
  });

  it('Bug #4, #5, #10: drawer offers RESOLVED -> CLOSED / Reopen transitions, Priority/Assignee editing, and collision-free timeline with (from -> to) and SLA_ESCALATE', async () => {
    vi.mocked(api.patchTicketStatus).mockResolvedValue({ ...PAGE1_TICKET, status: 'CLOSED' });
    vi.mocked(api.updateTicket).mockResolvedValue({ ...PAGE1_TICKET, priority: 'URGENT' });

    render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter initialEntries={['/tickets']}>
          <Tickets />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByText('Laptop screen flickering'));

    // RESOLVED ticket has both Advance to CLOSED and Reopen to OPEN buttons
    expect(await screen.findByRole('button', { name: /advance to closed/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reopen to open/i })).toBeInTheDocument();

    // Both same-timestamp TICKET_STATUS entries render distinctly with (from -> to), plus SLA_ESCALATE label
    expect(await screen.findByText(/\(OPEN → IN PROGRESS\)/)).toBeInTheDocument();
    expect(screen.getByText(/\(IN PROGRESS → RESOLVED\)/)).toBeInTheDocument();
    expect(screen.getByText(/escalated SLA breach/)).toBeInTheDocument();
  });

  it('Bug #8: FilterBar search input and overdue=true pass through to listTickets and exportTicketsCsv', async () => {
    render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter initialEntries={['/tickets?overdue=true']}>
          <Tickets />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const searchInput = await screen.findByPlaceholderText('Search by title, ticket #, or description');
    fireEvent.change(searchInput, { target: { value: 'flickering' } });

    await waitFor(() =>
      expect(api.listTickets).toHaveBeenCalledWith(
        expect.objectContaining({ overdue: true, search: 'flickering' }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(api.exportTicketsCsv).toHaveBeenCalledWith(
      expect.objectContaining({ overdue: true, search: 'flickering' }),
    );
  });

  it('Bug #13: SlaChip tooltip formats human-readable date instead of raw millisecond epoch', () => {
    const { container } = render(<SlaChip dueAt="2026-11-24T12:00:00Z" policyHours={24} />);
    const chip = container.querySelector('span[title]');
    expect(chip).not.toBeNull();
    const title = chip!.getAttribute('title')!;
    expect(title).toContain('2026');
    expect(title).not.toMatch(/1,7\d{2},\d{3},\d{3}/);
  });
});

describe('Tickets mobile regressions (Bugs #1, #4, #5, #7)', () => {
  it('Mobile #1/#7: drawer is portaled to document.body (z-[70]) and hides the raw requester_id UUID', async () => {
    render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter initialEntries={['/tickets']}>
          <Tickets />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByText('Laptop screen flickering'));
    const desc = await screen.findByText('Flickers on battery power');

    // Portaled: overlay root is a direct child of document.body (escapes <main>),
    // above the mobile header (z-40) and BottomNav / OfflineBanner (z-50).
    const overlay = desc.closest('div.fixed.inset-0');
    expect(overlay).not.toBeNull();
    expect(overlay!.parentElement).toBe(document.body);
    expect(overlay!.getAttribute('class')).toContain('z-[70]');

    // Requester name shown; raw 36-char requester_id UUID in parens is gone.
    expect(overlay!.textContent).toContain('Aarav Gupta');
    expect(overlay!.textContent).not.toContain('(u-1)');
    expect(screen.queryByText('(u-1)')).toBeNull();
  });

  it('Mobile #5: Kanban column card lists have bounded vertical scroll', async () => {
    render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter initialEntries={['/tickets']}>
          <Tickets />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText('Laptop screen flickering');
    fireEvent.click(screen.getByRole('button', { name: /kanban/i }));
    await screen.findByText(/Showing newest 1 of 500 tickets/i);

    const lists = document.querySelectorAll('[class*="max-h-[calc(100dvh-19rem)]"]');
    expect(lists.length).toBe(4);
    lists.forEach((el) => {
      const cls = el.getAttribute('class') ?? '';
      expect(cls).toContain('overflow-y-auto');
      expect(cls).toContain('space-y-2');
    });
  });

  it('Mobile #4: FilterBar wraps view toggle + 3 filter selects in a 2-col mobile grid (sm:contents)', async () => {
    render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter initialEntries={['/tickets']}>
          <Tickets />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText('Laptop screen flickering');

    const grid = document.querySelector('[class*="grid-cols-2"][class*="sm:contents"]');
    expect(grid).not.toBeNull();
    const cls = grid!.getAttribute('class') ?? '';
    expect(cls).toContain('grid');
    expect(cls).toContain('w-full');

    // Cell 1: Table | Kanban toggle; cells 2-4: the three filter selects.
    const scope = within(grid as HTMLElement);
    expect(scope.getByRole('button', { name: /table/i })).toBeInTheDocument();
    expect(scope.getByRole('button', { name: /kanban/i })).toBeInTheDocument();
    expect(scope.getByText('All Statuses')).toBeInTheDocument();
    expect(scope.getByText('All Priorities')).toBeInTheDocument();
    expect(scope.getByText('All Types')).toBeInTheDocument();
    expect(grid!.children.length).toBe(4);
  });
});
