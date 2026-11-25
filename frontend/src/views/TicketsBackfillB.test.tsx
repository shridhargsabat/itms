import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Tickets from './Tickets';
import ServiceQueue from '@/components/ServiceQueue';
import * as api from '@/api/client';
import type { Asset, Ticket, TicketAttachment, TicketComment, TicketStatus, UserRecord } from '@/api/types';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

// jsdom lacks ResizeObserver (ScrollX/DataTable mount one) and scrollIntoView (Select calls it on open).
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    listTickets: vi.fn(),
    getTicket: vi.fn(),
    patchTicketStatus: vi.fn(),
    updateTicket: vi.fn(),
    exportTicketsCsv: vi.fn(),
    getTicketTimeline: vi.fn(),
    listCanned: vi.fn(),
    listUsers: vi.fn(),
    listAssets: vi.fn(),
    listTemplates: vi.fn(),
    suggestArticles: vi.fn(),
    getSlaPolicy: vi.fn(),
    convertTicketToArticle: vi.fn(),
    createTicket: vi.fn(),
    createTicketComment: vi.fn(),
    deleteTicketComment: vi.fn(),
    deleteTicketAttachment: vi.fn(),
    downloadTicketAttachment: vi.fn(),
    uploadTicketAttachment: vi.fn(),
  };
});

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

const URGENT_TICKET: Ticket = {
  ...PAGE1_TICKET,
  id: 't-urgent',
  ticket_number: 'INC-1002',
  title: 'Production DB down',
  priority: 'URGENT',
  status: 'OPEN',
  sla_due_at: new Date(Date.now() + 2 * 3_600_000).toISOString(),
};

const QUEUE_T1: Ticket = {
  ...PAGE1_TICKET,
  id: 't1',
  ticket_number: 'TKT-1048',
  title: 'PostgreSQL pool exhaustion on ITMS API',
  description: 'Spike in concurrent CMDB impact queries saturated the pool.',
  priority: 'URGENT',
  status: 'OPEN',
  asset_tag: 'SRV-MUM-001',
  asset_name: 'DB server',
  assignee_name: 'Aarav Mehta',
  sla_due_at: new Date(Date.now() + 2 * 3_600_000).toISOString(),
};

const QUEUE_T2: Ticket = {
  ...PAGE1_TICKET,
  id: 't2',
  ticket_number: 'TKT-1047',
  title: 'Cisco uplink flapping on Floor 4 IDF',
  priority: 'HIGH',
  status: 'IN_PROGRESS',
  assignee_name: 'Rohan Kulkarni',
  sla_due_at: new Date(Date.now() + 8 * 3_600_000).toISOString(),
};

const STAFF_USER: UserRecord = {
  id: 'u-test',
  name: 'Test User',
  email: 'test@itms.local',
  role: 'ADMIN',
  department: 'IT',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
};

