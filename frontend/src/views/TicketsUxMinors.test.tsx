import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Tickets from './Tickets';
import * as api from '@/api/client';
import type { CannedResponse, Ticket, TicketAttachment, TicketComment } from '@/api/types';
import { formatDate } from '@/lib/utils';

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
  asset_id: null,
  asset_tag: null,
  asset_name: null,
  sla_due_at: '2020-05-01T00:00:00Z',
  sla_escalated_at: null,
  created_at: '2026-11-23T10:00:00Z',
  updated_at: new Date(Date.now() - 5 * 60_000).toISOString(),
};

const ATTACH_A1: TicketAttachment = {
  id: 'att-1',
  ticket_id: 't-page1',
  uploader_id: 'u-ivy',
  file_name: 'report.pdf',
  content_type: 'application/pdf',
  size_bytes: 12345,
  storage_key: 'k1',
  created_at: '2026-11-23T12:00:00Z',
  uploader_name: 'Ivy Uploader',
};

const COMMENT_C1: TicketComment = {
  id: 'c-1',
  ticket_id: 't-page1',
  author_id: 'u-test',
  body: 'still investigating',
  mentions: [],
  created_at: '2026-11-23T11:00:00Z',
  author_name: 'Test User',
};

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    listTickets: vi.fn(),
    getTicket: vi.fn(),
    updateTicket: vi.fn(),
    patchTicketStatus: vi.fn(),
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
    downloadTicketAttachment: vi.fn(),
    uploadTicketAttachment: vi.fn(),
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

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function LocationProbe() {
  const [params] = useSearchParams();
  return <span data-testid="location-search">{params.toString()}</span>;
}

function InvalidateProbe() {
  const qc = useQueryClient();
  return (
    <button type="button" onClick={() => void qc.invalidateQueries({ queryKey: ['tickets'] })}>
      refetch-probe
    </button>
  );
}

