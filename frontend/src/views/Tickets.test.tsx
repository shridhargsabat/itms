import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Tickets from './Tickets';
import * as api from '@/api/client';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
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
    listTickets: vi.fn(),
    listUsers: vi.fn(),
  };
});

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u-admin', email: 'admin@itms.local', name: 'IT Admin', role: 'ADMIN', department: 'IT' }),
  );
  vi.mocked(api.listUsers).mockResolvedValue({ items: [], total: 0 });
});

function renderTickets() {
  return render(
    <QueryClientProvider client={makeQc()}>
      <MemoryRouter initialEntries={['/tickets']}>
        <Tickets />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Tickets loading skeletons (task 13)', () => {
  it('kanban shows skeleton columns while loading, never 0-tickets flash', () => {
    vi.mocked(api.listTickets).mockReturnValue(new Promise<never>(() => {}));
    renderTickets();
    fireEvent.click(screen.getByRole('button', { name: /kanban/i }));
    expect(screen.getAllByTestId('kanban-skeleton')).toHaveLength(4);
    expect(screen.queryByText(/0 tickets matching/)).not.toBeInTheDocument();
  });

  it('kanban shows the empty state only after loading completes with zero rows', async () => {
    vi.mocked(api.listTickets).mockResolvedValue({ items: [], total: 0 });
    renderTickets();
    fireEvent.click(screen.getByRole('button', { name: /kanban/i }));
    expect(await screen.findByText('No tickets found')).toBeInTheDocument();
    expect(screen.getByText(/0 tickets matching/)).toBeInTheDocument();
  });
});
