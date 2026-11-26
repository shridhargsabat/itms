import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Tickets from './Tickets';
import NewTicketForm from '@/components/NewTicketForm';
import * as api from '@/api/client';
import type { Ticket, TicketAttachment, TicketComment, TicketTimelineEntry } from '@/api/types';

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

function renderTickets(initialEntry = '/tickets') {
  render(
    <QueryClientProvider client={makeQc()}>
      <MemoryRouter initialEntries={[initialEntry]}>
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

function comment(over: Partial<TicketComment> & Pick<TicketComment, 'id'>): TicketComment {
  return {
    ticket_id: 't-page1',
    author_id: 'u-test',
    author_name: 'Test User',
    body: 'hello',
    mentions: [],
    created_at: '2026-11-23T12:00:00Z',
    ...over,
  };
}

function change(over: Partial<TicketTimelineEntry> & Pick<TicketTimelineEntry, 'action'>): TicketTimelineEntry {
  return {
    kind: 'change',
    actor: 'Test User',
    at: '2026-11-23T12:00:00Z',
    details: {},
    ...over,
  };
}

function attachment(over: Partial<TicketAttachment> & Pick<TicketAttachment, 'id'>): TicketAttachment {
  return {
    ticket_id: 't-page1',
    uploader_id: 'u-test',
    uploader_name: 'Test User',
    file_name: 'log.txt',
    content_type: 'text/plain',
    size_bytes: 42,
    storage_key: 'k-1',
    created_at: '2026-11-23T12:00:00Z',
    ...over,
  };
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
  vi.mocked(api.updateTicket).mockImplementation((id, input) =>
    Promise.resolve({ ...PAGE1_TICKET, ...input, id } as Ticket),
  );
});

async function openDrawer() {
  fireEvent.click(await screen.findByText('Laptop screen flickering'));
  return screen.findByRole('dialog', { name: 'Ticket INC-1001' });
}

describe('FE-11 pagination resets when the overdue filter changes (issue 163)', () => {
  function NavHelper() {
    const [, setParams] = useSearchParams();
    return (
      <button type="button" onClick={() => setParams({ overdue: 'true' })}>
        go-overdue
      </button>
    );
  }

  it('snaps back to offset 0 once overdue is toggled from page 2', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({ items: [PAGE1_TICKET], total: 45 });
    render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter initialEntries={['/tickets']}>
          <NavHelper />
          <Tickets />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Next page' }));
    await waitFor(() => {
      const calls = vi.mocked(api.listTickets).mock.calls;
      expect(calls[calls.length - 1][0]).toMatchObject({ offset: 20 });
    });

    fireEvent.click(screen.getByRole('button', { name: 'go-overdue' }));
    await waitFor(() => {
      const calls = vi.mocked(api.listTickets).mock.calls;
      expect(calls[calls.length - 1][0]).toMatchObject({ overdue: true, offset: 0, limit: 20 });
    });
    expect(await screen.findByText('Overdue only')).toBeInTheDocument();
  });
});

describe('FE-12 re-selecting the current priority/assignee fires no PATCH (issue 164)', () => {
  it('priority: same value is a no-op, a different value still PATCHes', async () => {
    renderTickets();
    await openDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Ticket priority' }));
    fireEvent.click(await screen.findByRole('option', { name: 'MEDIUM' }));
    expect(api.updateTicket).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Ticket priority' }));
    fireEvent.click(await screen.findByRole('option', { name: 'URGENT' }));
    await waitFor(() => expect(api.updateTicket).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updateTicket).mock.calls[0][0]).toBe('t-page1');
    expect(vi.mocked(api.updateTicket).mock.calls[0][1]).toEqual({ priority: 'URGENT' });
  });

  it('assignee: same value is a no-op, a different value still PATCHes', async () => {
    renderTickets();
    await openDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Ticket assignee' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Unassigned' }));
    expect(api.updateTicket).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Ticket assignee' }));
    fireEvent.click(await screen.findByRole('option', { name: /Aarav Gupta/ }));
    await waitFor(() => expect(api.updateTicket).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updateTicket).mock.calls[0][0]).toBe('t-page1');
    expect(vi.mocked(api.updateTicket).mock.calls[0][1]).toEqual({ assignee_id: 'u-1' });
  });
});

