import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ServiceQueue from './ServiceQueue';
import { listTickets, patchTicketStatus, getSlaPolicy } from '@/api/client';
import type { Ticket, TicketStatus } from '@/api/types';

// FE-03 (#147): mirrors the drawer trap selector (Tickets TFE-32 / Modal.tsx).
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

const T1 = ticket({
  id: 't1',
  ticket_number: 'TKT-1048',
  title: 'PostgreSQL pool exhaustion on ITMS API',
  description: 'Spike in concurrent CMDB impact queries saturated the pool.',
  priority: 'URGENT',
  status: 'OPEN',
  asset_tag: 'SRV-MUM-001',
  assignee_name: 'Aarav Mehta',
  sla_due_at: new Date(Date.now() + 2 * 3_600_000).toISOString(),
});
const T2 = ticket({
  id: 't2',
  ticket_number: 'TKT-1047',
  title: 'Cisco uplink flapping on Floor 4 IDF',
  priority: 'HIGH',
  status: 'IN_PROGRESS',
  asset_tag: 'NET-MUM-004',
  assignee_name: 'Rohan Kulkarni',
  sla_due_at: new Date(Date.now() + 8 * 3_600_000).toISOString(),
});
// Closed-loop ticket: fetched but never rendered in the live queue.
const T3 = ticket({
  id: 't3',
  ticket_number: 'TKT-1040',
  title: 'Old resolved printer ticket',
  priority: 'LOW',
  status: 'RESOLVED',
});

beforeEach(() => {
  vi.mocked(listTickets).mockResolvedValue({ items: [T1, T2, T3], total: 3 });
  vi.mocked(getSlaPolicy).mockResolvedValue({});
  vi.mocked(patchTicketStatus).mockImplementation((id: string, status: string) =>
    Promise.resolve({ ...T1, id, status: status as TicketStatus }),
  );
});

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderQueue(client = queryClient()) {
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <ServiceQueue />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, ...result };
}

