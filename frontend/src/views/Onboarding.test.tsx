import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Onboarding from './Onboarding';
import * as api from '@/api/client';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

// jsdom lacks ResizeObserver; ScrollX mounts one (create modal).
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
    getOnboardingEvents: vi.fn(),
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
});

function renderOnboarding() {
  return render(
    <QueryClientProvider client={makeQc()}>
      <MemoryRouter initialEntries={['/onboarding']}>
        <Onboarding />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Onboarding loading skeleton (task 13)', () => {
  it('shows skeleton cards while loading, never the empty state', () => {
    vi.mocked(api.getOnboardingEvents).mockReturnValue(new Promise<never>(() => {}));
    renderOnboarding();
    expect(screen.getByTestId('onboarding-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(/no joiner events yet/i)).not.toBeInTheDocument();
  });

  it('shows the empty state only after loading completes with zero rows', async () => {
    vi.mocked(api.getOnboardingEvents).mockResolvedValue({ items: [], total: 0 });
    renderOnboarding();
    expect(await screen.findByText(/no joiner events yet/i)).toBeInTheDocument();
  });
});
