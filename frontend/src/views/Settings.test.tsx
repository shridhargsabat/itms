import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Settings from './Settings';
import type { OAuthConfig } from '@/api/types';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly:
// with several tests per file one render would otherwise leak into the next.
afterEach(cleanup);
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const OAUTH_CFG: OAuthConfig = {
  provider: 'google',
  enabled: false,
  client_id: '',
  has_secret: false,
  allowed_domains: [],
};

// Live queries stubbed; getCachedUser stays real (localStorage-backed).
vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getOAuthAdmin: () => Promise.resolve(OAUTH_CFG),
    updateOAuthAdmin: () => Promise.resolve(OAUTH_CFG),
  };
});

function renderSettings() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/settings']}>
        <Settings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Settings OAuth (task 8)', () => {
  it('masks the oauth client secret with a show/hide toggle', async () => {
    renderSettings();
    const secret = await screen.findByLabelText(/oauth client secret/i);
    expect(secret).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: /show secret/i }));
    expect(secret).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: /hide secret/i }));
    expect(secret).toHaveAttribute('type', 'password');
  });

  it('copies the authorized redirect uri with confirmation', async () => {
    renderSettings();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    fireEvent.click(await screen.findByRole('button', { name: /copy.*redirect/i }));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/oauth/callback'),
    );
    expect(await screen.findByText(/copied/i)).toBeInTheDocument();
  });

  it('uses a generic allowed-domains placeholder', async () => {
    renderSettings();
    const input = await screen.findByLabelText(/allowed domains/i);
    expect(input).toHaveAttribute(
      'placeholder',
      expect.not.stringContaining('sonalapparels.in'),
    );
    expect(input).toHaveAttribute('placeholder', 'example.com');
  });
});