describe('ServiceQueue (task 9)', () => {
  it('fetches live tickets server-side and renders rows with badges (TFE-02)', async () => {
    // Server now filters to live statuses; the queue renders what it gets.
    vi.mocked(listTickets).mockResolvedValue({ items: [T1, T2], total: 2 });
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');

    expect(listTickets).toHaveBeenCalledWith({ status: 'OPEN,IN_PROGRESS', limit: 50 });
    expect(within(queue).getByText('TKT-1048')).toBeInTheDocument();
    expect(within(queue).getByText('PostgreSQL pool exhaustion on ITMS API')).toBeInTheDocument();
    expect(within(queue).getByText('TKT-1047')).toBeInTheDocument();
    // Badges per row.
    expect(within(queue).getByText('URGENT')).toBeInTheDocument();
    expect(within(queue).getByText('HIGH')).toBeInTheDocument();
  });

  it('narrows rows client-side by title, ticket number, and asset tag', async () => {
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    const filter = within(queue).getByPlaceholderText('Filter tickets...');

    fireEvent.change(filter, { target: { value: 'flapping' } });
    expect(within(queue).queryByText('TKT-1048')).not.toBeInTheDocument();
    expect(within(queue).getByText('TKT-1047')).toBeInTheDocument();

    fireEvent.change(filter, { target: { value: 'tkt-1048' } });
    expect(within(queue).getByText('TKT-1048')).toBeInTheDocument();
    expect(within(queue).queryByText('TKT-1047')).not.toBeInTheDocument();

    fireEvent.change(filter, { target: { value: 'net-mum' } });
    expect(within(queue).queryByText('TKT-1048')).not.toBeInTheDocument();
    expect(within(queue).getByText('TKT-1047')).toBeInTheDocument();
  });

  it('opens the inspect slide-over on row click and closes via Escape/backdrop', async () => {
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    fireEvent.click(within(queue).getByText('TKT-1048'));

    const drawer = await screen.findByTestId('service-queue-drawer');
    expect(within(drawer).getByText('TKT-1048')).toBeInTheDocument();
    expect(
      within(drawer).getByText('Spike in concurrent CMDB impact queries saturated the pool.'),
    ).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: /open in service desk/i })).toHaveAttribute(
      'href',
      '/tickets?open=t1',
    );
    // Portaled above header/nav stacking contexts.
    expect(drawer.parentElement).toBe(document.body);
    expect(drawer).toHaveClass('z-[60]');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('service-queue-drawer')).not.toBeInTheDocument();

    // Reopen, then close via the scrim.
    fireEvent.click(within(queue).getByText('TKT-1048'));
    await screen.findByTestId('service-queue-drawer');
    fireEvent.click(screen.getByTestId('service-queue-scrim'));
    expect(screen.queryByTestId('service-queue-drawer')).not.toBeInTheDocument();
  });

  it('status change calls patchTicketStatus and shows an inline confirm', async () => {
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    fireEvent.click(within(queue).getByText('TKT-1048'));
    const drawer = await screen.findByTestId('service-queue-drawer');

    // App-native Select: open the trigger, then pick the portaled option.
    // T1 is OPEN → only IN_PROGRESS and CLOSED are legal transitions.
    fireEvent.click(within(drawer).getByRole('button', { name: 'Update Status' }));
    expect(screen.queryByRole('option', { name: 'RESOLVED' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('option', { name: 'IN PROGRESS' }));

    expect(await within(drawer).findByText('Status updated to IN_PROGRESS')).toBeInTheDocument();
    expect(patchTicketStatus).toHaveBeenCalledWith('t1', 'IN_PROGRESS');
  });

  it('is visible to non-admin users (no admin gate)', async () => {
    localStorage.setItem(
      'itms_user',
      JSON.stringify({ id: 'u9', email: 'e@x.com', name: 'E', role: 'EMPLOYEE', department: 'IT' }),
    );
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    expect(within(queue).getByText('TKT-1048')).toBeInTheDocument();
    expect(within(queue).getByText('TKT-1047')).toBeInTheDocument();
  });

  it('shows an empty state when no open tickets match', async () => {
    vi.mocked(listTickets).mockResolvedValue({ items: [], total: 0 });
    renderQueue();
    expect(await screen.findByText('Queue is clear')).toBeInTheDocument();
  });

  it('stale banner uses light-readable text with dark-mode fallback (#118)', async () => {
    const client = queryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/']}>
          <ServiceQueue />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    fireEvent.click(within(queue).getByText('TKT-1048'));
    const drawer = await screen.findByTestId('service-queue-drawer');

    // T1 leaves the live queue (resolved elsewhere) → snapshot banner appears.
    vi.mocked(listTickets).mockResolvedValue({ items: [T2], total: 1 });
    await client.refetchQueries({ queryKey: ['service-queue'] });
    const stale = await within(drawer).findByText(/no longer in the queue/);
    expect(stale.className).toContain('text-amber-700');
    expect(stale.className).toContain('dark:text-amber-400');
  });

  it('load error uses light-readable text with dark-mode fallback (#118)', async () => {
    vi.mocked(listTickets).mockRejectedValue(new Error('boom'));
    renderQueue();
    const err = await screen.findByText('Failed to load the service queue.');
    expect(err.className).toContain('text-red-700');
    expect(err.className).toContain('dark:text-red-400');
  });

  it('status confirm uses light-readable text with dark-mode fallback (#118)', async () => {
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    fireEvent.click(within(queue).getByText('TKT-1048'));
    const drawer = await screen.findByTestId('service-queue-drawer');

    fireEvent.click(within(drawer).getByRole('button', { name: 'Update Status' }));
    fireEvent.click(await screen.findByRole('option', { name: 'IN PROGRESS' }));

    const ok = await within(drawer).findByText('Status updated to IN_PROGRESS');
    expect(ok.className).toContain('text-emerald-700');
    expect(ok.className).toContain('dark:text-emerald-400');
  });

  it('status update error uses light-readable text with dark-mode fallback (#118)', async () => {
    vi.mocked(patchTicketStatus).mockRejectedValue(new Error('update failed'));
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    fireEvent.click(within(queue).getByText('TKT-1048'));
    const drawer = await screen.findByTestId('service-queue-drawer');

    fireEvent.click(within(drawer).getByRole('button', { name: 'Update Status' }));
    fireEvent.click(await screen.findByRole('option', { name: 'IN PROGRESS' }));

    const err = await within(drawer).findByText('update failed');
    expect(err.className).toContain('text-red-700');
    expect(err.className).toContain('dark:text-red-400');
  });
});

