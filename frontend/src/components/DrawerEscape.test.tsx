import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AssetSpecModal from './AssetSpecModal';
import Tickets from '@/views/Tickets';
import type { Asset, Ticket } from '@/api/types';

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

const SAMPLE_ASSET: Asset = {
  id: 'a1',
  asset_tag: 'AST-10014',
  name: 'Lenovo IdeaPad Slim 3 Laptop',
  category: 'LAPTOP',
  status: 'ASSIGNED',
  serial_number: '83K100CGIN',
  assigned_to_user_id: null,
  assigned_user_name: 'Aarav Gupta',
  purchase_date: '2026-01-15',
  warranty_expiry: '2029-01-15',
  unit_cost: null,
  expected_eol: null,
  specs: {},
  created_at: '2026-01-15T00:00:00Z',
  updated_at: '2026-01-15T00:00:00Z',
};

const SAMPLE_TICKET: Ticket = {
  id: 't1',
  ticket_number: 'TKT-1001',
  title: 'VPN connection drops',
  description: 'Drops every 10 minutes',
  ticket_type: 'INCIDENT',
  priority: 'HIGH',
  status: 'OPEN',
  requester_id: 'u1',
  requester_name: 'Aarav Gupta',
  assignee_id: null,
  assignee_name: null,
  asset_id: null,
  asset_tag: null,
  asset_name: null,
  sla_due_at: null,
  sla_escalated_at: null,
  created_at: '2026-01-15T00:00:00Z',
  updated_at: '2026-01-15T00:00:00Z',
};

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getAssetLifecycle: () => Promise.resolve([]),
    listVendors: () => Promise.resolve([]),
    listLocations: () => Promise.resolve([]),
    listAssetMoves: () => Promise.resolve([]),
    listClaims: () => Promise.resolve([]),
    listAssetDocuments: () => Promise.resolve([]),
    listTickets: () => Promise.resolve({ items: [SAMPLE_TICKET], total: 1 }),
    getTicketTimeline: () => Promise.resolve({ comments: [], changes: [], attachments: [] }),
    listCanned: () => Promise.resolve([]),
    listTemplates: () => Promise.resolve([]),
  };
});

function qc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('Slide-over drawers close on Escape key', () => {
  it('calls onClose when Escape is pressed while AssetSpecModal is open', () => {
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={qc()}>
        <AssetSpecModal asset={SAMPLE_ASSET} onClose={onClose} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Lenovo IdeaPad Slim 3 Laptop')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes the Tickets detail drawer when Escape is pressed', async () => {
    render(
      <QueryClientProvider client={qc()}>
        <MemoryRouter initialEntries={['/tickets']}>
          <Tickets />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const rowTitle = await screen.findByText('VPN connection drops');
    fireEvent.click(rowTitle);
    expect(await screen.findByText('Drops every 10 minutes')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Drops every 10 minutes')).not.toBeInTheDocument();
  });

  it('ticket drawer X button closes without activating cards behind it', async () => {
    render(
      <QueryClientProvider client={qc()}>
        <MemoryRouter initialEntries={['/tickets']}>
          <Tickets />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const rowTitle = await screen.findByText('VPN connection drops');
    fireEvent.click(rowTitle); // opens drawer
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    const onDocClick = vi.fn();
    document.addEventListener('click', onDocClick);
    // X in the drawer header is the first /close/i match (status "Close" advance button renders later)
    const closeBtn = screen.getAllByRole('button', { name: /close/i })[0];
    fireEvent.click(closeBtn);
    document.removeEventListener('click', onDocClick);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onDocClick).not.toHaveBeenCalled(); // open only — no click-through past the drawer
  });

  it('drawer panel sits above the offline banner layer', async () => {
    render(
      <QueryClientProvider client={qc()}>
        <MemoryRouter initialEntries={['/tickets']}>
          <Tickets />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const rowTitle = await screen.findByText('VPN connection drops');
    fireEvent.click(rowTitle);
    const panel = await screen.findByRole('dialog');
    expect(panel.parentElement?.className ?? '').toMatch(/z-\[70\]/);
  });
});
