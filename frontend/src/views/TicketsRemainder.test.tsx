import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    updateTicket: vi.fn(),
    getTicketTimeline: vi.fn(),
    listCanned: vi.fn(),
    listUsers: vi.fn(),
    getSlaPolicy: vi.fn(),
  };
});

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u-admin', email: 'admin@itms.local', name: 'IT Admin', role: 'ADMIN', department: 'IT' }),
  );
  vi.mocked(api.listTickets).mockResolvedValue({ items: [PAGE1_TICKET], total: 1 });
  vi.mocked(api.getTicket).mockResolvedValue(PAGE1_TICKET);
  vi.mocked(api.getTicketTimeline).mockResolvedValue({ comments: [], changes: [], attachments: [] });
  vi.mocked(api.listCanned).mockResolvedValue([]);
  vi.mocked(api.listUsers).mockResolvedValue({
    items: [{ id: 'u-1', name: 'Aarav Gupta', email: 'aarav@itms.local', role: 'AGENT', department: 'Engineering', active: true, created_at: '2026-01-01T00:00:00Z' }],
    total: 1,
  });
  vi.mocked(api.getSlaPolicy).mockResolvedValue({
    URGENT: { hours: 4, label: 'Urgent' },
    HIGH: { hours: 8, label: 'High' },
    MEDIUM: { hours: 24, label: 'Medium' },
    LOW: { hours: 72, label: 'Low' },
  });
});

async function openDrawer() {
  fireEvent.click(await screen.findByText('Laptop screen flickering'));
  return screen.findByRole('dialog');
}

describe('TFE-21 CannedPicker portal (issue 83)', () => {
  const CANNED = [
    { id: 'c1', title: 'Greeting', body: 'Hello, thanks for reaching out', created_by: null, created_at: '2026-11-20T00:00:00Z' },
    { id: 'c2', title: 'Follow-up', body: 'Checking in on this ticket', created_by: null, created_at: '2026-11-20T00:00:00Z' },
  ];

  it('portals the menu to document.body with fixed positioning and the 100dvw width clamp; picking inserts the body', async () => {
    vi.mocked(api.listCanned).mockResolvedValue(CANNED);
    renderTickets();
    const dialog = await openDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Canned response' }));

    const menu = await screen.findByRole('listbox', { name: 'Canned responses' });
    expect(menu.parentElement).toBe(document.body);
    expect(dialog.contains(menu)).toBe(false);
    expect((menu as HTMLElement).style.position).toBe('fixed');
    expect(menu.className).toContain('max-w-[calc(100dvw-2.5rem)]');

    fireEvent.click(screen.getByRole('option', { name: /Greeting/ }));
    expect(screen.getByRole('textbox', { name: 'Add a comment' })).toHaveValue('Hello, thanks for reaching out');
    expect(screen.queryByRole('listbox', { name: 'Canned responses' })).toBeNull();
  });

  it('dismisses on outside-mousedown and Escape without closing the drawer', async () => {
    vi.mocked(api.listCanned).mockResolvedValue(CANNED);
    renderTickets();
    await openDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Canned response' }));
    expect(await screen.findByRole('listbox', { name: 'Canned responses' })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox', { name: 'Canned responses' })).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Canned response' }));
    const menu = await screen.findByRole('listbox', { name: 'Canned responses' });
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Canned responses' })).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('clamps left so the fixed menu never overflows a narrow viewport', async () => {
    vi.mocked(api.listCanned).mockResolvedValue(CANNED);
    const rect = {
      left: 900, top: 200, right: 1060, bottom: 240, width: 160, height: 40, x: 900, y: 200,
      toJSON: () => {},
    } as DOMRect;
    const gbr = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    try {
      renderTickets();
      await openDrawer();
      fireEvent.click(await screen.findByRole('button', { name: 'Canned response' }));
      const menu = (await screen.findByRole('listbox', { name: 'Canned responses' })) as HTMLElement;
      const left = parseFloat(menu.style.left);
      expect(left + 320).toBeLessThanOrEqual(window.innerWidth - 8);
      expect(left).toBeLessThan(900);
    } finally {
      gbr.mockRestore();
    }
  });
});

