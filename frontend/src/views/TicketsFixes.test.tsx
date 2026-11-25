import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Tickets from './Tickets';
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
    getSlaPolicy: vi.fn(),
    convertTicketToArticle: vi.fn(),
    createTicketComment: vi.fn(),
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

function renderTickets(initialEntry = '/tickets') {
  render(
    <QueryClientProvider client={makeQc()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Tickets />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setUser('ADMIN');
  vi.mocked(api.listTickets).mockResolvedValue({ items: [PAGE1_TICKET], total: 1 });
  vi.mocked(api.getTicket).mockResolvedValue(PAGE1_TICKET);
  vi.mocked(api.getTicketTimeline).mockResolvedValue({ comments: [], changes: [], attachments: [] });
  vi.mocked(api.listCanned).mockResolvedValue([]);
  vi.mocked(api.listUsers).mockResolvedValue({
    items: [{ id: 'u-1', name: 'Aarav Gupta', email: 'aarav@itms.local', role: 'AGENT', department: 'IT', active: true, created_at: '2026-01-01T00:00:00Z' }],
    total: 1,
  });
  vi.mocked(api.getSlaPolicy).mockResolvedValue({
    URGENT: { hours: 4, label: 'Urgent' },
    HIGH: { hours: 8, label: 'High' },
    MEDIUM: { hours: 24, label: 'Medium' },
    LOW: { hours: 72, label: 'Low' },
  });
});

describe('Tickets FE1 fixes (TFE-01, TFE-08, TFE-03)', () => {
  it('TFE-01: list fetch failure renders an error panel with Retry, not "No tickets found"', async () => {
    vi.mocked(api.listTickets).mockRejectedValueOnce(new Error('network down'));
    renderTickets();

    expect(await screen.findByText(/couldn't load tickets/i)).toBeInTheDocument();
    expect(screen.getByText(/network down/i)).toBeInTheDocument();
    expect(screen.queryByText('No tickets found')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Laptop screen flickering')).toBeInTheDocument();
  });

  it('TFE-08: bad ?open= id shows a "Ticket not found" notice, no drawer; Dismiss clears it', async () => {
    vi.mocked(api.getTicket).mockRejectedValue(new Error('not found'));
    renderTickets('/tickets?open=no-such-ticket');

    expect(await screen.findByText(/ticket not found/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await waitFor(() => expect(screen.queryByText(/ticket not found/i)).toBeNull());
  });

  it('TFE-03: EMPLOYEE drawer is read-only — no priority/assignee/transition controls', async () => {
    setUser('EMPLOYEE');
    renderTickets();

    fireEvent.click(await screen.findByText('Laptop screen flickering'));
    const dialog = await screen.findByRole('dialog');
    const scope = within(dialog);

    // Staff-only controls are gone …
    expect(scope.queryByRole('button', { name: /^medium$/i })).toBeNull();
    expect(scope.queryByRole('button', { name: /^unassigned$/i })).toBeNull();
    expect(scope.queryByRole('button', { name: /advance to/i })).toBeNull();
    expect(scope.queryByRole('button', { name: /reopen/i })).toBeNull();
    expect(scope.queryByRole('button', { name: /edit title/i })).toBeNull();

    // … but the read-only values still show (header badge + read-only section).
    expect(scope.getAllByText('MEDIUM').length).toBe(2);
    expect(scope.getByText('Unassigned')).toBeInTheDocument();
  });

  it('TFE-29/C1: staff title edit PATCHes title/description/ticket_type', async () => {
    vi.mocked(api.updateTicket).mockResolvedValue({ ...PAGE1_TICKET, title: 'Fixed title' });
    renderTickets();

    fireEvent.click(await screen.findByText('Laptop screen flickering'));
    fireEvent.click(await screen.findByRole('button', { name: /edit title/i }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Fixed title' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(api.updateTicket).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updateTicket).mock.calls[0][0]).toBe('t-page1');
    expect(vi.mocked(api.updateTicket).mock.calls[0][1]).toEqual(
      expect.objectContaining({ title: 'Fixed title', ticket_type: 'INCIDENT' }),
    );
  });
});
