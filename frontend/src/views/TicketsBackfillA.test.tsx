import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Tickets from './Tickets';
import DataTable from '@/components/DataTable';
import NewTicketForm from '@/components/NewTicketForm';
import * as api from '@/api/client';
import type { KbArticle, Ticket } from '@/api/types';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
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

const KB_ARTICLE: KbArticle = {
  id: 'kb-1',
  ticket_type: 'INCIDENT',
  title: 'Fix a flickering laptop screen',
  body: 'Reseat the display cable.',
  source_ticket_id: 't-page1',
  created_by: 'u-admin',
  updated_by: null,
  created_at: '2026-11-24T10:00:00Z',
  updated_at: '2026-11-24T10:00:00Z',
};

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    listTickets: vi.fn(),
    getTicket: vi.fn(),
    createTicket: vi.fn(),
    getTicketTimeline: vi.fn(),
    listCanned: vi.fn(),
    listTemplates: vi.fn(),
    listUsers: vi.fn(),
    listAssets: vi.fn(),
    suggestArticles: vi.fn(),
    getSlaPolicy: vi.fn(),
    exportTicketsCsv: vi.fn(),
    convertTicketToArticle: vi.fn(),
    createTicketComment: vi.fn(),
  };
});

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname + location.search}</div>;
}

function renderTickets(initialEntry = '/tickets', qc?: QueryClient) {
  render(
    <QueryClientProvider client={qc ?? makeQc()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <Tickets />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u-admin', email: 'admin@itms.local', name: 'IT Admin', role: 'ADMIN', department: 'IT' }),
  );
  vi.mocked(api.listTickets).mockResolvedValue({ items: [PAGE1_TICKET], total: 1 });
  vi.mocked(api.getTicket).mockResolvedValue(PAGE1_TICKET);
  vi.mocked(api.getTicketTimeline).mockResolvedValue({ comments: [], changes: [], attachments: [] });
  vi.mocked(api.listCanned).mockResolvedValue([]);
  vi.mocked(api.listTemplates).mockResolvedValue([]);
  vi.mocked(api.listUsers).mockResolvedValue({
    items: [{ id: 'u-1', name: 'Aarav Gupta', email: 'aarav@itms.local', role: 'AGENT', department: 'IT', active: true, created_at: '2026-01-01T00:00:00Z' }],
    total: 1,
  });
  vi.mocked(api.listAssets).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(api.suggestArticles).mockResolvedValue([]);
  vi.mocked(api.getSlaPolicy).mockResolvedValue({
    URGENT: { hours: 4, label: 'Urgent' },
    HIGH: { hours: 8, label: 'High' },
    MEDIUM: { hours: 24, label: 'Medium' },
    LOW: { hours: 72, label: 'Low' },
  });
});

async function openDrawer() {
  fireEvent.click(await screen.findByText('Laptop screen flickering'));
  return screen.findByRole('dialog', { name: 'Ticket INC-1001' });
}

describe('TFE-04 clickable DataTable rows are keyboard-operable (issue 66)', () => {
  const ROWS = [{ id: 'r-1', name: 'Alpha' }];

  it('clickable rows render tabIndex 0 and Enter/Space activates onRowClick; plain rows are not focusable', () => {
    const onRowClick = vi.fn();
    const { rerender } = render(
      <DataTable columns={[{ key: 'name', header: 'Name' }]} rows={ROWS} onRowClick={onRowClick} />,
    );
    const row = screen.getByRole('row', { name: /Alpha/ });
    expect(row).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toBe(ROWS[0]);

    fireEvent.keyDown(row, { key: ' ' });
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(onRowClick.mock.calls[1][0]).toBe(ROWS[0]);

    rerender(<DataTable columns={[{ key: 'name', header: 'Name' }]} rows={ROWS} />);
    expect(screen.getByRole('row', { name: /Alpha/ })).not.toHaveAttribute('tabindex');
  });
});

describe('TFE-05 search input debounces 300ms before updating params (issue 67)', () => {
  it('typing does not refetch immediately; the search param follows after 300ms', async () => {
    renderTickets();
    await screen.findByText('Laptop screen flickering');
    const callsBefore = vi.mocked(api.listTickets).mock.calls.length;

    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search tickets' }), { target: { value: 'printer' } });
      expect(vi.mocked(api.listTickets).mock.calls.length).toBe(callsBefore);

      await act(async () => {
        vi.advanceTimersByTime(300);
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      const last = vi.mocked(api.listTickets).mock.calls.at(-1)?.[0];
      expect(last).toMatchObject({ search: 'printer' });
    });
    expect(screen.getByTestId('location-probe')).toHaveTextContent('search=printer');
  });
});

