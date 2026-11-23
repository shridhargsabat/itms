import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VelocityChart from './VelocityChart';
import ExpiringSoon from './ExpiringSoon';
import Dashboard from '@/views/Dashboard';
import { getAuditLog, getDashboardMetrics, getLicenses, getVelocity, getWarrantyAlerts, listOverdueTickets, listTickets } from '@/api/client';
import { licenseDaysLeft } from '@/lib/chartData';
import type { License, VelocityPoint, WarrantyAlert } from '@/api/types';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(cleanup);
afterEach(() => {
  vi.resetAllMocks();
});

// CountUp animates via requestAnimationFrame; take the reduced-motion path so
// values settle synchronously (same recipe as Dashboard.test.tsx).
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

// Standard recharts-in-jsdom recipe: ResizeObserver that fires immediately
// with a fixed content box + clientWidth/clientHeight stubs so
// ResponsiveContainer renders the chart instead of a 0x0 box.
class ResizeObserverStub {
  private cb: ResizeObserverCallback;

  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }

  observe() {
    this.cb(
      [{ contentRect: { width: 800, height: 240 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }

  unobserve() {}

  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 240 });

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getVelocity: vi.fn(),
    getWarrantyAlerts: vi.fn(),
    getLicenses: vi.fn(),
    getDashboardMetrics: vi.fn(),
    getAuditLog: vi.fn(),
    listOverdueTickets: vi.fn(),
    listTickets: vi.fn(),
  };
});

const SEVEN: VelocityPoint[] = [
  { day: 'Mon', incidents: 12, requests: 18, resolved: 27 },
  { day: 'Tue', incidents: 15, requests: 21, resolved: 34 },
  { day: 'Wed', incidents: 9, requests: 16, resolved: 26 },
  { day: 'Thu', incidents: 14, requests: 19, resolved: 31 },
  { day: 'Fri', incidents: 11, requests: 22, resolved: 32 },
  { day: 'Sat', incidents: 4, requests: 6, resolved: 11 },
  { day: 'Sun', incidents: 5, requests: 5, resolved: 10 },
];

const THIRTY: VelocityPoint[] = [
  { day: 'Wk 1', incidents: 58, requests: 82, resolved: 134 },
  { day: 'Wk 2', incidents: 49, requests: 76, resolved: 128 },
  { day: 'Wk 3', incidents: 44, requests: 88, resolved: 131 },
  { day: 'Wk 4', incidents: 39, requests: 74, resolved: 118 },
];

const WARRANTY: WarrantyAlert[] = [
  { id: 'w1', asset_tag: 'SRV-MUM-001', name: 'Core PostgreSQL 18 Primary', status: 'ASSIGNED', warranty_expiry: '2026-12-14', days_left: 21 },
  { id: 'w2', asset_tag: 'NET-MUM-004', name: 'Cisco Catalyst 9300 Core Switch', status: 'ASSIGNED', warranty_expiry: '2026-12-08', days_left: 15 },
  { id: 'w3', asset_tag: 'LPT-ENG-142', name: 'MacBook Pro 16 M3 Max', status: 'ASSIGNED', warranty_expiry: '2027-03-19', days_left: 116 },
];