describe('ServiceQueue FE-03 inspect drawer focus management (#147)', () => {
  it('drawer is modal with initial focus, traps Tab, and returns focus to the invoking row', async () => {
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    const row = within(queue).getByText('TKT-1048').closest('button')!;
    row.focus();
    fireEvent.click(row);

    const drawer = await screen.findByTestId('service-queue-drawer');
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(drawer.contains(document.activeElement)).toBe(true);

    const items = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    expect(items.length).toBeGreaterThan(1);
    const first = items[0];
    const last = items[items.length - 1];

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('service-queue-drawer')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(row);
  });

  it('focus trap yields while the status listbox is open, then resumes', async () => {
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    fireEvent.click(within(queue).getByText('TKT-1048'));
    const drawer = await screen.findByTestId('service-queue-drawer');

    fireEvent.click(within(drawer).getByRole('button', { name: 'Update Status' }));
    await screen.findByRole('listbox');

    const items = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = items[0];
    const last = items[items.length - 1];

    // Trap stands down: Tab on last does NOT wrap to first.
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(last);

    // Escape is owned by the Select: menu closes, drawer stays, trap resumes.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('service-queue-drawer')).toBeInTheDocument();
    // Re-focus: Select open/close shifts activeElement in jsdom — pin it so
    // the wrap assertion below is deterministic.
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });
});

describe('ServiceQueue FE-06 status outcome scoping (#150)', () => {
  it('status confirm does not bleed onto another ticket mid-flight', async () => {
    const { client } = renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');

    // Hold T1's mutation mid-flight.
    const gate = deferred<Ticket>();
    vi.mocked(patchTicketStatus).mockReturnValueOnce(gate.promise);

    fireEvent.click(within(queue).getByText('TKT-1048'));
    const drawer1 = await screen.findByTestId('service-queue-drawer');
    fireEvent.click(within(drawer1).getByRole('button', { name: 'Update Status' }));
    fireEvent.click(await screen.findByRole('option', { name: 'IN PROGRESS' }));
    // Mutation execution is async — wait for the call rather than asserting sync.
    await waitFor(() => expect(patchTicketStatus).toHaveBeenCalledWith('t1', 'IN_PROGRESS'));

    // Switch to T2 mid-flight.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('service-queue-drawer')).not.toBeInTheDocument();
    fireEvent.click(within(queue).getByText('TKT-1047'));
    const drawer2 = await screen.findByTestId('service-queue-drawer');
    expect(within(drawer2).getByText('TKT-1047')).toBeInTheDocument();

    // T1's mutation resolves after the switch → no confirm on T2.
    gate.resolve({ ...T1, status: 'IN_PROGRESS' });
    await waitFor(() =>
      expect(client.getMutationCache().getAll().some((m) => m.state.status === 'success')).toBe(true),
    );
    expect(within(drawer2).queryByText(/Status updated to/)).not.toBeInTheDocument();
  });

  it('status error does not bleed onto another ticket mid-flight', async () => {
    const { client } = renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');

    const gate = deferred<Ticket>();
    vi.mocked(patchTicketStatus).mockReturnValueOnce(gate.promise);

    fireEvent.click(within(queue).getByText('TKT-1048'));
    const drawer1 = await screen.findByTestId('service-queue-drawer');
    fireEvent.click(within(drawer1).getByRole('button', { name: 'Update Status' }));
    fireEvent.click(await screen.findByRole('option', { name: 'IN PROGRESS' }));
    // Ensure the mutation is genuinely in-flight before switching tickets.
    await waitFor(() => expect(patchTicketStatus).toHaveBeenCalledWith('t1', 'IN_PROGRESS'));

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(within(queue).getByText('TKT-1047'));
    const drawer2 = await screen.findByTestId('service-queue-drawer');

    gate.reject(new Error('mid-flight boom'));
    await waitFor(() =>
      expect(client.getMutationCache().getAll().some((m) => m.state.status === 'error')).toBe(true),
    );
    expect(within(drawer2).queryByText('mid-flight boom')).not.toBeInTheDocument();
  });

  it('status error is cleared when the drawer closes', async () => {
    vi.mocked(patchTicketStatus).mockRejectedValueOnce(new Error('close clears me'));
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    fireEvent.click(within(queue).getByText('TKT-1048'));
    const drawer = await screen.findByTestId('service-queue-drawer');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Update Status' }));
    fireEvent.click(await screen.findByRole('option', { name: 'IN PROGRESS' }));
    expect(await within(drawer).findByText('close clears me')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('service-queue-drawer')).not.toBeInTheDocument();

    fireEvent.click(within(queue).getByText('TKT-1048'));
    const reopened = await screen.findByTestId('service-queue-drawer');
    expect(within(reopened).queryByText('close clears me')).not.toBeInTheDocument();
  });
});

