/**
 * Theme: light / dark / system (default system).
 * Stores the choice in localStorage ('itms_theme') and applies `.dark` on
 * <html> (Tailwind v4 @custom-variant). 'system' follows prefers-color-scheme
 * live (matchMedia listener).
 */
export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'itms_theme';
const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

export function getThemeMode(): ThemeMode {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

export function getResolvedTheme(): 'light' | 'dark' {
  const mode = getThemeMode();
  return mode === 'system' ? (mq().matches ? 'dark' : 'light') : mode;
}

export function applyTheme(mode?: ThemeMode) {
  const resolved = getResolvedTheme();
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  // meta theme-color follows the resolved theme (PWA chrome)
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#020617' : '#ffffff');
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
