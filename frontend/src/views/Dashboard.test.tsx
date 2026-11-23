import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';
import { setThemeMode } from '@/lib/theme';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly:
// with several tests per file one render would otherwise leak into the next.
afterEach(cleanup);
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// CountUp animates via requestAnimationFrame; take the reduced-motion path so
// KPI values settle synchronously instead of needing rAF frames.
window.matchMedia = ((query: string): MediaQueryList => ({
  matches: query.includes('prefers-reduced-motion'),
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const METRICS = {
  overdue_tickets: 3,
  asset_count: 42,
  open_tickets: 7,
  high_priority_count: 2,
  in_stock_count: 15,
  warranty_alerts_count: 4,
  onboarding_overdue: 1,
  open_requests: 6,
  license_alerts: 5,
  tickets_by_priority: [],
  assets_by_status: [],
};

// Live queries stubbed; getCachedUser stays real (localStorage-backed).
vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getDashboardMetrics: () => Promise.resolve(METRICS),
    getAuditLog: () => Promise.resolve({ items: [] }),
    listOverdueTickets: () => Promise.resolve({ items: [] }),
    // Task 8 analytics row: empty data keeps this suite hermetic (no real
    // fetch, no recharts mount — both components take the EmptyState path).
    getVelocity: () => Promise.resolve({ range: '7d', points: [] }),
    getWarrantyAlerts: () => Promise.resolve([]),
    getLicenses: () => Promise.resolve({ items: [], total: 0 }),
    // Task 9 service queue: empty keeps this suite hermetic (no real fetch).
    listTickets: () => Promise.resolve({ items: [], total: 0 }),
  };
});

// Observe Day/Night toggle calls without hitting the server push.
vi.mock('@/lib/theme', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/theme')>();
  return { ...mod, setThemeMode: vi.fn() };
});

function setUser(role: string) {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u1', email: 'a@x.com', name: 'A', role, department: 'IT' }),
  );
}

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderDashboard(theme: string = 'light') {
  localStorage.setItem('itms_theme', theme);
  return render(
    <QueryClientProvider client={queryClient()}>
      <MemoryRouter initialEntries={['/']}>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Dashboard Bento shell (task 7)', () => {
  it('renders exactly 4 KPI lenses with live values and subs', async () => {
    setUser('ADMIN');
    renderDashboard();
    const section = await screen.findByTestId('kpi-lenses');
    const lenses = within(section).getAllByRole('link');
    expect(lenses).toHaveLength(4);

    expect(within(section).getByRole('link', { name: /total assets/i })).toHaveAttribute(
      'href',
      '/assets',
    );
    expect(await within(section).findByText('42')).toBeInTheDocument();
    expect(within(section).getByText('15 in stock')).toBeInTheDocument();

    expect(within(section).getByRole('link', { name: /open tickets/i })).toHaveAttribute(
      'href',
      '/tickets?status=OPEN',
    );
    expect(within(section).getByText('2 high priority')).toBeInTheDocument();

    expect(within(section).getByRole('link', { name: /sla escalated/i })).toHaveAttribute(
      'href',
      '/tickets?overdue=true',
    );

    // Combined warranty + license count.
    expect(within(section).getByRole('link', { name: /warranty & license/i })).toHaveAttribute(
      'href',
      '/warranty',
    );
    expect(within(section).getByText('9')).toBeInTheDocument();
    expect(within(section).getByText('Expiring ≤ 45d')).toBeInTheDocument();
  });

  it('Day/Night buttons call setThemeMode with light/dark', async () => {
    setUser('ADMIN');
    renderDashboard();
    expect(await screen.findByTestId('kpi-lenses')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Day Glass' }));
    expect(vi.mocked(setThemeMode)).toHaveBeenCalledWith('light');
    fireEvent.click(screen.getByRole('button', { name: 'Night Glass' }));
    expect(vi.mocked(setThemeMode)).toHaveBeenCalledWith('dark');
  });

  it('secondary pills link to /onboarding and /requests', async () => {
    setUser('ADMIN');
    renderDashboard();
    const pills = await screen.findByTestId('secondary-pills');
    expect(within(pills).getByRole('link', { name: /onboarding/i })).toHaveAttribute(
      'href',
      '/onboarding',
    );
    expect(within(pills).getByRole('link', { name: /open requests/i })).toHaveAttribute(
      'href',
      '/requests',
    );
    expect(await within(pills).findByText('1')).toBeInTheDocument();
    expect(within(pills).getByText('6')).toBeInTheDocument();
  });

  it('long KPI titles truncate and the toolbar keeps its glass + sticky shell', async () => {
    setUser('ADMIN');
    renderDashboard();
    const section = await screen.findByTestId('kpi-lenses');
    for (const label of ['Total Assets', 'Open Tickets', 'SLA Escalated', 'Warranty & License']) {
      expect(within(section).getByText(label)).toHaveClass('truncate');
    }
    const toolbar = screen.getByTestId('dashboard-toolbar');
    expect(toolbar).toHaveClass('liquid-glass-panel');
    expect(toolbar).toHaveClass('rounded-[26px]');
    expect(toolbar).toHaveClass('sticky');
    expect(toolbar).toHaveClass('z-30');
    expect(
      screen.getByRole('button', { name: /new ticket/i }),
    ).toHaveClass('liquid-glass-btn-primary');
  });

  it('New Ticket trigger opens the existing modal', async () => {
    setUser('ADMIN');
    renderDashboard();
    expect(await screen.findByTestId('kpi-lenses')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /new ticket/i }));
    expect(await screen.findByRole('heading', { name: 'New Ticket' })).toBeInTheDocument();
  });
});
