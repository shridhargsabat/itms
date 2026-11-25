import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import KnowledgeBase from './KnowledgeBase';
import * as api from '@/api/client';
import type { CannedResponse, KbArticle } from '@/api/types';

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
    listKbArticles: vi.fn(),
    listCanned: vi.fn(),
    createKbArticle: vi.fn(),
    updateKbArticle: vi.fn(),
    createCanned: vi.fn(),
    deleteKbArticle: vi.fn(),
    deleteCanned: vi.fn(),
  };
});

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderKb() {
  render(
    <QueryClientProvider client={makeQc()}>
      <MemoryRouter initialEntries={['/kb']}>
        <KnowledgeBase />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u-admin', email: 'admin@itms.local', name: 'IT Admin', role: 'ADMIN', department: 'IT' }),
  );
  vi.mocked(api.listKbArticles).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(api.listCanned).mockResolvedValue([]);
});

describe('KnowledgeBase FORM-11/FORM-12C form labels', () => {
  it('exposes article Ticket type, Title and Solution via accessible labels', async () => {
    vi.mocked(api.createKbArticle).mockResolvedValue({} as KbArticle);
    renderKb();

    const newButtons = await screen.findAllByRole('button', { name: /^new article$/i });
    fireEvent.click(newButtons[0]);

    expect(screen.getByLabelText(/ticket type/i)).toBeInTheDocument();
    const title = screen.getByLabelText(/title/i);
    const solution = screen.getByLabelText(/solution/i);
    expect(title).toHaveAttribute('aria-required', 'true');
    expect(solution).toHaveAttribute('aria-required', 'true');

    fireEvent.change(title, { target: { value: 'Fix VPN drops' } });
    fireEvent.change(solution, { target: { value: 'Restart the client, then re-auth.' } });
    fireEvent.click(screen.getByRole('button', { name: /^create article$/i }));

    await waitFor(() => expect(api.createKbArticle).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createKbArticle).mock.calls[0][0]).toEqual(
      expect.objectContaining({ title: 'Fix VPN drops', body: 'Restart the client, then re-auth.', ticket_type: 'INCIDENT' }),
    );
  });

  it('exposes canned Title and Body via accessible labels', async () => {
    vi.mocked(api.createCanned).mockResolvedValue({} as CannedResponse);
    renderKb();

    fireEvent.click(await screen.findByRole('button', { name: /canned responses for agents/i }));
    const newButtons = await screen.findAllByRole('button', { name: /^new canned response$/i });
    fireEvent.click(newButtons[0]);

    const title = screen.getByLabelText(/title/i);
    const body = screen.getByLabelText(/body/i);
    expect(title).toHaveAttribute('aria-required', 'true');
    expect(body).toHaveAttribute('aria-required', 'true');

    fireEvent.change(title, { target: { value: 'Password reset steps' } });
    fireEvent.change(body, { target: { value: 'Use the self-service portal…' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.createCanned).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createCanned).mock.calls[0][0]).toEqual(
      expect.objectContaining({ title: 'Password reset steps', body: 'Use the self-service portal…' }),
    );
  });
});
