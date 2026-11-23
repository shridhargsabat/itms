import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import CMDB from './CMDB';

afterEach(() => {
  cleanup();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// jsdom lacks ResizeObserver; DataTable's fill-height effect mounts one.
// Minimal stub (observe/unobserve/disconnect no-ops) — test-only hygiene.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const NODES = [
  { id: 'a1', asset_tag: 'AST-001', name: 'Root Server', category: 'SERVER', status: 'ASSIGNED' },
  { id: 'a2', asset_tag: 'AST-002', name: 'App Host', category: 'SERVER', status: 'ASSIGNED' },
] as const;

const TOPOLOGY = {
  nodes: [...NODES],
  edges: [
    { id: 'e1', parent_asset_id: 'a1', child_asset_id: 'a2', relationship_type: 'RUNS_ON' },
  ],
};

const IMPACT = {
  root_asset_id: 'a1',
  impact_count: 1,
  impacted: [
    { asset_id: 'a2', asset_tag: 'AST-002', name: 'App Host', category: 'SERVER', depth: 1 },
  ],
};

// Live queries stubbed; everything else stays real.
vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getTopology: () => Promise.resolve(TOPOLOGY),
    getImpact: () => Promise.resolve(IMPACT),
  };
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CMDB />
    </QueryClientProvider>,
  );
}

describe('Task 10 CMDB glass pass', () => {
  it('root header tag carries cmdb-root-tag (and only the root tag does)', async () => {
    const { container } = setup();
    await screen.findByText('1 impacted');
    const tags = container.querySelectorAll('.cmdb-root-tag');
    expect(tags.length).toBe(1);
    expect(tags[0].textContent).toBe('AST-001');
  });

  it('depth badge carries cmdb-depth', async () => {
    const { container } = setup();
    await screen.findByText('1 impacted');
    const badges = container.querySelectorAll('.cmdb-depth');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toMatch(/depth 1/i);
  });

  it('panels carry liquid-glass-panel', async () => {
    const { container } = setup();
    await screen.findByText('1 impacted');
    const panels = container.querySelectorAll('.liquid-glass-panel');
    // Sidebar + impact + relationships (the transient loading box unmounts).
    expect(panels.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Task 10 cmdb glass-scope rules in index.css', () => {
  // Same fileURLToPath resolution as theme-parity.test.ts — the
  // `new URL(..., import.meta.url)` pattern is rewritten by Vite.
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'),
    'utf8',
  );

  it('cmdb-root-tag glass-scopes to #007AFF', () => {
    expect(css).toContain('.cmdb-root-tag');
    expect(css).toContain('#007AFF');
  });

  it('cmdb-depth glass-scopes to #AF52DE', () => {
    expect(css).toContain('.cmdb-depth');
    expect(css).toContain('#AF52DE');
  });

  it('Task 10 block uses guard-chain gating only (R9: no affirmative .theme-X selectors)', () => {
    const block = css.slice(css.indexOf('Task 10:'));
    expect(block.length).toBeGreaterThan(0);
    // :not(.theme-*) guard chains are allowed; bare `.theme-x ` descendant
    // selectors (and .ledgerly-*) are not.
    expect(block).not.toMatch(/(?<!\()\.(theme|ledgerly)-[a-z-]+/);
  });
});
