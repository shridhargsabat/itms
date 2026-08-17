/**
 * Theme: light / dark / ledgerly / system (default system).
 * Stores the choice in localStorage ('itms_theme') and applies `.dark` on
 * <html> (Tailwind v4 @custom-variant) plus `.ledgerly-dark` for the
 * Ledgerly warm-paper palette (exact copy of ledgerly.ai-automation-hub.tech
 * dark theme). 'system' follows prefers-color-scheme live (matchMedia listener).
 */
export type ThemeMode = 'light' | 'dark' | 'ledgerly' | 'system';

const KEY = 'itms_theme';
const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

export function getThemeMode(): ThemeMode {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' || v === 'ledgerly' || v === 'system' ? v : 'system';
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

export function setThemeMode(mode: ThemeMode) {
  localStorage.setItem(KEY, mode);
  applyTheme(mode);
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