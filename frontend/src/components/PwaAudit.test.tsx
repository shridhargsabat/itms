import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OfflineBanner from './OfflineBanner';
import Tickets from '@/views/Tickets';
import Assets from '@/views/Assets';
import * as api from '@/api/client';

vi.mock('@/lib/offline', () => ({ useOnline: () => false }));

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    listTickets: vi.fn(),
    getTicket: vi.fn(),
    getTicketTimeline: vi.fn(),
    listCanned: vi.fn(),
    listTemplates: vi.fn(),
    listUsers: vi.fn(),
    listAssets: vi.fn(),
    listLocations: vi.fn(),
    suggestArticles: vi.fn(),
  };
});

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

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const TICKET = {
  id: 't-page1',
  ticket_number: 'INC-1001',
  title: 'Laptop screen flickering',
  description: 'Flickers on battery power',
  ticket_type: 'INCIDENT',
  priority: 'MEDIUM',
  status: 'RESOLVED',
  requester_id: 'u-1',
  requester_name: 'Aarav Gupta',
  assignee_id: null,
  assignee_name: null,
  asset_id: 'a-1',
  asset_tag: 'AST-10014',
  asset_name: 'Lenovo IdeaPad',
  sla_due_at: '2026-11-24T12:00:00Z',
  sla_escalated_at: null,
  created_at: '2026-11-23T10:00:00Z',
  updated_at: '2026-11-23T11:00:00Z',
} as const;

beforeEach(() => {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u-admin', email: 'admin@itms.local', name: 'IT Admin', role: 'ADMIN', department: 'IT' }),
  );
  vi.mocked(api.listTickets).mockResolvedValue({ items: [TICKET as never], total: 1 });
  vi.mocked(api.getTicket).mockResolvedValue(TICKET as never);
  vi.mocked(api.getTicketTimeline).mockResolvedValue({ comments: [], changes: [], attachments: [] } as never);
  vi.mocked(api.listCanned).mockResolvedValue([]);
  vi.mocked(api.listTemplates).mockResolvedValue([]);
  vi.mocked(api.listUsers).mockResolvedValue({ items: [], total: 0 } as never);
  vi.mocked(api.listAssets).mockResolvedValue({ items: [], total: 0 } as never);
  vi.mocked(api.listLocations).mockResolvedValue([]);
  vi.mocked(api.suggestArticles).mockResolvedValue([]);
});

function srcOf(rel: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
}

describe('PWA audit regressions (Bugs #2, #6, #7 · P-102)', () => {
  it('Bug #2: OfflineBanner sits below the 46px mobile top header, never over it', () => {
    render(<OfflineBanner />);
    const banner = screen.getByText(/you're offline/i);
    const tokens = banner.className.split(/\s+/);
    // Mobile (<lg): top edge at 2.875rem (46px) + notch inset => y 46..74px, header stays visible at y 0..46px.
    expect(tokens).toContain('top-[calc(2.875rem+env(safe-area-inset-top))]');
    expect(tokens).toContain('lg:top-0');
    expect(tokens).toContain('fixed');
    expect(tokens).toContain('inset-x-0');
    // Must NOT pin to viewport top on mobile (that covered the logo/bell/theme/sign-out buttons).
    expect(tokens).not.toContain('top-0');
  });

  it('Bug #7: Tickets search input uses the search keyboard', async () => {
    render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter initialEntries={['/tickets']}>
          <Tickets />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const input = await screen.findByPlaceholderText('Search tickets...');
    expect(input.getAttribute('type')).toBe('search');
    expect(input.getAttribute('inputmode')).toBe('search');
  });

  it('Bug #7: Assets search input uses the search keyboard', async () => {
    render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter initialEntries={['/assets']}>
          <Assets />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const input = await screen.findByPlaceholderText('Search assets…');
    expect(input.getAttribute('type')).toBe('search');
    expect(input.getAttribute('inputmode')).toBe('search');
  });

  it('Bug #7: Ticket drawer Close button is 36x36px (h-9 w-9), not 24x24px (p-1)', async () => {
    render(
      <QueryClientProvider client={makeQc()}>
        <MemoryRouter initialEntries={['/tickets?open=t-page1']}>
          <Tickets />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const close = await screen.findByRole('button', { name: 'Close' });
    const tokens = close.className.split(/\s+/);
    expect(tokens).toContain('h-9');
    expect(tokens).toContain('w-9');
    expect(tokens).not.toContain('p-1');
  });

  it('Bug #6: Tickets.tsx has no vw gutter unit (CannedPicker uses 100dvw)', () => {
    const src = srcOf('../views/Tickets.tsx');
    expect(src).not.toContain(['100', 'vw'].join(''));
    expect(src).toContain('max-w-[calc(100dvw-2.5rem)]');
  });

  it('Bug #7 (P-901): Masters search input uses the search keyboard', () => {
    const src = srcOf('../views/Masters.tsx');
    const idx = src.indexOf('Search name or email…');
    expect(idx).toBeGreaterThan(0);
    const head = src.slice(Math.max(0, idx - 300), idx);
    expect(head).toContain('type="search"');
    expect(head).toContain('inputMode="search"');
  });

  it('P-102: OAuthCallback uses min-h-dvh, not min-h-screen', () => {
    const src = srcOf('../views/OAuthCallback.tsx');
    expect(src).toContain('min-h-dvh');
    expect(src).not.toContain('min-h-screen');
  });
});
