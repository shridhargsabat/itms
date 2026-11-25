import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setThemePref } from '@/api/client';
import {
  consumeLoginThemeChoice,
  getThemeMode,
  hydrateThemeFromUser,
  markLoginThemeChoice,
  setThemeModeLocal,
  syncThemeAfterLogin,
} from '@/lib/theme';

vi.mock('@/api/client', () => ({ setThemePref: vi.fn(() => Promise.resolve({ ok: true })) }));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.className = '';
  vi.mocked(setThemePref).mockClear();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.className = '';
});

/**
 * Task 16 (UI-15): the theme picked on /login must survive authentication —
 * the dashboard must boot in the chosen theme with no flash back to the
 * default. Adapted from the brief's sketch to the real theme.ts API
 * (setThemeModeLocal / getThemeMode + the login-choice handshake).
 */
describe('login theme persistence', () => {
  it('dashboard initializes with the theme chosen on login', async () => {
    setThemeModeLocal('dark'); // as LoginThemeMenu would
    markLoginThemeChoice();
    // as login success would (server still holds the stale never-chosen default)
    await syncThemeAfterLogin({ theme: 'light' });
    expect(getThemeMode()).toBe('dark'); // as app boot would read
    // ...and the choice is pushed up so it sticks across devices/reloads
    expect(vi.mocked(setThemePref)).toHaveBeenCalledWith('dark');
  });

  it('server pref still wins when no theme was chosen on login', async () => {
    setThemeModeLocal('dark'); // stale local cache, no explicit login choice
    await syncThemeAfterLogin({ theme: 'paper' });
    expect(getThemeMode()).toBe('paper');
    expect(vi.mocked(setThemePref)).not.toHaveBeenCalled();
  });

  it('persists through the existing itms_theme key only (no second key)', () => {
    setThemeModeLocal('terminal');
    expect(localStorage.getItem('itms_theme')).toBe('terminal');
    expect(getThemeMode()).toBe('terminal');
    const themeKeys = Object.keys(localStorage).filter((k) => k.toLowerCase().includes('theme'));
    expect(themeKeys).toEqual(['itms_theme']);
  });

  it('login choice is single-shot: consumed exactly once', () => {
    expect(consumeLoginThemeChoice()).toBe(false);
    markLoginThemeChoice();
    expect(consumeLoginThemeChoice()).toBe(true);
    expect(consumeLoginThemeChoice()).toBe(false);
  });

  it('pre-auth theme selection performs no network call', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    try {
      setThemeModeLocal('dark');
      markLoginThemeChoice();
      expect(consumeLoginThemeChoice()).toBe(true);
      expect(spy).not.toHaveBeenCalled();
      expect(vi.mocked(setThemePref)).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('hydrateThemeFromUser keeps its server-wins semantics (cross-device sync)', () => {
    setThemeModeLocal('dark');
    hydrateThemeFromUser({ theme: 'console' });
    expect(getThemeMode()).toBe('console');
  });
});
