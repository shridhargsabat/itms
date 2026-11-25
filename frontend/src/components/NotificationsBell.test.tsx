import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationsBell from './NotificationsBell';
import type { Notification } from '@/api/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const { mockUnread, mockList } = vi.hoisted(() => ({
  mockUnread: vi.fn(),
  mockList: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getUnreadCount: (...args: unknown[]) => mockUnread(...args),
    getNotifications: (...args: unknown[]) => mockList(...args),
    markNotificationRead: () => Promise.resolve(),
    markAllNotificationsRead: () => Promise.resolve(),
  };
});

const SAMPLE: Notification = {
  id: 'n1',
  user_id: 'u1',
  kind: 'TICKET_ASSIGNED',
  title: 'Ticket assigned to you',
  body: 'TKT-1001 VPN connection drops',
  ref_type: 'ticket',
  ref_id: 't1',
  read_at: null,
  created_at: '2026-01-15T00:00:00Z',
};

function qc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function BellHarness() {
  return (
    <QueryClientProvider client={qc()}>
      <MemoryRouter>
        <NotificationsBell />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockUnread.mockResolvedValue({ unread: 1 });
  mockList.mockResolvedValue({ items: [SAMPLE], total: 1 });
});

describe('NotificationsBell popover (UI-06, UI-10 bell ARIA)', () => {
  it('renders unread notifications inside the popover', async () => {
    render(<BellHarness />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(await screen.findByText('Ticket assigned to you')).toBeInTheDocument();
  });

  it('shows an explicit empty state and no stale badge when count is 0', async () => {
    mockUnread.mockResolvedValue({ unread: 0 });
    mockList.mockResolvedValue({ items: [], total: 0 });
    render(<BellHarness />);
    expect(screen.queryByText('1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(await screen.findByText(/no new notifications/i)).toBeInTheDocument();
  });

  it('bell exposes expanded state and unread count', async () => {
    render(<BellHarness />);
    const bell = await screen.findByRole('button', { name: /notifications \(1 unread\)/i });
    expect(bell).toHaveAttribute('aria-expanded', 'false');
    expect(bell).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('shows an error state with retry when loading fails', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    render(<BellHarness />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(await screen.findByText(/couldn't load notifications/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
