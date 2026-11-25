import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ClarityLogin from './ClarityLogin';

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return { ...mod, getOAuthStatus: () => Promise.resolve({ enabled: true, client_id_set: true }) };
});

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ClarityLogin />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('clarity login skin', () => {
  it('carries every auth path', async () => {
    wrap();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    // Exact: the show/hide toggle is also labelled "... password".
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute('type', 'submit');
    expect(screen.getByRole('button', { name: 'Use demo account' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /forgot/i })).toBeInTheDocument();
    const oauth = await screen.findByRole('link', { name: /google/i });
    expect(oauth).toHaveAttribute('href', '/api/v1/auth/oauth/start');
  });

  it('renders no glass surface or animated background', () => {
    const { container } = wrap();
    expect(container.querySelector('.glass-card')).toBeNull();
    expect(container.querySelector('.ab-mesh, .ab-blobs, .ab-particles')).toBeNull();
  });

  it('exposes no internal auth details on the public card', () => {
    const { container } = wrap();
    expect(container.textContent).not.toMatch(/argon2/i);
  });
});
