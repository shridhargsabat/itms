import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewTicketForm from './NewTicketForm';
import { listAssets, listTemplates, listUsers, suggestArticles } from '@/api/client';
import type { UserRecord } from '@/api/types';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(cleanup);
afterEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
});

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    createTicket: vi.fn(),
    listAssets: vi.fn(),
    listTemplates: vi.fn(),
    listUsers: vi.fn(),
    suggestArticles: vi.fn(),
  };
});

// jsdom lacks Element.scrollIntoView (Select.toggle calls it on open).
window.HTMLElement.prototype.scrollIntoView = vi.fn();

function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function setUser(role: string, id = 'u-self') {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id, email: 't@itms.local', name: 'T User', role, department: 'IT' }),
  );
}

function user(over: Partial<UserRecord> & Pick<UserRecord, 'id' | 'name'>): UserRecord {
  return {
    email: `${over.id}@itms.local`,
    role: 'EMPLOYEE',
    department: 'IT',
    active: true,
    created_at: '2026-11-20T10:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(listAssets).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(listTemplates).mockResolvedValue([]);
  vi.mocked(suggestArticles).mockResolvedValue([]);
});

function renderForm() {
  render(
    <QueryClientProvider client={queryClient()}>
      <MemoryRouter initialEntries={['/']}>
        <NewTicketForm onDone={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NewTicketForm requester picker offers only active users (CT-03, issue 157)', () => {
  it('excludes inactive users the backend would 422', async () => {
    setUser('ADMIN');
    vi.mocked(listUsers).mockResolvedValue({
      items: [user({ id: 'u-active', name: 'Active Ana' }), user({ id: 'u-inactive', name: 'Inactive Ian', active: false })],
      total: 2,
    });
    renderForm();

    fireEvent.click(await screen.findByRole('button', { name: 'Requester' }));

    expect(await screen.findByRole('option', { name: /Active Ana/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Inactive Ian/ })).not.toBeInTheDocument();
  });

  it('hides the (You) fallback when the page knows self as inactive', async () => {
    setUser('ADMIN', 'u-self');
    vi.mocked(listUsers).mockResolvedValue({
      items: [
        user({ id: 'u-self', name: 'T User', active: false }),
        user({ id: 'u-active', name: 'Active Ana' }),
      ],
      total: 2,
    });
    renderForm();

    fireEvent.click(await screen.findByRole('button', { name: 'Requester' }));

    expect(await screen.findByRole('option', { name: /Active Ana/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /\(You\)/ })).not.toBeInTheDocument();
  });

  it('keeps the (You) fallback when self is missing from the page', async () => {
    setUser('ADMIN', 'u-self');
    vi.mocked(listUsers).mockResolvedValue({
      items: [user({ id: 'u-active', name: 'Active Ana' })],
      total: 1,
    });
    renderForm();

    fireEvent.click(await screen.findByRole('button', { name: 'Requester' }));

    expect(await screen.findByRole('option', { name: /T User \(You\)/ })).toBeInTheDocument();
  });
});
