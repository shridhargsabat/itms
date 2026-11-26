import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Tickets from './Tickets';
import * as api from '@/api/client';
import type { Ticket, TicketComment, TicketTimeline } from '@/api/types';

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

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

async function openDrawer() {
  fireEvent.click(await screen.findByText('Laptop screen flickering'));
  return screen.findByRole('dialog', { name: 'Ticket INC-1001' });
}

describe('FE-01 Convert confirm renders above the drawer (issue 145)', () => {
  it('convert Modal is z-80 over the z-70 drawer; default Modals stay z-60', async () => {
    renderTickets();
    await openDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Convert to KB article' }));
    const modal = await screen.findByRole('dialog', { name: 'Convert to KB article' });
    expect((modal.closest('[data-modal]') as HTMLElement)?.style.zIndex).toBe('80');

    const drawer = screen.getByRole('dialog', { name: 'Ticket INC-1001' });
    expect(drawer.parentElement?.className ?? '').toMatch(/z-\[70\]/);

    // Default prop: the New Ticket modal keeps the classic z-60.
    fireEvent.keyDown(modal, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Convert to KB article' })).toBeNull());
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Ticket INC-1001' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'New Ticket' }));
    const create = await screen.findByRole('dialog', { name: 'New Ticket' });
    expect((create.closest('[data-modal]') as HTMLElement)?.style.zIndex).toBe('60');
  });
});

describe('FE-02 nested drawer+modal keyboard routing (issue 146)', () => {
  it('Tab stays inside the topmost modal; Escape closes only the modal, then the drawer', async () => {
    renderTickets();
    await openDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Convert to KB article' }));
    const modal = await screen.findByRole('dialog', { name: 'Convert to KB article' });
    const layer = modal.closest('[data-modal]') as HTMLElement;
    const items = Array.from(layer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    expect(items.length).toBeGreaterThan(1);
    const first = items[0];
    const last = items[items.length - 1];

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    expect(layer.contains(document.activeElement)).toBe(true);

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(modal, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Convert to KB article' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Ticket INC-1001' })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Ticket INC-1001' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('FE-04 TicketThread loading + failure states (issue 148)', () => {
  it('shows a skeleton while loading, then an error block with Retry (refetch) on failure', async () => {
    const gate = deferred<TicketTimeline>();
    void gate.promise.catch(() => undefined);
    vi.mocked(api.getTicketTimeline).mockReturnValueOnce(gate.promise);
    renderTickets();
    await screen.findByText('Laptop screen flickering');
    fireEvent.click(screen.getByText('Laptop screen flickering'));

    expect(await screen.findByTestId('thread-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Ticket INC-1001' })).toBeInTheDocument();
    expect(screen.queryByText(/No activity yet/)).toBeNull();

    gate.reject(new Error('thread boom'));
    expect(await screen.findByText(/couldn't load activity/i)).toBeInTheDocument();
    expect(screen.getByText(/thread boom/)).toBeInTheDocument();
    expect(screen.queryByText(/No activity yet/)).toBeNull();

    vi.mocked(api.getTicketTimeline).mockResolvedValueOnce({ comments: [], changes: [], attachments: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/No activity yet/)).toBeInTheDocument();
    expect(vi.mocked(api.getTicketTimeline).mock.calls[0][0]).toBe('t-page1');
  });
});

describe('FE-05 inputs freeze while their save is pending (issue 149)', () => {
  it('composer textarea disables while the comment post is pending', async () => {
    const gate = deferred<TicketComment>();
    void gate.promise.catch(() => undefined);
    vi.mocked(api.createTicketComment).mockReturnValueOnce(gate.promise);
    renderTickets();
    await openDrawer();

    const composer = screen.getByRole('textbox', { name: 'Add a comment' });
    fireEvent.change(composer, { target: { value: 'investigating' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
    await waitFor(() => expect(composer).toBeDisabled());

    const posted: TicketComment = {
      id: 'c1', ticket_id: 't-page1', author_id: 'u-test',
      body: 'investigating', mentions: [], created_at: '2026-11-24T10:00:00Z',
    };
    await act(async () => {
      gate.resolve(posted);
      await gate.promise;
    });
    await waitFor(() => expect(composer).toBeEnabled());
    expect(composer).toHaveValue('');
    expect(vi.mocked(api.createTicketComment).mock.calls[0][0]).toBe('t-page1');
  });

  it('details editor inputs disable while the save is pending', async () => {
    const gate = deferred<Ticket>();
    void gate.promise.catch(() => undefined);
    vi.mocked(api.updateTicket).mockReturnValueOnce(gate.promise);
    renderTickets();
    await openDrawer();

    fireEvent.click(await screen.findByRole('button', { name: /edit title/i }));
    const title = screen.getByLabelText('Title');
    const desc = screen.getByLabelText('Description');
    fireEvent.change(title, { target: { value: 'Edited title' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(title).toBeDisabled());
    expect(desc).toBeDisabled();

    await act(async () => {
      gate.resolve({ ...PAGE1_TICKET, title: 'Edited title' });
      await gate.promise;
    });
    await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull());
  });
});

describe('FE-07 deep-link loading state + fast failure (issue 151)', () => {
  it('pending ?open= shows a drawer skeleton; failure is immediate (retry:false, single call)', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({ items: [], total: 0 });
    const gate = deferred<Ticket>();
    void gate.promise.catch(() => undefined);
    vi.mocked(api.getTicket).mockReturnValueOnce(gate.promise);
    renderTickets('/tickets?open=t-deep');

    const skeleton = await screen.findByTestId('ticket-drawer-skeleton');
    expect(skeleton).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status', { name: 'Loading ticket' })).toBeInTheDocument();

    gate.reject(new Error('gone'));
    expect(await screen.findByText(/ticket not found/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(vi.mocked(api.getTicket)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.getTicket).mock.calls[0][0]).toBe('t-deep');
  });

  it('pending skeleton resolves into the deep-linked drawer on success', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({ items: [], total: 0 });
    const gate = deferred<Ticket>();
    vi.mocked(api.getTicket).mockReturnValueOnce(gate.promise);
    renderTickets('/tickets?open=t-deep');

    expect(await screen.findByTestId('ticket-drawer-skeleton')).toBeInTheDocument();
    await act(async () => {
      gate.resolve({ ...PAGE1_TICKET, id: 't-deep' });
      await gate.promise;
    });
    expect(await screen.findByRole('dialog', { name: 'Ticket INC-1001' })).toBeInTheDocument();
    expect(screen.queryByTestId('ticket-drawer-skeleton')).toBeNull();
  });
});

describe('FE-09 convert failure lives inside the confirm modal (issue 153)', () => {
  it('error renders in the modal above the buttons and clears on close', async () => {
    vi.mocked(api.convertTicketToArticle).mockRejectedValueOnce(new Error('kb boom'));
    renderTickets();
    await openDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Convert to KB article' }));
    const modal = await screen.findByRole('dialog', { name: 'Convert to KB article' });
    fireEvent.click(within(modal).getByRole('button', { name: 'Convert' }));

    const alert = await within(modal).findByText('kb boom');
    expect(alert).toHaveAttribute('id', 'ticket-convert-error');
    expect(alert).toHaveAttribute('role', 'alert');
    const convertBtn = within(modal).getByRole('button', { name: 'Convert' });
    expect(alert.compareDocumentPosition(convertBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(within(modal).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Convert to KB article' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Convert to KB article' }));
    const reopened = await screen.findByRole('dialog', { name: 'Convert to KB article' });
    expect(within(reopened).queryByText('kb boom')).toBeNull();
  });
});

describe('FE-10 current assignee pinned past the first 200 (issue 154)', () => {
  it('trigger shows the assignee name even when they are not in the picker page', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({
      items: [{ ...PAGE1_TICKET, assignee_id: 'u-999', assignee_name: 'Zed Beyond' }],
      total: 1,
    });
    renderTickets();
    await openDrawer();

    const trigger = screen.getByRole('button', { name: 'Ticket assignee' });
    expect(trigger).toHaveTextContent('Zed Beyond');
  });
});

describe('CT-02 Export is staff-only (issue 156)', () => {
  it('EMPLOYEE never sees Export; staff does', async () => {
    setUser('EMPLOYEE');
    renderTickets();
    await screen.findByText('Laptop screen flickering');
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    expect(screen.getByRole('button', { name: 'New Ticket' })).toBeInTheDocument();
  });

  it('ADMIN sees Export', async () => {
    renderTickets();
    await screen.findByText('Laptop screen flickering');
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });
});

describe('CT-03 drawer assignee picker is active ADMIN/AGENT only (issue 157)', () => {
  it('filters out EMPLOYEE and inactive users', async () => {
    vi.mocked(api.listUsers).mockResolvedValue({
      items: [
        { id: 'u-admin', name: 'Ada Admin', email: 'ada@itms.local', role: 'ADMIN', department: 'IT', active: true, created_at: '2026-01-01T00:00:00Z' },
        { id: 'u-agent', name: 'Gus Agent', email: 'gus@itms.local', role: 'AGENT', department: 'IT', active: true, created_at: '2026-01-01T00:00:00Z' },
        { id: 'u-emp', name: 'Eve Employee', email: 'eve@itms.local', role: 'EMPLOYEE', department: 'IT', active: true, created_at: '2026-01-01T00:00:00Z' },
        { id: 'u-gone', name: 'Gone Agent', email: 'gone@itms.local', role: 'AGENT', department: 'IT', active: false, created_at: '2026-01-01T00:00:00Z' },
      ],
      total: 4,
    });
    renderTickets();
    await openDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Ticket assignee' }));
    expect(await screen.findByRole('option', { name: /Ada Admin/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Gus Agent/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Eve Employee/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Gone Agent/ })).toBeNull();
  });
});

describe('FE-08 CannedPicker keyboard (issue 152)', () => {
  const CANNED = [
    { id: 'c1', title: 'Greeting', body: 'Hello, thanks for reaching out', created_by: null, created_at: '2026-11-20T00:00:00Z' },
    { id: 'c2', title: 'Follow-up', body: 'Checking in on this ticket', created_by: null, created_at: '2026-11-20T00:00:00Z' },
    { id: 'c3', title: 'Closing', body: 'Glad we could help', created_by: null, created_at: '2026-11-20T00:00:00Z' },
  ];

  beforeEach(() => {
    vi.mocked(api.listCanned).mockResolvedValue(CANNED);
  });

  it('arrows/Home/End move the active option via aria-activedescendant', async () => {
    renderTickets();
    await openDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Canned response' }));
    const menu = await screen.findByRole('listbox', { name: 'Canned responses' });

    expect(menu).toHaveAttribute('aria-activedescendant', 'canned-opt-c1');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(menu).toHaveAttribute('aria-activedescendant', 'canned-opt-c2');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(menu).toHaveAttribute('aria-activedescendant', 'canned-opt-c3');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(menu).toHaveAttribute('aria-activedescendant', 'canned-opt-c1');
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(menu).toHaveAttribute('aria-activedescendant', 'canned-opt-c3');
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(menu).toHaveAttribute('aria-activedescendant', 'canned-opt-c1');
    fireEvent.keyDown(menu, { key: 'End' });
    expect(menu).toHaveAttribute('aria-activedescendant', 'canned-opt-c3');
    expect(screen.getByRole('option', { name: /Closing/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('Enter/Space pick the active option into the composer', async () => {
    renderTickets();
    await openDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Canned response' }));
    const menu = await screen.findByRole('listbox', { name: 'Canned responses' });

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(screen.queryByRole('listbox', { name: 'Canned responses' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Add a comment' })).toHaveValue('Checking in on this ticket');

    fireEvent.click(screen.getByRole('button', { name: 'Canned response' }));
    const menu2 = await screen.findByRole('listbox', { name: 'Canned responses' });
    fireEvent.keyDown(menu2, { key: 'End' });
    fireEvent.keyDown(menu2, { key: ' ' });
    expect(screen.getByRole('textbox', { name: 'Add a comment' })).toHaveValue(
      'Checking in on this ticket\n\nGlad we could help',
    );
  });

  it('Escape closes the menu and returns focus to the trigger; drawer stays open', async () => {
    renderTickets();
    await openDrawer();
    const trigger = await screen.findByRole('button', { name: 'Canned response' });
    fireEvent.click(trigger);
    const menu = await screen.findByRole('listbox', { name: 'Canned responses' });
    expect(document.activeElement).toBe(menu);

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Canned responses' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('dialog', { name: 'Ticket INC-1001' })).toBeInTheDocument();
  });
});
