import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import DataTable from './DataTable';
import Modal from './Modal';
import SlaChip from './SlaChip';

afterEach(() => {
  cleanup();
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

describe('Task 6 glass primitives: pills, modal, frosted rows', () => {
  it('SlaChip renders a rounded-full pill with px-2.5 padding', () => {
    const dueAt = new Date(Date.now() + 4 * 3_600_000).toISOString();
    render(<SlaChip dueAt={dueAt} policyHours={24} />);
    const chip = screen.getByTitle(/SLA due /);
    expect(chip.className).toContain('rounded-full');
    expect(chip.className).toContain('px-2.5');
  });

  it('Modal panel carries liquid-glass-panel with 26px radii; scrim keeps backdrop-blur-sm', () => {
    const { container } = render(
      <Modal title="Glass Modal" onClose={() => {}}>
        <p>Body</p>
      </Modal>,
    );
    void container;
    const panel = document.body.querySelector('.liquid-glass-panel');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('class')).toContain('sm:rounded-[26px]');
    expect(panel?.getAttribute('class')).toContain('rounded-t-[26px]');
    const scrim = document.body.querySelector('.backdrop-blur-sm');
    expect(scrim).not.toBeNull();
  });

  it('DataTable clickable rows carry frosted hover classes', () => {
    render(
      <DataTable
        columns={[{ key: 'name', header: 'Name' }]}
        rows={[{ id: '1', name: 'Row One' }]}
        onRowClick={() => {}}
      />,
    );
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
    const bodyRow = rows[1];
    expect(bodyRow.className).toContain('hover:bg-white/40');
    expect(bodyRow.className).toContain('dark:hover:bg-white/10');
  });
});

describe('Task 6 glass badge overrides in index.css', () => {
  // Same fileURLToPath resolution as theme-parity.test.ts — the
  // `new URL(..., import.meta.url)` pattern is rewritten by Vite.
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'),
    'utf8',
  );
  const OVERRIDES: Array<[string, string]> = [
    ['.ring-inset.text-red-700', '#FF3B30'], // URGENT
    ['.ring-inset.text-orange-700', '#FF9500'], // HIGH
    ['.ring-inset.text-yellow-700', '#007AFF'], // MEDIUM
    ['.ring-inset.text-blue-700', '#007AFF'], // OPEN
    ['.ring-inset.text-amber-700', '#FF9500'], // IN_PROGRESS
    ['.ring-inset.text-emerald-700', '#34C759'], // RESOLVED
  ];
  it.each(OVERRIDES)('glass badge override %s tints to %s', (selector, hex) => {
    expect(css).toContain(selector);
    expect(css).toContain(hex);
  });
  it('Task 6 block uses guard-chain gating only (R9: no affirmative .theme-X selectors)', () => {
    const block = css.slice(css.indexOf('Task 6:'));
    expect(block.length).toBeGreaterThan(0);
    // :not(.theme-*) guard chains are allowed; bare `.theme-x ` descendant
    // selectors (and .ledgerly-*) are not.
    expect(block).not.toMatch(/(?<!\()\.(theme|ledgerly)-[a-z-]+/);
  });
});

describe('Task 11 glass table & filter-bar parity', () => {
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'),
    'utf8',
  );

  it('TABLE_SPEC shell clips corner overflow and tbody uses bg-surface instead of bg-base', async () => {
    const { TABLE_SPEC } = await import('./tableSpec');
    expect(TABLE_SPEC.shell).toContain('overflow-hidden');
    expect(TABLE_SPEC.shell).toContain('glass-card');
    expect(TABLE_SPEC.tbody).toContain('bg-surface');
    expect(TABLE_SPEC.tbody).not.toContain('bg-base');
  });

  it('FilterBar uses glass-card surface tier instead of flat bg-surface', async () => {
    const { default: FilterBar } = await import('./FilterBar');
    const { container } = render(
      <FilterBar>
        <span>Filter Child</span>
      </FilterBar>,
    );
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('glass-card');
  });

  it('scopes translucent table header, body, and row hover rules under light and dark glass guard chains', () => {
    expect(css).toContain('table thead');
    expect(css).toContain('table tbody');
    expect(css).toContain('table tbody tr:hover');
    // Verify Task 6+ and Task 10+ R9 guard-chain invariant still holds
    const block6 = css.slice(css.indexOf('Task 6:'));
    expect(block6).not.toMatch(/(?<!\()\.(theme|ledgerly)-[a-z-]+/);
  });

  it('unifies Liquid Glass --t-accent with Apple blue and removes hardcoded indigo from Tickets and Masters', () => {
    expect(css).toContain('--t-accent: #0066D6');
    expect(css).toContain('--t-accent: #0A84FF');
    const ticketsSrc = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../views/Tickets.tsx'),
      'utf8',
    );
    const mastersSrc = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../views/Masters.tsx'),
      'utf8',
    );
    expect(ticketsSrc).not.toContain('indigo-500');
    expect(mastersSrc).not.toContain('indigo-500');
  });
});
