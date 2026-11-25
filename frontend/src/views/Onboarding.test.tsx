import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Onboarding from './Onboarding';
import * as api from '@/api/client';
import { formatDateOnly } from '@/lib/utils';
import type { OnboardingEvent } from '@/api/types';

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

let evSeq = 0;
function makeEvent(overrides: Partial<OnboardingEvent> = {}): OnboardingEvent {
  evSeq += 1;
  return {
    id: `ev-${evSeq}`,
    event_type: 'ONBOARDING',
    person_name: `Person ${evSeq}`,
    person_email: `person${evSeq}@example.com`,
    start_date: '2026-08-21',
    notes: null,
    status: 'OPEN',
    created_by: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    total_tasks: 4,
    done_tasks: 1,
    overdue_tasks: 0,
    ...overrides,
  };
}

describe('Onboarding badge parity and status copy (task 14)', () => {
  it('tab badges equal rendered list totals and stay visible when inactive', async () => {
    vi.mocked(api.getOnboardingEvents).mockResolvedValue({
      items: [makeEvent(), makeEvent()],
      total: 12, // raw query total must NOT drive the badge
    });
    renderOnboarding();
    await screen.findAllByTestId('onboarding-card'); // let both tab queries settle (tabs render before data)
    const tab = await screen.findByRole('tab', { name: /offboarding/i });
    const badgeN = Number(tab.textContent!.match(/\d+/)![0]);
    expect(screen.getAllByTestId('onboarding-card')).toHaveLength(badgeN); // on matching tab
    expect(tab.querySelector('[data-testid="tab-badge"]')).toBeVisible(); // inactive too
  });

  it('uses last-day copy for offboarding', async () => {
    vi.mocked(api.getOnboardingEvents).mockResolvedValue({
      items: [makeEvent({ event_type: 'OFFBOARDING', start_date: '2026-08-21' })],
      total: 1,
    });
    renderOnboarding();
    // Brief's verbatim "Last day Aug 21, 2026" assumes en-US ICU ordering; this
    // environment formats "21 Aug 2026", so assert via the same formatter.
    expect(await screen.findByText(`Last day ${formatDateOnly('2026-08-21')}`)).toBeInTheDocument();
    expect(screen.queryByText(/leaves/i)).not.toBeInTheDocument();
  });

  it('uses start-date copy for onboarding', async () => {
    vi.mocked(api.getOnboardingEvents).mockResolvedValue({
      items: [makeEvent({ event_type: 'ONBOARDING', start_date: '2026-08-21' })],
      total: 1,
    });
    renderOnboarding();
    expect(await screen.findByText(`Start date ${formatDateOnly('2026-08-21')}`)).toBeInTheDocument();
  });

  it('shows closed-early copy for CLOSED events with incomplete tasks', async () => {
    vi.mocked(api.getOnboardingEvents).mockResolvedValue({
      items: [makeEvent({ status: 'CLOSED', total_tasks: 6, done_tasks: 3 })],
      total: 1,
    });
    renderOnboarding();
    expect(await screen.findByText(/closed early · 3\/6 tasks done/i)).toBeInTheDocument();
  });

  it('keeps plain progress for fully-complete CLOSED events', async () => {
    vi.mocked(api.getOnboardingEvents).mockResolvedValue({
      items: [makeEvent({ status: 'CLOSED', total_tasks: 6, done_tasks: 6 })],
      total: 1,
    });
    renderOnboarding();
    expect(await screen.findByText('6/6')).toBeInTheDocument();
    expect(screen.queryByText(/closed early/i)).not.toBeInTheDocument();
  });
});
