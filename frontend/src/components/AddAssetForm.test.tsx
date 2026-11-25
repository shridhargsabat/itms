import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AddAssetForm from './AddAssetForm';
import * as api from '@/api/client';
import type { Asset, MastersMap } from '@/api/types';

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

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    createAsset: vi.fn(),
    listLocations: vi.fn(),
    listVendors: vi.fn(),
    getMasters: vi.fn(),
  };
});

function mastersWith(asset_category: MastersMap['asset_category']): MastersMap {
  return { department: [], asset_category, ticket_type: [], ticket_priority: [], ticket_status: [] };
}

const MASTERS_CATS = mastersWith([
  { id: 'c1', family: 'asset_category', code: 'LAPTOP', label: 'Laptop (Masters)', sort_order: 1, active: true, created_at: '' },
  { id: 'c2', family: 'asset_category', code: 'TABLET', label: 'Tablet (Masters)', sort_order: 2, active: true, created_at: '' },
]);

beforeEach(() => {
  vi.mocked(api.listLocations).mockResolvedValue([]);
  vi.mocked(api.listVendors).mockResolvedValue([]);
  vi.mocked(api.getMasters).mockResolvedValue(MASTERS_CATS);
  vi.mocked(api.createAsset).mockResolvedValue({} as Asset);
});

function renderForm() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AddAssetForm onDone={vi.fn()} />
    </QueryClientProvider>,
  );
}

function setInput(id: string, value: string) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing input #${id}`);
  fireEvent.change(el, { target: { value } });
}

describe('AddAssetForm submit validation (FORM-02)', () => {
  it('empty submit shows an inline error, blocks createAsset, and focuses name', async () => {
    renderForm();
    await screen.findByRole('button', { name: /^add asset$/i });
    fireEvent.click(screen.getByRole('button', { name: /^add asset$/i }));

    expect(await screen.findByText('Asset name is required')).toHaveRole('alert');
    expect(api.createAsset).not.toHaveBeenCalled();
    const nameInput = document.getElementById('asset-name')!;
    expect(nameInput).toHaveFocus();
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
  });

  it('invalid unit cost shows an inline error and focuses the cost field', async () => {
    renderForm();
    await screen.findByRole('button', { name: /^add asset$/i });
    setInput('asset-name', 'Dell XPS 15');
    setInput('asset-unit-cost', '-5');
    fireEvent.click(screen.getByRole('button', { name: /^add asset$/i }));

    expect(await screen.findByText('Unit cost must be a number of 0 or more')).toBeInTheDocument();
    expect(api.createAsset).not.toHaveBeenCalled();
    expect(document.getElementById('asset-unit-cost')).toHaveFocus();
  });

  it('valid submit sends unit cost, expected EOL and specs via createAsset', async () => {
    renderForm();
    await screen.findByRole('button', { name: /^add asset$/i });
    setInput('asset-name', 'Dell XPS 15');
    setInput('asset-tag', 'IT-0001');
    setInput('asset-unit-cost', '120000');
    setInput('asset-expected-eol', '2029-06-01');
    fireEvent.click(screen.getByRole('button', { name: /add specification/i }));
    fireEvent.change(screen.getByPlaceholderText(/key \(e\.g\. processor\)/i), { target: { value: 'processor' } });
    fireEvent.change(screen.getByPlaceholderText(/value \(e\.g\. intel/i), { target: { value: 'Intel i7' } });
    fireEvent.click(screen.getByRole('button', { name: /^add asset$/i }));

    await waitFor(() => expect(api.createAsset).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createAsset).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        name: 'Dell XPS 15',
        asset_tag: 'IT-0001',
        category: 'LAPTOP',
        unit_cost: 120000,
        expected_eol: '2029-06-01',
        specs: { processor: 'Intel i7' },
      }),
    );
  });
});

describe('AddAssetForm Masters-backed category (FORM-09)', () => {
  it('category options come from Masters asset_category and submit the Masters code', async () => {
    renderForm();
    // Wait for the Masters options to land before asserting the trigger label.
    await screen.findByText('Laptop (Masters)');
    const trigger = screen.getByLabelText(/category/i);
    expect(trigger).toHaveTextContent('Laptop (Masters)');
    // No free-text category input anywhere.
    expect(screen.queryByRole('textbox', { name: /category/i })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: 'Tablet (Masters)' }));

    setInput('asset-name', 'iPad Pro');
    fireEvent.click(screen.getByRole('button', { name: /^add asset$/i }));
    await waitFor(() => expect(api.createAsset).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createAsset).mock.calls[0][0]).toEqual(
      expect.objectContaining({ category: 'TABLET' }),
    );
  });

  it('falls back to the static category list when Masters has no asset_category rows', async () => {
    vi.mocked(api.getMasters).mockResolvedValue(mastersWith([]));
    renderForm();
    fireEvent.click(await screen.findByLabelText(/category/i));

    expect(await screen.findByRole('option', { name: 'NETWORK DEVICE' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'NETWORK DEVICE' }));
    setInput('asset-name', 'Core switch');
    fireEvent.click(screen.getByRole('button', { name: /^add asset$/i }));
    await waitFor(() => expect(api.createAsset).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createAsset).mock.calls[0][0]).toEqual(
      expect.objectContaining({ category: 'NETWORK_DEVICE' }),
    );
  });

  it('Create/Edit parity: both flows expose unit cost, expected EOL and the specs editor', () => {
    // Edit flow (AssetSpecModal) must keep exposing the same three fields
    // the create flow submits — read-only parity guard, no edits there.
    const editSrc = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './AssetSpecModal.tsx'),
      'utf8',
    );
    expect(editSrc).toContain('unit_cost');
    expect(editSrc).toContain('expected_eol');
    expect(editSrc).toMatch(/Specifications/);

    // Create input type must keep accepting all three (backend already does).
    const typesSrc = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../api/types.ts'),
      'utf8',
    );
    const createInput = typesSrc.slice(
      typesSrc.indexOf('interface CreateAssetInput'),
      typesSrc.indexOf('interface CreateAssetInput') + 600,
    );
    expect(createInput).toContain('unit_cost');
    expect(createInput).toContain('expected_eol');
    expect(createInput).toContain('specs');

    // And the create form must keep rendering all three controls.
    renderForm();
    expect(document.getElementById('asset-unit-cost')).toBeInTheDocument();
    expect(document.getElementById('asset-expected-eol')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add specification/i })).toBeInTheDocument();
  });
});