describe('TFE-26 optimistic priority/assignee (issue 88)', () => {
  it('priority applies immediately, rolls back and surfaces a FieldError on failure', async () => {
    const d = deferred<Ticket>();
    void d.promise.catch(() => undefined);
    vi.mocked(api.updateTicket).mockReturnValueOnce(d.promise);
    renderTickets();
    await openDrawer();

    const trigger = screen.getByRole('button', { name: 'Ticket priority' });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: 'URGENT' }));

    await waitFor(() => expect(trigger.textContent).toContain('URGENT'));
    expect(api.updateTicket).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.updateTicket).mock.calls[0][0]).toBe('t-page1');
    expect(vi.mocked(api.updateTicket).mock.calls[0][1]).toEqual({ priority: 'URGENT' });

    d.reject(new Error('priority update failed'));
    await waitFor(() => expect(trigger.textContent).toContain('MEDIUM'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/priority update failed/);
  });

  it('assignee applies immediately and rolls back on failure', async () => {
    const d = deferred<Ticket>();
    void d.promise.catch(() => undefined);
    vi.mocked(api.updateTicket).mockReturnValueOnce(d.promise);
    renderTickets();
    await openDrawer();

    const trigger = screen.getByRole('button', { name: 'Ticket assignee' });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: /Aarav Gupta/ }));

    await waitFor(() => expect(trigger.textContent).toContain('Aarav Gupta'));
    expect(vi.mocked(api.updateTicket).mock.calls[0][0]).toBe('t-page1');
    expect(vi.mocked(api.updateTicket).mock.calls[0][1]).toEqual({ assignee_id: 'u-1' });

    d.reject(new Error('assignee update failed'));
    await waitFor(() => expect(trigger.textContent).toContain('Unassigned'));
    expect(await screen.findByText(/assignee update failed/)).toBeInTheDocument();
  });
});

describe('TFE-32 drawer focus trap (issue 110)', () => {
  it('traps Tab inside the drawer, closes on Escape, and returns focus to the opener', async () => {
    renderTickets();
    const opener = screen.getByRole('button', { name: /new ticket/i });
    opener.focus();

    const dialog = await openDrawer();
    expect(dialog.contains(document.activeElement)).toBe(true);

    const overlay = dialog.parentElement!;
    const items = Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    expect(items.length).toBeGreaterThan(1);
    const first = items[0];
    const last = items[items.length - 1];

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});

describe('TFE-33 Select aria-label wiring (issue 110)', () => {
  it('filter selects expose accessible names', async () => {
    renderTickets();
    await screen.findByText('Laptop screen flickering');
    expect(screen.getByRole('button', { name: 'Filter tickets by status' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter tickets by priority' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter tickets by type' })).toBeInTheDocument();
  });
});

describe('TFE-34/35/36/38/39 P3 sweep (issue 110)', () => {
  it('TFE-34: comment composer textarea has an accessible label', async () => {
    renderTickets();
    await openDrawer();
    expect(screen.getByRole('textbox', { name: 'Add a comment' })).toBeInTheDocument();
  });

  it('TFE-35: delete controls are 44px targets', async () => {
    vi.mocked(api.getTicketTimeline).mockResolvedValue({
      comments: [
        { id: 'c1', ticket_id: 't-page1', author_id: 'u-admin', body: 'needs deletion', mentions: [], created_at: '2026-11-23T10:00:00Z', author_name: 'IT Admin' },
      ],
      changes: [],
      attachments: [
        { id: 'a1', ticket_id: 't-page1', uploader_id: 'u-admin', file_name: 'log.txt', content_type: 'text/plain', size_bytes: 100, storage_key: 'k', created_at: '2026-11-23T10:00:00Z' },
      ],
    });
    renderTickets();
    await openDrawer();

    const delComment = await screen.findByRole('button', { name: 'Delete comment' });
    const delAtt = await screen.findByRole('button', { name: 'Delete attachment' });
    // UX-14a (#188): min-h/min-w 44px targets (were h-6/w-6).
    expect(delComment.className).toContain('min-h-[44px]');
    expect(delComment.className).toContain('min-w-[44px]');
    expect(delAtt.className).toContain('min-h-[44px]');
    expect(delAtt.className).toContain('min-w-[44px]');

    fireEvent.click(delComment);
    // UX-27 (#201): the shared snippet reads Cancel/Delete.
    expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('min-h-[44px]');
  });

  it('TFE-36: header shows Loading tickets while the list is fetching', () => {
    vi.mocked(api.listTickets).mockReturnValueOnce(new Promise<never>(() => {}));
    renderTickets();
    expect(screen.getByText(/loading tickets/i).closest('header')).not.toBeNull();
  });

  it('TFE-38: No active SLA copy when the ticket has no sla_due_at', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({ items: [{ ...PAGE1_TICKET, sla_due_at: null }], total: 1 });
    renderTickets();
    await openDrawer();
    expect(screen.getByText('No active SLA')).toBeInTheDocument();
  });

  it('TFE-39: kanban cards have a focus ring and the drawer scrim is aria-hidden', async () => {
    renderTickets();
    await screen.findByText('Laptop screen flickering');
    fireEvent.click(screen.getByRole('button', { name: /kanban/i }));

    const card = (await screen.findByText('Laptop screen flickering')).closest('button')!;
    expect(card.className).toContain('focus-visible:ring-2');

    fireEvent.click(card);
    const dialog = await screen.findByRole('dialog');
    const scrim = dialog.parentElement!.firstElementChild!;
    expect(scrim.getAttribute('aria-hidden')).toBe('true');
  });
});
