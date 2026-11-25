import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuditLog from './AuditLog';
import * as api from '@/api/client';
import type { AuditLogEntry } from '@/api/types';

// RTL auto-cleanup is off in this repo — clean up explicitly.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom lacks ResizeObserver; DataTable's fill-height effect mounts one.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
window.HTMLElement.prototype.scrollIntoView = vi.fn();

const ENTRIES: AuditLogEntry[] = [
  {
    id: 'log-1',
    actor_id: 'u-admin',
    actor_name: 'admin',
    action: 'ASSET_CREATED',
    target_type: 'asset',
    target_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    diff: { status: 'ASSIGNED' },
    created_at: '2026-11-24T10:00:00Z',
  },
  {
    id: 'log-2',
    actor_id: null,
    actor_name: 'system scheduled',
    action: 'TICKET_ESCALATED',
    target_type: 'ticket',
    target_id: 'f1e2d3c4-b5a6-7890-abcd-ef0987654321',
    diff: { priority: 'HIGH' },
    created_at: '2026-11-20T08:00:00Z',
  },
];

// Live queries stubbed; everything else stays real.
vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getAuditLog: vi.fn(),
  };
});

beforeEach(() => {
  vi.mocked(api.getAuditLog).mockResolvedValue({ items: ENTRIES, total: ENTRIES.length });
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuditLog />
    </QueryClientProvider>,
  );
}

describe('Task 15 audit log filters (UI-14)', () => {
  it('audit log filters by actor and action', async () => {
    setup();
    await screen.findByText('ASSET_CREATED');
    fireEvent.change(await screen.findByLabelText(/actor/i), { target: { value: 'admin' } });
    await waitFor(() => {
      expect(screen.queryByText(/system scheduled/)).not.toBeInTheDocument();
    });
    expect(screen.getByText('ASSET_CREATED')).toBeInTheDocument();

    // Clear the actor filter, then filter by action via the select.
    fireEvent.change(screen.getByLabelText(/actor/i), { target: { value: '' } });
    await screen.findByText('TICKET_ESCALATED');
    fireEvent.click(screen.getByLabelText(/action/i));
    fireEvent.click(await screen.findByRole('option', { name: 'TICKET_ESCALATED' }));
    await waitFor(() => {
      expect(screen.queryByText('ASSET_CREATED')).not.toBeInTheDocument();
    });
    // Scoped to the table: the filter trigger also shows the selected action.
    expect(within(screen.getByRole('table')).getByText('TICKET_ESCALATED')).toBeInTheDocument();
  });

  it('target ids are truncated with copy + pretty json diff', async () => {
    const { container } = setup();
    await screen.findByText('ASSET_CREATED');
    expect((await screen.findAllByTestId('target-id'))[0].textContent!.length).toBeLessThan(20);
    expect((await screen.findAllByRole('button', { name: /copy target id/i })).length).toBeGreaterThan(0);

    // Expanding a row shows the pretty-printed diff with colored keys.
    fireEvent.click(screen.getByText('ASSET_CREATED'));
    const key = await screen.findByText('"status"');
    expect(key.className).toMatch(/text-accent/);
    expect(container.querySelector('pre')!.textContent).toContain('"status": "ASSIGNED"');
  });
});