describe('ServiceQueue CT-01 staff-only status mutation (#155)', () => {
  it('EMPLOYEE sees a read-only status badge, no status mutation', async () => {
    localStorage.setItem(
      'itms_user',
      JSON.stringify({ id: 'u9', email: 'e@x.com', name: 'E', role: 'EMPLOYEE', department: 'IT' }),
    );
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    fireEvent.click(within(queue).getByText('TKT-1048'));
    const drawer = await screen.findByTestId('service-queue-drawer');
    expect(within(drawer).queryByRole('button', { name: 'Update Status' })).not.toBeInTheDocument();
    expect(within(drawer).queryByText('Update Status')).not.toBeInTheDocument();
    // Read-only StatusBadge still shows the ticket status.
    expect(within(drawer).getByText('OPEN')).toBeInTheDocument();
  });

  it('staff roles keep the Update Status mutation', async () => {
    localStorage.setItem(
      'itms_user',
      JSON.stringify({ id: 'u1', email: 'a@x.com', name: 'A', role: 'ADMIN', department: 'IT' }),
    );
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    fireEvent.click(within(queue).getByText('TKT-1048'));
    const drawer = await screen.findByTestId('service-queue-drawer');
    expect(within(drawer).getByRole('button', { name: 'Update Status' })).toBeInTheDocument();
  });
});

describe('ServiceQueue UX minors (issues 187-189/217/218)', () => {
  it('UX-13b (#187): row sub-line renders at the 12px floor', async () => {
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    const sub = await within(queue).findByText(/CI: SRV-MUM-001/);
    expect(sub.className).toContain('text-xs');
    expect(sub.className).not.toContain('text-[11px]');
  });

  it('UX-15b (#189): truncated row titles carry the full title as a tooltip', async () => {
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    const title = await within(queue).findByText('PostgreSQL pool exhaustion on ITMS API');
    expect(title).toHaveAttribute('title', 'PostgreSQL pool exhaustion on ITMS API');
  });

  it('UX-43 (#217): status menu labels are prettified like StatusBadge', async () => {
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    fireEvent.click(within(queue).getByText('TKT-1048'));
    const drawer = await screen.findByTestId('service-queue-drawer');

    fireEvent.click(within(drawer).getByRole('button', { name: 'Update Status' }));
    expect(await screen.findByRole('option', { name: 'IN PROGRESS' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'IN_PROGRESS' })).not.toBeInTheDocument();
    // The submitted value stays the raw enum.
    fireEvent.click(screen.getByRole('option', { name: 'IN PROGRESS' }));
    await waitFor(() => expect(patchTicketStatus).toHaveBeenCalledWith('t1', 'IN_PROGRESS'));
  });

  it('UX-44 (#218): the queue filter has a visible label', async () => {
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    const input = await within(queue).findByPlaceholderText('Filter tickets...');
    const label = within(queue).getByText('Filter');
    expect(label.tagName).toBe('LABEL');
    expect(label).toHaveAttribute('for', 'service-queue-filter');
    expect(label.className).not.toContain('sr-only');
    expect(input).toHaveAttribute('id', 'service-queue-filter');
    expect(within(queue).getByLabelText('Filter')).toBe(input);
  });

  it('UX-14b (#188): drawer close is a 44px target with a 16px icon', async () => {
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    fireEvent.click(within(queue).getByText('TKT-1048'));
    const drawer = await screen.findByTestId('service-queue-drawer');

    const close = within(drawer).getByRole('button', { name: 'Close ticket details' });
    expect(close.className).toContain('min-h-[44px]');
    expect(close.className).toContain('min-w-[44px]');
    const iconClass = close.querySelector('svg')?.getAttribute('class') ?? '';
    expect(iconClass).toContain('h-4');
    expect(iconClass).toContain('w-4');
  });
});
