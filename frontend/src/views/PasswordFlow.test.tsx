import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PasswordFlow from './PasswordFlow';
import * as api from '@/api/client';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
  };
});

function renderAt(path: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <PasswordFlow />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PasswordFlow submit validation (FORM-02)', () => {
  it('forgot-password empty submit shows an inline error, never silent', async () => {
    renderAt('/forgot-password');
    fireEvent.click(await screen.findByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText('Email is required')).toHaveRole('alert');
    expect(api.forgotPassword).not.toHaveBeenCalled();
    expect(document.getElementById('forgot-email')).toHaveFocus();
  });

  it('forgot-password invalid email shows a format error', async () => {
    renderAt('/forgot-password');
    fireEvent.change(await screen.findByLabelText(/email/i), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(api.forgotPassword).not.toHaveBeenCalled();
  });

  it('forgot-password valid submit sends the trimmed email', async () => {
    vi.mocked(api.forgotPassword).mockResolvedValue({ ok: true });
    renderAt('/forgot-password');
    fireEvent.change(await screen.findByLabelText(/email/i), { target: { value: '  priya@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => expect(api.forgotPassword).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.forgotPassword).mock.calls[0][0]).toBe('priya@example.com');
  });

  it('reset-password empty submit shows per-field errors and focuses the first field', async () => {
    renderAt('/reset-password?token=tok123');
    fireEvent.click(await screen.findByRole('button', { name: /update password/i }));

    expect(await screen.findByText('New password is required')).toHaveRole('alert');
    expect(screen.getByText('Please confirm your new password.')).toBeInTheDocument();
    expect(api.resetPassword).not.toHaveBeenCalled();
    expect(document.getElementById('reset-pw')).toHaveFocus();
  });

  it('reset-password short and mismatched passwords show inline errors', async () => {
    renderAt('/reset-password?token=tok123');
    fireEvent.change(await screen.findByLabelText(/^new password/i), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));
    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(api.resetPassword).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'password124' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it('reset-password valid submit sends token and new password', async () => {
    vi.mocked(api.resetPassword).mockResolvedValue({ ok: true });
    renderAt('/reset-password?token=tok123');
    fireEvent.change(await screen.findByLabelText(/^new password/i), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => expect(api.resetPassword).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.resetPassword).mock.calls[0][0]).toEqual({
      token: 'tok123',
      new_password: 'password123',
    });
  });
});
