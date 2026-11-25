import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, exchangeOAuthCode, me, setThemePref } from '@/api/client';
import { getThemeMode, markLoginThemeChoice, setThemeModeLocal } from '@/lib/theme';
import OAuthCallback from './OAuthCallback';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(cleanup);
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.className = '';
});

vi.mock('@/api/client', () => ({
  clearSession: vi.fn(() => Promise.resolve()),
  exchangeOAuthCode: vi.fn(),
  me: vi.fn(),
  setSession: vi.fn(),
  setThemePref: vi.fn(() => Promise.resolve({ ok: true })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/oauth/callback" element={<OAuthCallback />} />
        <Route path="/" element={<div>home</div>} />
        <Route path="/login" element={<div>login</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Task 16 fix round 1: the SSO callback must strip ?code= WITHOUT mounting
 * '/' first — mounting would mount RequireAuth, whose /auth/me hydrate races
 * the theme sync and can clobber (or re-push) a stale server pref over an
 * explicit login-screen choice. Ordering, all without an IdP:
 * exchange -> replaceState (strip) -> me -> push/hydrate -> navigate('/').
 */
describe('OAuthCallback theme sequencing', () => {
  it('strips ?code= via replaceState, pushes the login choice, then mounts /', async () => {
    setThemeModeLocal('dark');
    markLoginThemeChoice();
    vi.mocked(exchangeOAuthCode).mockResolvedValue({ token: 'tok', user: { theme: 'light' } } as never);
    vi.mocked(me).mockResolvedValue({ theme: 'light' } as never); // stale server pref
    const replaceSpy = vi.spyOn(window.history, 'replaceState');

    try {
      renderAt('/oauth/callback?code=single-use');
      expect(await screen.findByText('home')).toBeInTheDocument();

      // Code stripped synchronously from the same history entry (no ?code= left).
      expect(replaceSpy).toHaveBeenCalledWith(null, '', '/oauth/callback');
      // Login choice won: local kept + pushed up (stale 'light' NOT pushed).
      expect(vi.mocked(setThemePref)).toHaveBeenCalledWith('dark');
      expect(vi.mocked(setThemePref)).toHaveBeenCalledTimes(1);
      expect(getThemeMode()).toBe('dark');
      expect(localStorage.getItem('itms_theme')).toBe('dark');
      // Ordering: strip happened before the push (navigate last is proven by
      // 'home' rendering only after the awaited chain completed).
      const stripOrder = replaceSpy.mock.invocationCallOrder[0];
      const pushOrder = vi.mocked(setThemePref).mock.invocationCallOrder[0];
      expect(stripOrder).toBeLessThan(pushOrder);
      // Single-use code redeemed exactly once.
      expect(vi.mocked(exchangeOAuthCode)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(exchangeOAuthCode)).toHaveBeenCalledWith('single-use');
    } finally {
      replaceSpy.mockRestore();
    }
  });

  it('server pref still wins when no login choice was made', async () => {
    setThemeModeLocal('dark'); // stale local cache, no explicit choice
    vi.mocked(exchangeOAuthCode).mockResolvedValue({ token: 'tok', user: { theme: 'paper' } } as never);
    vi.mocked(me).mockResolvedValue({ theme: 'paper' } as never);

    renderAt('/oauth/callback?code=abc');
    expect(await screen.findByText('home')).toBeInTheDocument();

    expect(getThemeMode()).toBe('paper');
    expect(vi.mocked(setThemePref)).not.toHaveBeenCalled();
  });

  it('missing ?code= clears the session and bounces to login with sso_failed', async () => {
    renderAt('/oauth/callback');
    expect(await screen.findByText('login')).toBeInTheDocument();
    expect(vi.mocked(clearSession)).toHaveBeenCalled();
    expect(vi.mocked(exchangeOAuthCode)).not.toHaveBeenCalled();
  });
});
