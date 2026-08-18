/**
 * Theme manager: light / dark / ledgerly / system (default system).
 *
 * Two sources, one goal:
 * - localStorage ('itms_theme') is the fast-path cache — FOUC script +
 *   first paint read it synchronously, offline works.
 * - The backend user pref (`users.theme`, PUT /auth/theme) is the source of
 *   truth across devices. Every login / /auth/me hydrates the local cache
 *   from the server value (server wins), and every local change pushes up
 *   best-effort (fire-and-forget; next login re-syncs anyway).
 *
 * `@custom-variant dark` in index.css keys off `.dark`; `.ledgerly-dark`
 * (later in the file) overrides the tokens with the Ledgerly palette.
 */
import { setThemePref } from '@/api/client';

export type ThemeMode = 'light' | 'dark' | 'ledgerly' | 'system';

const KEY = 'itms_theme';
const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

const THEMES: ThemeMode[] = ['light', 'dark', 'ledgerly', 'system'];

export function isThemeMode(v: unknown): v is ThemeMode {
  return typeof v === 'string' && (THEMES as string[]).includes(v);
}

export function getThemeMode(): ThemeMode {
  const v = localStorage.getItem(KEY);
  return isThemeMode(v) ? v : 'system';
}

export function getResolvedTheme(): 'light' | 'dark' | 'ledgerly' {
  const mode = getThemeMode();
  if (mode === 'ledgerly') return 'ledgerly';
  return mode === 'system' ? (mq().matches ? 'dark' : 'light') : mode;
}

export function applyTheme(mode?: ThemeMode) {
  const resolved = getResolvedTheme();
  const root = document.documentElement;
  // `.dark` keeps the @custom-variant dark: utilities live; `.ledgerly-dark`
  // (later in index.css) overrides every --t-* token with the Ledgerly palette.
  root.classList.toggle('dark', resolved !== 'light');
  root.classList.toggle('ledgerly-dark', resolved === 'ledgerly');
  // meta theme-color follows the resolved theme (PWA chrome)
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute(
      'content',
      resolved === 'light' ? '#ffffff' : resolved === 'ledgerly' ? '#141311' : '#020617',
    );
  }
  void mode;
}

/** Apply immediately + persist locally + push to the server (best-effort). */
export function setThemeMode(mode: ThemeMode) {
  localStorage.setItem(KEY, mode);
  applyTheme(mode);
  window.dispatchEvent(new Event(THEME_CHANGED));
  // Fire-and-forget: failing here is fine — the next login re-syncs.
  // (apiFetch's 401 path redirects to /login, which is correct when the
  // session really is dead; network failures just no-op.)
  void setThemePref(mode).catch(() => {});
}

/**
 * Server → local hydration. Called after login / /auth/me / SSO: the per-user
 * pref is authoritative on every device, so it overrides the local cache.
 * Unknown/absent values fall back to 'system' (never trusts client input).
 */
export function hydrateThemeFromUser(user?: { theme?: string } | null) {
  const v = user?.theme;
  const mode = isThemeMode(v) ? v : 'system';
  if (localStorage.getItem(KEY) !== mode) {
    localStorage.setItem(KEY, mode);
    applyTheme(mode);
    window.dispatchEvent(new Event(THEME_CHANGED));
  }
}

const THEME_CHANGED = 'itms-theme-changed';

/** Re-read whenever the theme changes from anywhere (toggle or server sync). */
export function onThemeChanged(cb: () => void): () => void {
  window.addEventListener(THEME_CHANGED, cb);
  return () => window.removeEventListener(THEME_CHANGED, cb);
}

let systemListener: ((e: MediaQueryListEvent) => void) | null = null;

/** Follow the device when in 'system' mode; idempotent. */
export function watchSystemTheme() {
  if (systemListener) return;
  systemListener = () => {
    if (getThemeMode() === 'system') applyTheme('system');
  };
  mq().addEventListener('change', systemListener);
}