describe('FE-13 delete Cancel/Delete freeze while the DELETE is pending (issue 165)', () => {
  it('comment Delete + Cancel are disabled until the delete lands', async () => {
    vi.mocked(api.getTicketTimeline).mockResolvedValue({
      comments: [comment({ id: 'c-1', body: 'remove me' })],
      changes: [],
      attachments: [],
    });
    const d = deferred<void>();
    void d.promise.catch(() => undefined);
    vi.mocked(api.deleteTicketComment).mockReturnValueOnce(d.promise);
    renderTickets();
    await openDrawer();
    await screen.findByText('remove me');

    fireEvent.click(screen.getByRole('button', { name: 'Delete comment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const confirm = await screen.findByRole('button', { name: 'Delete' });
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(api.deleteTicketComment).toHaveBeenCalledTimes(1);

    d.resolve(undefined);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull());
  });

  it('attachment Delete + Cancel are disabled until the delete lands', async () => {
    vi.mocked(api.getTicketTimeline).mockResolvedValue({
      comments: [],
      changes: [],
      attachments: [attachment({ id: 'a-9', file_name: 'stale.log' })],
    });
    const d = deferred<void>();
    void d.promise.catch(() => undefined);
    vi.mocked(api.deleteTicketAttachment).mockReturnValueOnce(d.promise);
    renderTickets();
    await openDrawer();
    await screen.findByText('stale.log');

    fireEvent.click(screen.getByRole('button', { name: 'Delete attachment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const confirm = await screen.findByRole('button', { name: 'Delete' });
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    d.resolve(undefined);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull());
  });
});

describe('FE-14 the posted comment is the trimmed draft (issue 166)', () => {
  it('post.mutate receives draft.trim(), not the padded text', async () => {
    vi.mocked(api.createTicketComment).mockResolvedValue(comment({ id: 'c-new', body: 'padded comment' }));
    renderTickets();
    await openDrawer();

    fireEvent.change(screen.getByRole('textbox', { name: 'Add a comment' }), {
      target: { value: '  padded comment  \n' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    await waitFor(() => expect(api.createTicketComment).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createTicketComment).mock.calls[0][0]).toBe('t-page1');
    expect(vi.mocked(api.createTicketComment).mock.calls[0][1]).toEqual({ body: 'padded comment' });
  });
});

describe('CT-06 title cap is 255 to match the backend (issue 168)', () => {
  it('drawer title editor allows 255 chars', async () => {
    renderTickets();
    await openDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Edit title, type & description' }));
    expect(await screen.findByLabelText('Title')).toHaveAttribute('maxLength', '255');
  });

  it('NewTicketForm title input allows 255 chars', async () => {
    render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter initialEntries={['/tickets']}>
          <NewTicketForm onDone={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByPlaceholderText("What's the issue?")).toHaveAttribute('maxLength', '255');
  });
});

describe('CT-07 timeline passes an explicit limit and reports truncation (issue 169)', () => {
  it('fetches the thread with { limit: 100 }', async () => {
    renderTickets();
    await openDrawer();

    await waitFor(() => expect(api.getTicketTimeline).toHaveBeenCalled());
    expect(vi.mocked(api.getTicketTimeline).mock.calls[0][0]).toBe('t-page1');
    expect(vi.mocked(api.getTicketTimeline).mock.calls[0][1]).toEqual({ limit: 100 });
  });

  it('shows a "first 100" notice when a section hits the window', async () => {
    const comments = Array.from({ length: 100 }, (_, i) =>
      comment({ id: `c-${i}`, body: `comment ${i}`, created_at: `2026-11-23T12:${String(i % 60).padStart(2, '0')}:00Z` }),
    );
    vi.mocked(api.getTicketTimeline).mockResolvedValue({ comments, changes: [], attachments: [] });
    renderTickets();
    await openDrawer();

    expect(await screen.findByText(/Showing first 100/)).toBeInTheDocument();
  });

  it('shows no truncation notice for a small thread', async () => {
    renderTickets();
    await openDrawer();
    await screen.findByText('No activity yet.');
    expect(screen.queryByText(/Showing first 100/)).not.toBeInTheDocument();
  });
});

describe('CT-08 EDIT/ASSET/CONVERT timeline labels + from→to diffs (issue 170)', () => {
  it('renders human labels and diffs instead of raw slugs', async () => {
    vi.mocked(api.getTicketTimeline).mockResolvedValue({
      comments: [],
      changes: [
        change({
          action: 'TICKET_EDIT',
          at: '2026-11-23T12:01:00Z',
          details: {
            title: { from: 'Old title', to: 'New title' },
            ticket_type: { from: 'INCIDENT', to: 'PROBLEM' },
          },
        }),
        change({
          action: 'TICKET_ASSET',
          at: '2026-11-23T12:02:00Z',
          details: { from: null, to: 'asset-1' },
        }),
        change({ action: 'TICKET_CONVERT', at: '2026-11-23T12:03:00Z', details: {} }),
      ],
      attachments: [],
    });
    renderTickets();
    await openDrawer();

    expect(await screen.findByText(/edited the ticket/)).toBeInTheDocument();
    expect(screen.getByText(/title: Old title → New title/)).toBeInTheDocument();
    expect(screen.getByText(/type: INCIDENT → PROBLEM/)).toBeInTheDocument();
    expect(screen.getByText(/updated the linked asset/)).toBeInTheDocument();
    expect(screen.getByText(/none → asset-1/)).toBeInTheDocument();
    expect(screen.getByText(/converted to KB article/)).toBeInTheDocument();
    expect(screen.queryByText(/\bedit\b/)).not.toBeInTheDocument();
  });
});
