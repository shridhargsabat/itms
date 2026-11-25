import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Account from './Account';
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
    changePassword: vi.fn(),
  };
});

beforeEach(() => {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u-1', email: 'emp@itms.local', name: 'Emp', role: 'EMPLOYEE', department: 'IT' }),
  );
});

function renderAccount() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Account />
    </QueryClientProvider>,
  );
}

function setInput(id: string, value: string) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing input #${id}`);
  fireEvent.change(el, { target: { value } });
}

describe('Account submit validation (FORM-02)', () => {
  it('empty submit shows per-field inline errors, blocks changePassword, and focuses the first field', async () => {
    renderAccount();
    fireEvent.click(await screen.findByRole('button', { name: /^change password$/i }));

    expect(await screen.findByText('Current password is required')).toHaveRole('alert');
    expect(screen.getByText('New password is required')).toBeInTheDocument();
    expect(screen.getByText('Please confirm your new password.')).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();
    expect(document.getElementById('account-current')).toHaveFocus();
  });

  it('short new password shows a length error and focuses the new-password field', async () => {
    renderAccount();
    await screen.findByRole('button', { name: /^change password$/i });
    setInput('account-current', 'oldpassword');
    setInput('account-new', 'short');
    setInput('account-confirm', 'short');
    fireEvent.click(screen.getByRole('button', { name: /^change password$/i }));

    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();
    expect(document.getElementById('account-new')).toHaveFocus();
  });

  it('confirm mismatch renders as a live FieldError alert while typing', async () => {
    renderAccount();
    await screen.findByRole('button', { name: /^change password$/i });
    setInput('account-new', 'password123');
    setInput('account-confirm', 'password12');

    expect(await screen.findByText('Passwords do not match.')).toHaveRole('alert');
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it('valid submit sends current and new passwords via changePassword', async () => {
    vi.mocked(api.changePassword).mockResolvedValue({ ok: true });
    renderAccount();
    await screen.findByRole('button', { name: /^change password$/i });
    setInput('account-current', 'oldpassword');
    setInput('account-new', 'password123');
    setInput('account-confirm', 'password123');
    fireEvent.click(screen.getByRole('button', { name: /^change password$/i }));

    await waitFor(() => expect(api.changePassword).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.changePassword).mock.calls[0][0]).toEqual({
      current_password: 'oldpassword',
      new_password: 'password123',
    });
  });
});
