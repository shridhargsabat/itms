import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CMDB from './CMDB';
import * as api from '@/api/client';

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

const NODES = [
  { id: 'ci-pg', asset_tag: 'AST-101', name: 'postgres-db-01', category: 'SERVER', status: 'ASSIGNED' },
  { id: 'ci-ng', asset_tag: 'AST-102', name: 'nginx-web-01', category: 'SERVER', status: 'ASSIGNED' },
  { id: 'ci-api', asset_tag: 'AST-103', name: 'app-api-01', category: 'SERVER', status: 'IN_STOCK' },
] as const;

const TOPOLOGY = {
  nodes: [...NODES],
  edges: [{ id: 'e1', parent_asset_id: 'ci-pg', child_asset_id: 'ci-api', relationship_type: 'DEPENDS_ON' }],
};

const IMPACT = { root_asset_id: 'ci-pg', impact_count: 0, impacted: [] };

// Live queries stubbed; everything else stays real.
vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getTopology: vi.fn(),
    getImpact: vi.fn(),
  };
});

beforeEach(() => {
  vi.mocked(api.getTopology).mockResolvedValue(TOPOLOGY);
  vi.mocked(api.getImpact).mockResolvedValue(IMPACT);
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CMDB />
    </QueryClientProvider>,
  );
}

describe('Task 15 CMDB search and relationships (UI-14)', () => {
  it('configuration items table is searchable', async () => {
    setup();
    expect((await screen.findAllByText('nginx-web-01')).length).toBeGreaterThan(0);
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'postgres' } });
    expect(screen.queryByText(/nginx-web/)).not.toBeInTheDocument();
    expect(screen.getAllByText('postgres-db-01').length).toBeGreaterThan(0);
  });

  it('relationship rows show asset names and are clickable', async () => {
    setup();
    const rel = await screen.findByRole('button', { name: /postgres.*depends/i });
    // Row shows asset names + tags for both endpoints.
    expect(within(rel).getByText('postgres-db-01')).toBeInTheDocument();
    expect(within(rel).getByText('AST-101')).toBeInTheDocument();
    expect(within(rel).getByText('app-api-01')).toBeInTheDocument();
    expect(within(rel).getByText('AST-103')).toBeInTheDocument();
    fireEvent.click(rel);
    expect(await screen.findByText(/ci detail/i)).toBeInTheDocument();
    // Clicking selects the referenced CI — the detail panel follows.
    expect(within(screen.getByTestId('ci-detail')).getByText('app-api-01')).toBeInTheDocument();
  });
});
