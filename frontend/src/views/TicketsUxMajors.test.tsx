import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Tickets from './Tickets';
import * as api from '@/api/client';
import type { Asset, Ticket } from '@/api/types';

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
  status: 'OPEN',
  requester_id: 'u-1',
  requester_name: 'Aarav Gupta',
  assignee_id: null,
  assignee_name: null,
  asset_id: 'a-1',
  asset_tag: 'AST-10014',
  asset_name: 'Lenovo IdeaPad',
  sla_due_at: '2020-05-01T00:00:00Z',
  sla_escalated_at: null,
  created_at: '2026-11-23T10:00:00Z',
  updated_at: '2026-11-23T11:00:00Z',
};

const TICKET_NO_ASSET: Ticket = {
  ...PAGE1_TICKET,
  id: 't-noasset',
  ticket_number: 'INC-1002',
  title: 'VPN not connecting',
  asset_id: null,
  asset_tag: null,
  asset_name: null,
};

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    listTickets: vi.fn(),
    getTicket: vi.fn(),
    updateTicket: vi.fn(),
    getTicketTimeline: vi.fn(),
    listCanned: vi.fn(),
    listTemplates: vi.fn(),
    listUsers: vi.fn(),
    listAssets: vi.fn(),
    suggestArticles: vi.fn(),
    getSlaPolicy: vi.fn(),
    convertTicketToArticle: vi.fn(),
    createTicketComment: vi.fn(),
    deleteTicketComment: vi.fn(),
    deleteTicketAttachment: vi.fn(),
  };
});

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function setUser(role: string) {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u-test', email: 'test@itms.local', name: 'Test User', role, department: 'IT' }),
  );
}

function LocationProbe() {
  const [params] = useSearchParams();
  return <span data-testid="location-search">{params.toString()}</span>;
}