function renderTickets(initialEntry = '/tickets', withProbe = false) {
  render(
    <QueryClientProvider client={makeQc()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        {withProbe && <InvalidateProbe />}
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

async function openDrawer(title = 'Laptop screen flickering') {
  fireEvent.click(await screen.findByText(title));
  return screen.findByRole('dialog', { name: /Ticket INC-100/ });
}

function lastListCall() {
  const calls = vi.mocked(api.listTickets).mock.calls;
  return calls[calls.length - 1][0];
}

describe('UX-13a sub-12px text raised to 12px in Tickets (issue 187)', () => {
  it('kanban ticket numbers honour the 12px floor', async () => {
    renderTickets();
    await screen.findByText('Laptop screen flickering');
    fireEvent.click(screen.getByRole('button', { name: 'Kanban' }));

    const num = await screen.findByText('INC-1001');
    expect(num.className).toContain('text-xs');
    expect(num.className).not.toContain('text-[10px]');
  });

  it('drawer SLA meta and timeline timestamps honour the 12px floor', async () => {
    vi.mocked(api.getTicketTimeline).mockResolvedValue({
      comments: [],
      changes: [{ kind: 'change', actor: 'Aarav', action: 'TICKET_STATUS', at: '2026-11-23T12:00:00Z', details: { from: 'OPEN', to: 'IN_PROGRESS' } }],
      attachments: [],
    });
    renderTickets();
    await openDrawer();

    const slaLabel = screen.getByText(/SLA · 24h policy/);
    expect(slaLabel.className).toContain('text-xs');
    expect(slaLabel.className).not.toContain('text-[');

    // The thread resolves async — wait for the change row.
    const stamp = await screen.findByText(formatDate('2026-11-23T12:00:00Z'));
    expect(stamp.className).toContain('text-xs');
    expect(stamp.className).not.toContain('text-[');
  });
});

describe('UX-14a 44pt chip-X target (issue 188)', () => {
  it('the overdue chip clear button is a 44pt target', async () => {
    renderTickets('/tickets?overdue=true');
    const clear = await screen.findByRole('button', { name: 'Clear overdue filter' });
    expect(clear.className).toContain('min-h-[44px]');
    expect(clear.className).toContain('min-w-[44px]');
  });
});

describe('UX-15a title tooltip on truncated title cells (issue 189)', () => {
  it('the truncated title carries the full title as its tooltip', async () => {
    renderTickets();
    await screen.findByText('Laptop screen flickering');
    expect(screen.getByTitle('Laptop screen flickering')).toBeInTheDocument();
  });
});

describe('UX-16 qualified kanban counts + cap hint + open-in-table (issue 190)', () => {
  function manyOpen(n: number): Ticket[] {
    return Array.from({ length: n }, (_, i) => ({
      ...PAGE1_TICKET,
      id: `t-${i}`,
      ticket_number: `INC-${2000 + i}`,
      title: `Bulk ticket ${i}`,
    }));
  }

  it('truncated column counts read "N of newest 200"', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({ items: manyOpen(200), total: 500 });
    renderTickets('/tickets?view=kanban');

    const heading = await screen.findByRole('heading', { name: 'OPEN' });
    const badge = heading.parentElement!.querySelector('span[title]')!;
    expect(badge.textContent).toBe('200 of newest 200');
    expect(badge.getAttribute('title')).toContain('of newest 200');
  });

  it('shows a visible cap hint with an open-in-table escape hatch', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({ items: manyOpen(200), total: 500 });
    renderTickets('/tickets?view=kanban');

    expect(await screen.findByText(/refine the filters/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'open in table view' }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByTestId('location-search').textContent).not.toContain('view=');
  });

  it('untruncated columns keep the bare count', async () => {
    renderTickets('/tickets?view=kanban');
    const heading = await screen.findByRole('heading', { name: 'OPEN' });
    const badge = heading.parentElement!.querySelector('span[title]')!;
    expect(badge.textContent).toBe('1');
    expect(screen.queryByText(/refine the filters/i)).toBeNull();
  });
});

describe('UX-17 background-update indicator (issue 191)', () => {
  it('shows a subtle Updating status during a background refetch', async () => {
    renderTickets('/tickets', true);
    await screen.findByText('Laptop screen flickering');

    const gate = deferred<{ items: Ticket[]; total: number }>();
    void gate.promise.catch(() => undefined);
    vi.mocked(api.listTickets).mockReturnValueOnce(gate.promise);
    fireEvent.click(screen.getByRole('button', { name: 'refetch-probe' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Updating…');
    // Non-blocking: the table stays interactive underneath.
    expect(screen.getByText('Laptop screen flickering')).toBeInTheDocument();

    gate.resolve({ items: [PAGE1_TICKET], total: 1 });
    await waitFor(() => expect(screen.queryByText('Updating…')).toBeNull());
  });
});

describe('UX-18 search-scope hint (issue 192)', () => {
  it('the search placeholder names title, number, and description', async () => {
    renderTickets();
    const input = await screen.findByPlaceholderText('Search by title, ticket #, or description');
    expect(input).toHaveAttribute('aria-label', 'Search tickets');
  });
});

describe('UX-19 recent searches (issue 193)', () => {
  it('committed searches appear as clickable chips and persist in localStorage', async () => {
    renderTickets();
    await screen.findByText('Laptop screen flickering');
    const input = screen.getByRole('searchbox', { name: 'Search tickets' });

    fireEvent.change(input, { target: { value: 'printer' } });
    const chip = await screen.findByRole('button', { name: 'printer' });
    expect(JSON.parse(localStorage.getItem('itms-ticket-recent-searches') ?? '[]')).toEqual(['printer']);
    // The chip (local state) can paint before the URL navigation flushes —
    // wait for the commit or the next keystroke races the sync effect.
    await waitFor(() => expect(screen.getByTestId('location-search').textContent).toContain('search=printer'));

    fireEvent.change(input, { target: { value: 'vpn' } });
    await screen.findByRole('button', { name: 'vpn' });
    await waitFor(() => expect(screen.getByTestId('location-search').textContent).toContain('search=vpn'));

    fireEvent.click(chip);
    expect(screen.getByRole('searchbox', { name: 'Search tickets' })).toHaveValue('printer');
  });

  it('recent searches survive a remount and are clearable', async () => {
    localStorage.setItem('itms-ticket-recent-searches', JSON.stringify(['flicker']));
    renderTickets();
    await screen.findByText('Laptop screen flickering');
    expect(await screen.findByRole('button', { name: 'flicker' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'flicker' })).toBeNull());
    expect(localStorage.getItem('itms-ticket-recent-searches')).toBeNull();
  });
});

describe('UX-20 ?view= persistence (issue 194)', () => {
  it('reads the initial view from the URL', async () => {
    renderTickets('/tickets?view=kanban');
    expect(await screen.findByRole('region', { name: 'Kanban board' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('writes ?view= on toggle without touching the default table URL', async () => {
    renderTickets();
    await screen.findByText('Laptop screen flickering');
    expect(screen.getByTestId('location-search').textContent).not.toContain('view=');

    fireEvent.click(screen.getByRole('button', { name: 'Kanban' }));
    await waitFor(() => expect(screen.getByTestId('location-search').textContent).toContain('view=kanban'));

    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    await waitFor(() => expect(screen.getByTestId('location-search').textContent).not.toContain('view='));
  });
});

describe('UX-21 Updated column (issue 195)', () => {
  it('shows a relative stamp with the absolute date as tooltip', async () => {
    renderTickets();
    await screen.findByText('Laptop screen flickering');

    expect(screen.getByRole('button', { name: 'Updated' })).toBeInTheDocument();
    const stamp = screen.getByText('5m ago');
    expect(stamp.getAttribute('title')).toBe(formatDate(PAGE1_TICKET.updated_at));
  });

  it('sorts by updated_at through the header', async () => {
    renderTickets();
    await screen.findByText('Laptop screen flickering');

    fireEvent.click(screen.getByRole('button', { name: 'Updated' }));
    await waitFor(() => expect(lastListCall()).toMatchObject({ sort: 'updated_at', order: 'asc' }));
  });
});

describe('UX-23 labelled kanban region + real headings (issue 197)', () => {
  it('exposes the board as a region with heading columns', async () => {
    renderTickets('/tickets?view=kanban');
    expect(await screen.findByRole('region', { name: 'Kanban board' })).toBeInTheDocument();
    // Headings resolve async (the region also matches the loading skeleton).
    expect(await screen.findByRole('heading', { name: 'OPEN' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'IN PROGRESS' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'RESOLVED' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'CLOSED' })).toBeInTheDocument();
  });
});

describe('UX-24 nowrap Type cells (issue 198)', () => {
  it('type cells never wrap', async () => {
    renderTickets();
    await screen.findByText('Laptop screen flickering');
    expect(screen.getByText('INCIDENT').className).toContain('whitespace-nowrap');
  });
});

describe('UX-25 red overdue chip (issue 199)', () => {
  it('the overdue toggle and chip are red, not amber', async () => {
    renderTickets('/tickets?overdue=true');
    expect(await screen.findByText('Overdue only')).toBeInTheDocument();

    const chip = screen.getByText('Overdue only').closest('span')!;
    expect(chip.className).toContain('text-red-700');
    expect(chip.className).not.toContain('text-amber-700');

    const toggle = screen.getByRole('button', { name: 'Show overdue only' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle.className).toContain('text-red-700');
  });
});

describe('UX-26 matching Export + New Ticket sizes (issue 200)', () => {
  it('both header buttons render at the same size', async () => {
    renderTickets();
    await screen.findByText('Laptop screen flickering');

    const exportBtn = screen.getByRole('button', { name: 'Export' });
    const newBtn = screen.getByRole('button', { name: 'New Ticket' });
    expect(exportBtn.className).toContain('h-9');
    expect(exportBtn.className).not.toContain('h-10');
    expect(newBtn.className).toContain('h-9');
  });
});

describe('UX-27 shared Cancel/Delete snippet (issue 201)', () => {
  it('comment deletes confirm via Cancel-left + red-Delete-right', async () => {
    vi.mocked(api.getTicketTimeline).mockResolvedValue({ comments: [COMMENT_C1], changes: [], attachments: [] });
    renderTickets();
    const dialog = await openDrawer();
    const scope = within(dialog);

    fireEvent.click(await scope.findByRole('button', { name: 'Delete comment' }));
    const cancel = scope.getByRole('button', { name: 'Cancel' });
    const del = scope.getByRole('button', { name: 'Delete' });
    expect(del.className).toContain('bg-red-500');
    expect(cancel.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(scope.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('attachment deletes use the same snippet', async () => {
    vi.mocked(api.getTicketTimeline).mockResolvedValue({ comments: [], changes: [], attachments: [ATTACH_A1] });
    vi.mocked(api.downloadTicketAttachment).mockResolvedValue(new Blob(['x']));
    renderTickets();
    const dialog = await openDrawer();
    const scope = within(dialog);

    fireEvent.click(await scope.findByRole('button', { name: 'Delete attachment' }));
    const cancel = scope.getByRole('button', { name: 'Cancel' });
    const del = scope.getByRole('button', { name: 'Delete' });
    expect(del.className).toContain('bg-red-500');
    expect(cancel.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('UX-28 FieldError alerts for upload + advance failures (issue 202)', () => {
  it('an oversize upload renders a role=alert FieldError', async () => {
    renderTickets('/tickets?open=t-page1');
    const dialog = await screen.findByRole('dialog');
    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;

    const big = new File([new ArrayBuffer(11 * 1024 * 1024)], 'big-archive.zip', { type: 'application/zip' });
    fireEvent.change(fileInput, { target: { files: [big] } });

    const alert = await within(dialog).findByText('File exceeds the 10 MB limit.');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveAttribute('id', 'ticket-upload-error');
  });

  it('a status-advance failure renders a role=alert FieldError', async () => {
    vi.mocked(api.patchTicketStatus).mockRejectedValueOnce(new Error('advance boom'));
    renderTickets();
    await openDrawer();

    fireEvent.click(screen.getByRole('button', { name: /advance to/i }));
    const alert = await screen.findByText('advance boom');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveAttribute('id', 'ticket-advance-error');
  });
});

describe('UX-29 No-activity empty state (issue 203)', () => {
  it('renders icon + heading + message', async () => {
    renderTickets();
    await openDrawer();

    const heading = await screen.findByText('No activity yet.');
    expect(heading).toBeInTheDocument();
    expect(screen.getByText('Comments and ticket updates will appear here.')).toBeInTheDocument();
    expect(heading.closest('div')!.querySelector('svg')).not.toBeNull();
  });
});

describe('UX-30 attachments empty line + size hint (issue 204)', () => {
  it('shows the empty line and the limits next to Attach', async () => {
    renderTickets();
    await openDrawer();

    expect(await screen.findByText('No attachments yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach file' })).toBeInTheDocument();
    expect(screen.getByText(/Max 10 MB/)).toBeInTheDocument();
  });
});

describe('UX-31 downloading spinner + disabled row (issue 205)', () => {
  it('disables the row with a spinner while the blob fetch is in flight', async () => {
    vi.mocked(api.getTicketTimeline).mockResolvedValue({ comments: [], changes: [], attachments: [ATTACH_A1] });
    const gate = deferred<Blob>();
    void gate.promise.catch(() => undefined);
    vi.mocked(api.downloadTicketAttachment).mockReturnValueOnce(gate.promise);
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      renderTickets();
      const dialog = await openDrawer();
      const scope = within(dialog);

      fireEvent.click(await scope.findByTitle('Download report.pdf'));
      const downloading = await scope.findByTitle('Downloading report.pdf…');
      expect(downloading).toBeDisabled();
      expect(downloading.querySelector('svg.animate-spin')).not.toBeNull();

      gate.resolve(new Blob(['pdf-bytes']));
      await waitFor(() => expect(clickSpy).toHaveBeenCalled());
      expect(await scope.findByTitle('Download report.pdf')).toBeEnabled();
    } finally {
      clickSpy.mockRestore();
    }
  });
});

describe('UX-32 uploader + date on attachment rows (issue 206)', () => {
  it('names who attached the file and when', async () => {
    vi.mocked(api.getTicketTimeline).mockResolvedValue({ comments: [], changes: [], attachments: [ATTACH_A1] });
    vi.mocked(api.downloadTicketAttachment).mockResolvedValue(new Blob(['x']));
    renderTickets();
    await openDrawer();

    await screen.findByText('report.pdf');
    const meta = screen.getByText(/Ivy Uploader/);
    expect(meta.textContent).toContain(formatDate('2026-11-23T12:00:00Z'));
  });
});

describe('UX-33 multiline expandable canned previews (issue 207)', () => {
  const CANNED: CannedResponse[] = [
    { id: 'c1', title: 'Ack', body: 'line one\nline two\nline three\nline four', created_by: null, created_at: '2026-01-01T00:00:00Z' },
    { id: 'c2', title: 'Close', body: 'closing line one\nclosing line two\nclosing line three', created_by: null, created_at: '2026-01-01T00:00:00Z' },
  ];

  it('previews wrap multiline and the active option expands fully', async () => {
    vi.mocked(api.listCanned).mockResolvedValue(CANNED);
    renderTickets();
    await openDrawer();

    // The trigger appears once the canned query resolves.
    fireEvent.click(await screen.findByRole('button', { name: 'Canned response' }));
    await screen.findByRole('listbox', { name: 'Canned responses' });

    const active = document.getElementById('canned-opt-c1')!;
    const idle = document.getElementById('canned-opt-c2')!;
    const activePreview = active.querySelectorAll('span')[1];
    const idlePreview = idle.querySelectorAll('span')[1];
    expect(activePreview.className).toContain('whitespace-pre-wrap');
    expect(activePreview.className).not.toContain('line-clamp-2');
    expect(idlePreview.className).toContain('line-clamp-2');
    expect(active.getAttribute('title')).toContain('line four');
  });
});

describe('UX-34 labelled activity count (issue 208)', () => {
  it('reads "N comments"', async () => {
    vi.mocked(api.getTicketTimeline).mockResolvedValue({
      comments: [COMMENT_C1, { ...COMMENT_C1, id: 'c-2', body: 'second' }],
      changes: [],
      attachments: [],
    });
    renderTickets();
    await openDrawer();
    expect(await screen.findByText('2 comments')).toBeInTheDocument();
  });
});

describe('UX-35 resolved SLA state in the list (issue 209)', () => {
  it('resolved tickets show "SLA closed" instead of a countdown', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({
      items: [{ ...PAGE1_TICKET, status: 'RESOLVED' }],
      total: 1,
    });
    renderTickets();
    expect(await screen.findByText('SLA closed')).toBeInTheDocument();
    expect(screen.queryByText(/OVERDUE/)).toBeNull();
  });
});

describe('UX-36 drawer close names the ticket (issue 210)', () => {
  it('the close button aria-label carries the ticket number', async () => {
    renderTickets();
    const dialog = await openDrawer();
    expect(within(dialog).getByRole('button', { name: 'Close ticket INC-1001' })).toBeInTheDocument();
  });
});

describe('UX-37 visible char counts (issue 211)', () => {
  it('the composer counts toward 4000', async () => {
    renderTickets();
    await openDrawer();

    expect(screen.getByText('0/4000')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Add a comment' }), { target: { value: 'hello' } });
    expect(screen.getByText('5/4000')).toBeInTheDocument();
  });

  it('the description editor counts toward 4000', async () => {
    renderTickets();
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Edit title, type & description' }));

    await screen.findByLabelText('Description');
    expect(screen.getByText(`${PAGE1_TICKET.description.length}/4000`)).toBeInTheDocument();
  });
});

describe('UX-38 Attach relabelled (issue 212)', () => {
  it('the button reads "Attach file"', async () => {
    renderTickets();
    await openDrawer();
    expect(await screen.findByRole('button', { name: 'Attach file' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attach' })).toBeNull();
  });
});

describe('UX-39 due-soon chip in the list (issue 213)', () => {
  it('a ticket breaching within 10 minutes shows "due soon"', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({
      items: [{ ...PAGE1_TICKET, sla_due_at: new Date(Date.now() + 5 * 60_000).toISOString() }],
      total: 1,
    });
    renderTickets();
    expect(await screen.findByText(/due soon/)).toBeInTheDocument();
  });
});