/** Local-midnight YYYY-MM-DD n days from today (matches licenseDaysLeft day-math). */
function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function license(id: string, name: string, vendor: string | null, daysOut: number): License {
  return {
    id,
    name,
    vendor,
    license_type: 'SUBSCRIPTION',
    seats_total: 250,
    seats_used: 240,
    cost_per_seat: null,
    cost_total: null,
    currency: 'INR',
    expiry_date: inDays(daysOut),
    renewal_cost: null,
    notes: null,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

const LICENSES: License[] = [
  license('l1', 'Microsoft 365 E5 (250 Seats)', 'Microsoft', 12),
  license('l2', 'CrowdStrike Falcon Complete', 'CrowdStrike', 30),
];

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

beforeEach(() => {
  vi.mocked(getVelocity).mockImplementation((range: '7d' | '30d') =>
    Promise.resolve({ range, points: range === '30d' ? THIRTY : SEVEN }),
  );
  vi.mocked(getWarrantyAlerts).mockResolvedValue(WARRANTY);
  vi.mocked(getLicenses).mockResolvedValue({ items: LICENSES, total: LICENSES.length });
  vi.mocked(getDashboardMetrics).mockResolvedValue(METRICS);
  vi.mocked(getAuditLog).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(listOverdueTickets).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(listTickets).mockResolvedValue({ items: [], total: 0 });
});

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderChart() {
  return render(
    <QueryClientProvider client={queryClient()}>
      <MemoryRouter initialEntries={['/']}>
        <VelocityChart />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderStack() {
  return render(
    <QueryClientProvider client={queryClient()}>
      <MemoryRouter initialEntries={['/']}>
        <ExpiringSoon />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

describe('VelocityChart (task 8)', () => {
  it('fetches 7d by default, renders both areas, and refetches on 30d toggle', async () => {
    const { container } = renderChart();

    expect(getVelocity).toHaveBeenCalledWith('7d');
    expect(await screen.findByText('Service Velocity & Resolution')).toBeInTheDocument();
    expect(await screen.findByText('Mon')).toBeInTheDocument();

    // Exact reference series: resolved green + incidents blue with gradient fills.
    expect(container.querySelector('#algGreen')).not.toBeNull();
    expect(container.querySelector('#algBlue')).not.toBeNull();
    expect(container.querySelector('path[stroke="#34C759"]')).not.toBeNull();
    expect(container.querySelector('path[stroke="#007AFF"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '30d' }));
    expect(getVelocity).toHaveBeenCalledWith('30d');
    expect(await screen.findByText('Wk 1')).toBeInTheDocument();
  });

  it('shows an empty state when velocity points are []', async () => {
    vi.mocked(getVelocity).mockResolvedValue({ range: '7d', points: [] });
    renderChart();
    expect(await screen.findByText('No velocity data')).toBeInTheDocument();
  });
});

describe('ExpiringSoon (task 8)', () => {
  it('renders warranty + license rows with countdown pills and an alerts pill', async () => {
    renderStack();
    await screen.findByText('5 Alerts');
    const stack = screen.getByTestId('expiring-soon');

    expect(within(stack).getByText('5 Alerts')).toBeInTheDocument();
    expect(within(stack).getByText('Core PostgreSQL 18 Primary')).toBeInTheDocument();
    expect(within(stack).getByText('SRV-MUM-001 · 2026-12-14')).toBeInTheDocument();
    expect(within(stack).getByText('21d')).toBeInTheDocument();
    expect(within(stack).getByText('15d')).toBeInTheDocument();

    expect(within(stack).getByText('Microsoft 365 E5 (250 Seats)')).toBeInTheDocument();
    expect(within(stack).getByText(`${licenseDaysLeft(LICENSES[0].expiry_date)}d`)).toBeInTheDocument();
    expect(within(stack).getByText(`${licenseDaysLeft(LICENSES[1].expiry_date)}d`)).toBeInTheDocument();

    expect(getWarrantyAlerts).toHaveBeenCalledWith('expiring');
    expect(getLicenses).toHaveBeenCalledWith({ scope: 'expiring', limit: 5 });
  });

  it('shows only the top 5 warranty alerts by urgency', async () => {
    vi.mocked(getWarrantyAlerts).mockResolvedValue(
      [7, 6, 5, 4, 3, 2, 1].map((d) => ({
        id: `w${d}`,
        asset_tag: `TAG-${d}`,
        name: `W-${d}`,
        status: 'ASSIGNED',
        warranty_expiry: '2026-12-01',
        days_left: d,
      })),
    );
    renderStack();
    const stack = await screen.findByTestId('expiring-soon');
    expect(await within(stack).findByText('W-1')).toBeInTheDocument();
    expect(within(stack).queryByText('W-6')).not.toBeInTheDocument();
    expect(within(stack).queryByText('W-7')).not.toBeInTheDocument();
  });

  it('navigates to /cmdb on Open CMDB Impact Lens', async () => {
    render(
      <QueryClientProvider client={queryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<><ExpiringSoon /><LocationProbe /></>} />
            <Route path="/cmdb" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId('expiring-soon')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open cmdb impact lens/i }));
    expect(await screen.findByTestId('loc')).toHaveTextContent('/cmdb');
  });

  it('shows an empty state when nothing is expiring', async () => {
    vi.mocked(getWarrantyAlerts).mockResolvedValue([]);
    vi.mocked(getLicenses).mockResolvedValue({ items: [], total: 0 });
    renderStack();
    expect(await screen.findByText('Nothing expiring soon')).toBeInTheDocument();
  });
});

describe('Dashboard analytics row wiring (task 8)', () => {
  it('inserts the 8/4 velocity + expiring grid between pills and activity', async () => {
    render(
      <QueryClientProvider client={queryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <Dashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const row = await screen.findByTestId('analytics-row');
    expect(row).toHaveClass('xl:grid-cols-12');
    expect(within(row).getByTestId('velocity-chart')).toHaveClass('xl:col-span-8');
    expect(within(row).getByTestId('expiring-soon')).toHaveClass('xl:col-span-4');
    expect(within(row).getByText('Service Velocity & Resolution')).toBeInTheDocument();
    expect(within(row).getByText('Expiring Soon')).toBeInTheDocument();
  });
});
