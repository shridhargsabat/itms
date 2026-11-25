import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Masters from './Masters';
import * as api from '@/api/client';

// RTL auto-cleanup is off in this repo — clean up explicitly.
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

// jsdom lacks ResizeObserver; ScrollX mounts one.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getMasters: vi.fn(),
    listUsers: vi.fn(),
  };
});

beforeEach(() => {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u-admin', email: 'admin@itms.local', name: 'IT Admin', role: 'ADMIN', department: 'IT' }),
  );
  vi.mocked(api.getMasters).mockResolvedValue({
    department: [],
    asset_category: [],
    ticket_type: [],
    ticket_priority: [],
    ticket_status: [],
  });
  vi.mocked(api.listUsers).mockResolvedValue({ items: [], total: 0 });
});

function renderMasters() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Masters />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Masters tabs (task 17)', () => {
  it('masters defaults to the first tab and never clips tab labels', async () => {
    renderMasters();
    expect(await screen.findByRole('tab', { selected: true })).toHaveTextContent('Users');
    expect(screen.queryByText(/statuse\.\.\./i)).not.toBeInTheDocument();
  });
});