describe('TFE-07 comment post failure keeps the draft and shows a FieldError (issue 69)', () => {
  it('failed post renders ticket-comment-error under the composer and preserves the draft', async () => {
    vi.mocked(api.createTicketComment).mockRejectedValueOnce(new Error('comment boom'));
    renderTickets();
    await openDrawer();

    const composer = screen.getByRole('textbox', { name: 'Add a comment' });
    fireEvent.change(composer, { target: { value: 'still investigating the flicker' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    const alert = await screen.findByText('comment boom');
    expect(vi.mocked(api.createTicketComment).mock.calls[0][0]).toBe('t-page1');
    expect(alert).toHaveAttribute('id', 'ticket-comment-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('textbox', { name: 'Add a comment' })).toHaveValue('still investigating the flicker');
  });
});

describe('TFE-09 two-way ?open= sync (issue 71)', () => {
  it('selecting a ticket writes ?open=, closing clears it', async () => {
    renderTickets();
    await openDrawer();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/tickets?open=t-page1');

    fireEvent.click(within(screen.getByRole('dialog', { name: 'Ticket INC-1001' })).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Ticket INC-1001' })).toBeNull();
    });
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/tickets');
    expect(screen.getByTestId('location-probe')).not.toHaveTextContent('open=');
  });

  it('?open= preselects and opens the drawer on mount', async () => {
    renderTickets('/tickets?open=t-page1');
    expect(await screen.findByRole('dialog', { name: 'Ticket INC-1001' })).toBeInTheDocument();
  });
});

describe('TFE-10 convert-to-KB confirm modal + failure error (issue 72)', () => {
  it('convert requires confirming in a Modal; failure shows ticket-convert-error and stays on the page', async () => {
    vi.mocked(api.convertTicketToArticle).mockRejectedValueOnce(new Error('kb boom'));
    renderTickets();
    await openDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Convert to KB article' }));
    const modal = await screen.findByRole('dialog', { name: 'Convert to KB article' });
    expect(vi.mocked(api.convertTicketToArticle)).not.toHaveBeenCalled();

    fireEvent.click(within(modal).getByRole('button', { name: 'Convert' }));

    const alert = await screen.findByText('kb boom');
    expect(vi.mocked(api.convertTicketToArticle).mock.calls[0][0]).toBe('t-page1');
    expect(alert).toHaveAttribute('id', 'ticket-convert-error');
    expect(screen.getByRole('dialog', { name: 'Convert to KB article' })).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/tickets');
  });
});

describe('TFE-11 successful convert invalidates kb-articles (issue 73)', () => {
  it('convert success invalidates the kb-articles query', async () => {
    vi.mocked(api.convertTicketToArticle).mockResolvedValueOnce(KB_ARTICLE);
    const qc = makeQc();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    renderTickets('/tickets', qc);
    await openDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Convert to KB article' }));
    const modal = await screen.findByRole('dialog', { name: 'Convert to KB article' });
    fireEvent.click(within(modal).getByRole('button', { name: 'Convert' }));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['kb-articles'] });
    });
  });
});

describe('TFE-13 CSV export pending and error states (issue 75)', () => {
  it('Export is disabled while running and re-enables after success', async () => {
    const gate = deferred<void>();
    vi.mocked(api.exportTicketsCsv).mockReturnValueOnce(gate.promise);
    renderTickets();
    await screen.findByText('Laptop screen flickering');

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByRole('button', { name: 'Export' })).toBeDisabled();

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
    });
  });

  it('export failure renders tickets-export-error with the message', async () => {
    vi.mocked(api.exportTicketsCsv).mockRejectedValueOnce(new Error('csv boom'));
    renderTickets();
    await screen.findByText('Laptop screen flickering');

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    const alert = await screen.findByText('Export failed: csv boom');
    expect(alert).toHaveAttribute('id', 'tickets-export-error');
  });
});

describe('TFE-16 KB suggestion links open in a new tab safely (issue 78)', () => {
  it('suggestion links render target=_blank rel=noreferrer', async () => {
    vi.mocked(api.suggestArticles).mockResolvedValue([KB_ARTICLE]);
    render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter initialEntries={['/tickets']}>
          <NewTicketForm onDone={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText("What's the issue?"), { target: { value: 'flickering screen' } });
    expect(await screen.findByText('Maybe this already exists in the KB?')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /Fix a flickering laptop screen/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(link).toHaveAttribute('href', '/kb?open=kb-1');
  });
});
