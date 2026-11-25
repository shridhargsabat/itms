// views/Login.test.tsx — Task 18 (UI-18): login polish.
// Default theme ('light') renders the Legacy skin, so these pin the Legacy card.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Login from './Login';
import { login } from '@/api/client';

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getOAuthStatus: () => Promise.resolve({ enabled: false, client_id_set: false }),
    login: vi.fn(),
  };
});

const mockLogin = vi.mocked(login);

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

const renderLogin = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('login polish (task 18)', () => {
  it('login password has a show/hide toggle', async () => {
    renderLogin();
    // Exact: the toggle itself is labelled "Show password", so /password/i is ambiguous.
    const pw = await screen.findByLabelText(/^password$/i);
    expect(pw).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(pw).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: /hide password/i }));
    expect(pw).toHaveAttribute('type', 'password');
  });

  it('auth errors render sentence case with an alert icon', async () => {
    mockLogin.mockRejectedValueOnce(new Error('invalid_credentials'));
    renderLogin();
    fireEvent.change(await screen.findByLabelText(/email/i), { target: { value: 'a@b.c' } });
    fireEvent.change(await screen.findByLabelText(/^password$/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid email or password.');
    expect(alert.querySelector('svg')).not.toBeNull();
  });

  it('login card exposes no internal auth details', async () => {
    renderLogin();
    expect((await screen.findByText(/sign in/i)).closest('div')!.innerHTML).not.toMatch(/argon2|build/i);
  });
});