function renderTickets(initialEntry = '/tickets') {
  render(
    <QueryClientProvider client={makeQc()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <Tickets />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function asset(over: Partial<Asset> & Pick<Asset, 'id'>): Asset {
  return {
    asset_tag: 'AST-20001',
    name: 'Dell Monitor',
    category: 'MONITOR',
    serial_number: null,
    status: 'IN_USE',
    assigned_to_user_id: null,
    assigned_user_name: null,
    specs: {},
    purchase_date: null,
    warranty_expiry: null,
    unit_cost: null,
    expected_eol: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as Asset;
}

beforeEach(() => {
  setUser('ADMIN');
  vi.mocked(api.listTickets).mockResolvedValue({ items: [PAGE1_TICKET], total: 1 });
  vi.mocked(api.getTicket).mockResolvedValue(PAGE1_TICKET);
  vi.mocked(api.getTicketTimeline).mockResolvedValue({ comments: [], changes: [], attachments: [] });
  vi.mocked(api.listCanned).mockResolvedValue([]);
  vi.mocked(api.listTemplates).mockResolvedValue([]);
  vi.mocked(api.listUsers).mockResolvedValue({
    items: [{ id: 'u-1', name: 'Aarav Gupta', email: 'aarav@itms.local', role: 'AGENT', department: 'IT', active: true, created_at: '2026-01-01T00:00:00Z' }],
    total: 1,
  });
  vi.mocked(api.listAssets).mockResolvedValue({
    items: [asset({ id: 'a-2', asset_tag: 'AST-20001', name: 'Dell Monitor' })],
    total: 1,
  });
  vi.mocked(api.suggestArticles).mockResolvedValue([]);
  vi.mocked(api.getSlaPolicy).mockResolvedValue({
    URGENT: { hours: 4, label: 'Urgent' },
    HIGH: { hours: 8, label: 'High' },
    MEDIUM: { hours: 24, label: 'Medium' },
    LOW: { hours: 72, label: 'Low' },
  });
  vi.mocked(api.updateTicket).mockImplementation((id, input) =>
    Promise.resolve({ ...PAGE1_TICKET, ...input, id } as Ticket),
  );
});

async function openDrawer(title = 'Laptop screen flickering') {
  fireEvent.click(await screen.findByText(title));
  return screen.findByRole('dialog', { name: /Ticket INC-100/ });
}

function lastListCall() {
  const calls = vi.mocked(api.listTickets).mock.calls;
  return calls[calls.length - 1][0];
}

describe('UX-05 drawer asset link/unlink Select for staff (issue 179)', () => {
  it('renders the NewTicketForm picker pattern (None + TAG · name)', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({ items: [TICKET_NO_ASSET], total: 1 });
    renderTickets();
    await openDrawer('VPN not connecting');

    fireEvent.click(screen.getByRole('button', { name: 'Ticket linked asset' }));
    expect(await screen.findByRole('option', { name: 'None (optional)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'AST-20001 · Dell Monitor' })).toBeInTheDocument();
  });

  it('linking an asset PATCHes { asset_id }', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({ items: [TICKET_NO_ASSET], total: 1 });
    renderTickets();
    await openDrawer('VPN not connecting');

    fireEvent.click(screen.getByRole('button', { name: 'Ticket linked asset' }));
    fireEvent.click(await screen.findByRole('option', { name: 'AST-20001 · Dell Monitor' }));

    await waitFor(() => expect(api.updateTicket).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updateTicket).mock.calls[0][0]).toBe('t-noasset');
    expect(vi.mocked(api.updateTicket).mock.calls[0][1]).toEqual({ asset_id: 'a-2' });
  });

  it('unlinking via None PATCHes { asset_id: null }', async () => {
    renderTickets();
    await openDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Ticket linked asset' }));
    fireEvent.click(await screen.findByRole('option', { name: 'None (optional)' }));

    await waitFor(() => expect(api.updateTicket).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updateTicket).mock.calls[0][1]).toEqual({ asset_id: null });
  });

  it('re-selecting the current asset is a no-op', async () => {
    renderTickets();
    await openDrawer();

    // Current asset a-1 is past the fetched page, so it is pinned (below).
    fireEvent.click(screen.getByRole('button', { name: 'Ticket linked asset' }));
    fireEvent.click(await screen.findByRole('option', { name: 'AST-10014 · Lenovo IdeaPad' }));
    expect(api.updateTicket).not.toHaveBeenCalled();
  });

  it('pins the current asset when it is missing from the fetched page', async () => {
    renderTickets();
    await openDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Ticket linked asset' }));
    expect(await screen.findByRole('option', { name: 'AST-10014 · Lenovo IdeaPad' })).toBeInTheDocument();
  });

  it('is hidden for EMPLOYEE', async () => {
    setUser('EMPLOYEE');
    renderTickets();
    await openDrawer();
    expect(screen.queryByRole('button', { name: 'Ticket linked asset' })).not.toBeInTheDocument();
  });
});

describe('UX-06 inline FieldError under the drawer title input (issue 180)', () => {
  it('empty title shows an inline error via aria-describedby instead of a silent disable', async () => {
    renderTickets();
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Edit title, type & description' }));

    const input = await screen.findByLabelText('Title');
    fireEvent.change(input, { target: { value: '   ' } });

    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    const err = await screen.findByRole('alert');
    expect(err).toHaveTextContent('Title is required.');
    expect(err).toHaveAttribute('id', 'ticket-edit-title-error');
    expect(input).toHaveAttribute('aria-describedby', 'ticket-edit-title-error');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveFocus();
    expect(api.updateTicket).not.toHaveBeenCalled();
  });

  it('typing clears the error and a valid save PATCHes the trimmed title', async () => {
    renderTickets();
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Edit title, type & description' }));

    const input = await screen.findByLabelText('Title');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Title is required.')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '  Fixed title  ' } });
    expect(screen.queryByText('Title is required.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.updateTicket).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updateTicket).mock.calls[0][0]).toBe('t-page1');
    expect(vi.mocked(api.updateTicket).mock.calls[0][1]).toMatchObject({ title: 'Fixed title' });
  });
});

describe('UX-07 N-filters-active badge + Clear all (issue 181)', () => {
  it('counts across status/priority/type/search/overdue and clears all five', async () => {
    renderTickets('/tickets?status=OPEN&priority=HIGH&type=INCIDENT&search=lap&overdue=true');
    expect(await screen.findByText('5 filters active')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(screen.queryByText(/filters? active/)).not.toBeInTheDocument());
    await waitFor(() => expect(lastListCall()).toMatchObject({ status: undefined }));
    expect(lastListCall()).toMatchObject({
      status: undefined,
      priority: undefined,
      type: undefined,
      search: undefined,
      overdue: undefined,
    });
  });

  it('uses the singular for one filter and hides with none', async () => {
    renderTickets('/tickets?status=OPEN');
    expect(await screen.findByText('1 filter active')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(screen.queryByText(/filters? active/)).not.toBeInTheDocument());
  });
});

describe('UX-08 overdue toggle next to the three Selects (issue 182)', () => {
  it('writes ?overdue=true and keeps the chip UI for the active state', async () => {
    renderTickets();
    await screen.findByText('Laptop screen flickering');

    const toggle = screen.getByRole('button', { name: 'Show overdue only' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);

    expect(await screen.findByText('Overdue only')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(lastListCall()).toMatchObject({ overdue: true }));
    expect(screen.getByTestId('location-search').textContent).toContain('overdue=true');

    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByText('Overdue only')).not.toBeInTheDocument());
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('UX-10 SlaChip on each kanban card (issue 184)', () => {
  it('shows the SLA chip on the card number row', async () => {
    renderTickets();
    await screen.findByText('Laptop screen flickering');

    fireEvent.click(screen.getByRole('button', { name: 'Kanban' }));
    // sla_due_at is long past → the chip reads OVERDUE.
    const chip = await screen.findByText(/OVERDUE/);
    expect(chip).toBeInTheDocument();
    expect(screen.getByText('INC-1001')).toBeInTheDocument();
  });
});

describe('UX-11 no-results echo + Clear search & filters (issue 185)', () => {
  it('echoes the query and clears search + filters', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({ items: [], total: 0 });
    renderTickets('/tickets?search=nope&status=OPEN');

    expect(await screen.findByText(/No tickets match "nope"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search & filters' }));

    await waitFor(() => expect(lastListCall()).toMatchObject({ search: undefined }));
    expect(lastListCall()).toMatchObject({ status: undefined });
    expect(screen.getByTestId('location-search').textContent).not.toContain('search=');
  });

  it('offers the clear action for filter-only empties too', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({ items: [], total: 0 });
    renderTickets('/tickets?status=CLOSED');

    expect(await screen.findByText('No tickets found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search & filters' }));
    await waitFor(() => expect(lastListCall()).toMatchObject({ status: undefined }));
  });
});

describe('UX-12 sortable SLA column + kanban sort Select (issue 186)', () => {
  it('SLA header cycles ?sort=sla_due_at&order=', async () => {
    renderTickets();
    await screen.findByText('Laptop screen flickering');

    fireEvent.click(screen.getByRole('button', { name: 'SLA' }));
    await waitFor(() => expect(lastListCall()).toMatchObject({ sort: 'sla_due_at', order: 'asc' }));
    expect(screen.getByTestId('location-search').textContent).toContain('sort=sla_due_at');

    fireEvent.click(screen.getByRole('button', { name: 'SLA' }));
    await waitFor(() => expect(lastListCall()).toMatchObject({ sort: 'sla_due_at', order: 'desc' }));
  });

  it('kanban sort Select writes ?sort=&order= incl. sla_due_at', async () => {
    renderTickets();
    await screen.findByText('Laptop screen flickering');
    fireEvent.click(screen.getByRole('button', { name: 'Kanban' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Sort kanban tickets' }));
    fireEvent.click(await screen.findByRole('option', { name: 'SLA due ↑' }));

    await waitFor(() => expect(lastListCall()).toMatchObject({ sort: 'sla_due_at', order: 'asc' }));
    expect(screen.getByTestId('location-search').textContent).toContain('sort=sla_due_at');
  });
});

describe('UX-09 ?page= read/write (issue 183)', () => {
  it('reads the initial page from the URL', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({ items: [PAGE1_TICKET], total: 45 });
    renderTickets('/tickets?page=3');

    await waitFor(() => expect(lastListCall()).toMatchObject({ offset: 40, limit: 20 }));
  });

  it('writes ?page= back on page change (page 1 omits it)', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({ items: [PAGE1_TICKET], total: 45 });
    renderTickets();
    await screen.findByText('Laptop screen flickering');

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(screen.getByTestId('location-search').textContent).toContain('page=2'));
    await waitFor(() => expect(lastListCall()).toMatchObject({ offset: 20 }));

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    await waitFor(() => expect(screen.getByTestId('location-search').textContent).not.toContain('page='));
    await waitFor(() => expect(lastListCall()).toMatchObject({ offset: 0 }));
  });

  it('reset-on-filter-change also drops ?page=', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({ items: [PAGE1_TICKET], total: 45 });
    renderTickets('/tickets?page=3');
    await waitFor(() => expect(lastListCall()).toMatchObject({ offset: 40 }));

    fireEvent.click(screen.getByRole('button', { name: 'Filter tickets by status' }));
    fireEvent.click(await screen.findByRole('option', { name: 'OPEN' }));

    await waitFor(() => expect(screen.getByTestId('location-search').textContent).not.toContain('page='));
    await waitFor(() => expect(lastListCall()).toMatchObject({ offset: 0, status: 'OPEN' }));
  });
});