const LINKED_ASSET: Asset = {
  id: 'a-9',
  asset_tag: 'SRV-MUM-001',
  name: 'DB server',
  category: 'SERVER',
  serial_number: 'SN-001',
  status: 'ASSIGNED',
  assigned_to_user_id: null,
  assigned_user_name: null,
  specs: {},
  purchase_date: null,
  warranty_expiry: null,
  unit_cost: null,
  expected_eol: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const COMMENT_C1: TicketComment = {
  id: 'c-1',
  ticket_id: 't-page1',
  author_id: 'u-test',
  body: 'Investigating the flicker now.',
  mentions: [],
  created_at: '2026-11-23T10:30:00Z',
  author_name: 'Test User',
  author_role: 'ADMIN',
};

const ATTACH_A1: TicketAttachment = {
  id: 'att-1',
  ticket_id: 't-page1',
  uploader_id: 'u-test',
  file_name: 'report.pdf',
  content_type: 'application/pdf',
  size_bytes: 12345,
  storage_key: 'k1',
  created_at: '2026-11-23T10:40:00Z',
  uploader_name: 'Test User',
};

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

function renderQueue(client?: QueryClient) {
  const qc = client ?? makeQc();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <ServiceQueue />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}

beforeEach(() => {
  setUser('ADMIN');
  vi.mocked(api.listTickets).mockResolvedValue({ items: [PAGE1_TICKET], total: 1 });
  vi.mocked(api.getTicket).mockResolvedValue(PAGE1_TICKET);
  vi.mocked(api.getTicketTimeline).mockResolvedValue({ comments: [], changes: [], attachments: [] });
  vi.mocked(api.listCanned).mockResolvedValue([]);
  vi.mocked(api.listUsers).mockResolvedValue({ items: [STAFF_USER], total: 1 });
  vi.mocked(api.listAssets).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(api.listTemplates).mockResolvedValue([]);
  vi.mocked(api.suggestArticles).mockResolvedValue([]);
  vi.mocked(api.getSlaPolicy).mockResolvedValue({
    URGENT: { hours: 4, label: 'Urgent' },
    HIGH: { hours: 8, label: 'High' },
    MEDIUM: { hours: 24, label: 'Medium' },
    LOW: { hours: 72, label: 'Low' },
  });
  vi.mocked(api.patchTicketStatus).mockImplementation((id, st) =>
    Promise.resolve({ ...PAGE1_TICKET, id, status: st as TicketStatus }),
  );
});

describe('Tickets backfill B — issue 122 (TFE-18/19/22/23/24/25/27/28/30)', () => {
  it('TFE-18: corrupt localStorage user JSON does not white-screen the drawer', async () => {
    localStorage.setItem('itms_user', '{not-valid-json');
    expect(api.getCachedUser()).toBeNull();

    renderTickets('/tickets?open=t-page1');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Laptop screen flickering')).toBeInTheDocument();
    expect(within(dialog).getByText('INC-1001')).toBeInTheDocument();
  });

  it('TFE-19: after a status mutation the drawer badges and Select show the post-mutation status', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({ items: [QUEUE_T1, QUEUE_T2], total: 2 });
    renderQueue();
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    fireEvent.click(within(queue).getByText('TKT-1048'));
    const drawer = await screen.findByTestId('service-queue-drawer');

    fireEvent.click(within(drawer).getByRole('button', { name: 'Update Status' }));
    fireEvent.click(await screen.findByRole('option', { name: 'IN_PROGRESS' }));

    expect(await within(drawer).findByText('Status updated to IN_PROGRESS')).toBeInTheDocument();
    expect(vi.mocked(api.patchTicketStatus).mock.calls[0]).toEqual(['t1', 'IN_PROGRESS']);
    // Badge renders the humanised status; the Select trigger keeps the raw code.
    expect(within(drawer).getByText('IN PROGRESS')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Update Status' }).textContent).toContain('IN_PROGRESS');
  });

  it('TFE-22: overdue filter chip renders with a working clear button', async () => {
    renderTickets('/tickets?overdue=true');

    expect(await screen.findByText('Overdue only')).toBeInTheDocument();
    expect(vi.mocked(api.listTickets).mock.calls[0][0]).toMatchObject({ overdue: true });

    fireEvent.click(screen.getByRole('button', { name: 'Clear overdue filter' }));
    await waitFor(() => expect(screen.queryByText('Overdue only')).not.toBeInTheDocument());
  });

  it('TFE-23: comment delete failure shows FieldError and resets confirm state', async () => {
    vi.mocked(api.getTicketTimeline).mockResolvedValue({
      comments: [COMMENT_C1],
      changes: [],
      attachments: [],
    });
    vi.mocked(api.deleteTicketComment).mockRejectedValueOnce(new Error('comment delete failed'));
    renderTickets('/tickets?open=t-page1');
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Delete comment' }));
    expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    expect(await within(dialog).findByText('comment delete failed')).toBeInTheDocument();
    expect(vi.mocked(api.deleteTicketComment).mock.calls[0][0]).toBe('t-page1');
    expect(vi.mocked(api.deleteTicketComment).mock.calls[0][1]).toBe('c-1');
    // Confirm state reset: the delete trigger is back, the Confirm pair is gone.
    expect(within(dialog).getByRole('button', { name: 'Delete comment' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('TFE-23: attachment delete failure shows FieldError and resets confirm state', async () => {
    vi.mocked(api.getTicketTimeline).mockResolvedValue({
      comments: [],
      changes: [],
      attachments: [ATTACH_A1],
    });
    vi.mocked(api.deleteTicketAttachment).mockRejectedValueOnce(new Error('attachment delete failed'));
    vi.mocked(api.downloadTicketAttachment).mockResolvedValue(new Blob(['x']));
    renderTickets('/tickets?open=t-page1');
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Delete attachment' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    expect(await within(dialog).findByText('attachment delete failed')).toBeInTheDocument();
    expect(vi.mocked(api.deleteTicketAttachment).mock.calls[0][0]).toBe('t-page1');
    expect(vi.mocked(api.deleteTicketAttachment).mock.calls[0][1]).toBe('att-1');
    expect(within(dialog).getByRole('button', { name: 'Delete attachment' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('TFE-24: attachment download appends the anchor to the DOM before click and removes it after', async () => {
    vi.mocked(api.getTicketTimeline).mockResolvedValue({
      comments: [],
      changes: [],
      attachments: [ATTACH_A1],
    });
    vi.mocked(api.downloadTicketAttachment).mockResolvedValue(new Blob(['pdf-bytes']));
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
    renderTickets('/tickets?open=t-page1');
    const dialog = await screen.findByRole('dialog');
    const downloadBtn = await within(dialog).findByTitle('Download report.pdf');

    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(downloadBtn);

    await waitFor(() => expect(vi.mocked(api.downloadTicketAttachment).mock.calls[0][0]).toBe('att-1'));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(appendSpy).toHaveBeenCalled();
    const anchor = appendSpy.mock.calls[0][0] as HTMLAnchorElement;
    expect(anchor.tagName).toBe('A');
    expect(anchor.download).toBe('report.pdf');
    // Append happened before click; the anchor is detached again afterwards.
    expect(appendSpy.mock.invocationCallOrder[0]).toBeLessThan(clickSpy.mock.invocationCallOrder[0]);
    await waitFor(() => expect(anchor.parentNode).toBeNull());
    expect(document.body.contains(anchor)).toBe(false);
  });

  it('TFE-25: oversize file over 10MB is blocked client-side; the input carries an accept attr', async () => {
    renderTickets('/tickets?open=t-page1');
    const dialog = await screen.findByRole('dialog');
    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    expect(fileInput.getAttribute('accept')).toContain('.pdf');

    const big = new File([new ArrayBuffer(11 * 1024 * 1024)], 'big-archive.zip', { type: 'application/zip' });
    fireEvent.change(fileInput, { target: { files: [big] } });

    expect(await within(dialog).findByText('File exceeds the 10 MB limit.')).toBeInTheDocument();
    expect(vi.mocked(api.uploadTicketAttachment)).not.toHaveBeenCalled();
  });

  it('TFE-27: assignee picker shows the first-N-of-total note', async () => {
    vi.mocked(api.listUsers).mockResolvedValue({ items: [STAFF_USER], total: 250 });
    renderTickets('/tickets?open=t-page1');
    const dialog = await screen.findByRole('dialog');

    expect(await within(dialog).findByText('Showing first 200 of 250 users')).toBeInTheDocument();
  });

  it('TFE-27: linked-asset picker shows the first-N-of-total note', async () => {
    vi.mocked(api.listAssets).mockResolvedValue({ items: [LINKED_ASSET], total: 500 });
    renderTickets();
    await screen.findByText('Laptop screen flickering');

    fireEvent.click(screen.getByRole('button', { name: 'New Ticket' }));
    expect(await screen.findByText('Showing first 1 of 500 assets')).toBeInTheDocument();
  });

  it('TFE-28: SLA chips use live getSlaPolicy values', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({ items: [URGENT_TICKET], total: 1 });
    vi.mocked(api.getTicket).mockResolvedValue(URGENT_TICKET);
    vi.mocked(api.getSlaPolicy).mockResolvedValue({
      URGENT: { hours: 2, label: 'Urgent' },
      HIGH: { hours: 8, label: 'High' },
      MEDIUM: { hours: 24, label: 'Medium' },
      LOW: { hours: 72, label: 'Low' },
    });
    renderTickets('/tickets?open=t-urgent');
    const dialog = await screen.findByRole('dialog');

    expect(await within(dialog).findByText('SLA · 2h policy')).toBeInTheDocument();
  });

  it('TFE-28: SLA chips fall back to constants when the policy fetch fails', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({ items: [URGENT_TICKET], total: 1 });
    vi.mocked(api.getTicket).mockResolvedValue(URGENT_TICKET);
    vi.mocked(api.getSlaPolicy).mockRejectedValue(new Error('policy down'));
    renderTickets('/tickets?open=t-urgent');
    const dialog = await screen.findByRole('dialog');

    // URGENT fallback constant is 4h (Tickets.tsx SLA_HOURS).
    expect(await within(dialog).findByText('SLA · 4h policy')).toBeInTheDocument();
  });

  it('TFE-30: selecting a ticket then refetching without it keeps the drawer open on the snapshot with the stale notice', async () => {
    const client = makeQc();
    vi.mocked(api.listTickets).mockResolvedValue({ items: [QUEUE_T1, QUEUE_T2], total: 2 });
    renderQueue(client);
    const queue = await screen.findByTestId('service-queue');
    await within(queue).findByText('TKT-1048');
    fireEvent.click(within(queue).getByText('TKT-1048'));
    const drawer = await screen.findByTestId('service-queue-drawer');

    // T1 leaves the live queue on refetch — the drawer must survive on the snapshot.
    vi.mocked(api.listTickets).mockResolvedValue({ items: [QUEUE_T2], total: 1 });
    await client.refetchQueries({ queryKey: ['service-queue'] });

    expect(screen.getByTestId('service-queue-drawer')).toBeInTheDocument();
    expect(within(drawer).getByText('TKT-1048')).toBeInTheDocument();
    expect(within(drawer).getByText('PostgreSQL pool exhaustion on ITMS API')).toBeInTheDocument();
    expect(await within(drawer).findByText(/no longer in the queue/)).toBeInTheDocument();
    expect(within(queue).queryByText('TKT-1048')).not.toBeInTheDocument();
  });
});
