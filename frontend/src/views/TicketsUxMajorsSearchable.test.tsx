import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const TICKET: Ticket = {
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
  sla_due_at: null,
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
  };
});

// Capture every Select's props: the real Select gains `searchable` from the
// sibling, so assert the assignee picker passes it (contract UX-04, #178).
const seen: Record<string, unknown>[] = [];
vi.mock('@/components/Select', () => ({
  default: (props: Record<string, unknown>) => {
    seen.push(props);
    const label = (props['ariaLabel'] as string | undefined) ?? (props['aria-label'] as string | undefined) ?? 'select';
    const options = (props['options'] as { value: string; label: string }[]) ?? [];
    const value = props['value'] as string;
    const current = options.find((o) => o.value === value);
    return (
      <button type="button" aria-label={label}>
        {current?.label ?? 'Select…'}
      </button>
    );
  },
}));

beforeEach(() => {
  seen.length = 0;
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u-test', email: 'test@itms.local', name: 'Test User', role: 'ADMIN', department: 'IT' }),
  );
  vi.mocked(api.listTickets).mockResolvedValue({ items: [TICKET], total: 1 });
  vi.mocked(api.getTicket).mockResolvedValue(TICKET);
  vi.mocked(api.getTicketTimeline).mockResolvedValue({ comments: [], changes: [], attachments: [] });
  vi.mocked(api.listCanned).mockResolvedValue([]);
  vi.mocked(api.listTemplates).mockResolvedValue([]);
  vi.mocked(api.listUsers).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(api.listAssets).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(api.suggestArticles).mockResolvedValue([]);
  vi.mocked(api.getSlaPolicy).mockResolvedValue({});
});

describe('UX-04 assignee picker is searchable (issue 178)', () => {
  it('passes searchable to the Ticket assignee Select', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/tickets']}>
          <Tickets />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByText('Laptop screen flickering'));
    await screen.findByRole('dialog', { name: 'Ticket INC-1001' });

    const assignee = seen.filter((p) => p['ariaLabel'] === 'Ticket assignee');
    expect(assignee.length).toBeGreaterThan(0);
    for (const p of assignee) expect(p['searchable']).toBe(true);
  });
});
