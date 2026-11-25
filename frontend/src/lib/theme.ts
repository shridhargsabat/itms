/**
 * Theme manager: delegates to the registry (theme-registry.ts), the single
 * source of truth for all 10 theme modes. Default is paper.
 *
 * Two sources, one goal:
 * - localStorage ('itms_theme') is the fast-path cache — FOUC script +
 *   first paint read it synchronously, offline works.
 * - The backend user pref (`users.theme`, PUT /auth/theme) is the source of
 *   truth across devices. Every login / /auth/me hydrates the local cache
 *   from the server value (server wins), and every local change pushes up
 *   best-effort (fire-and-forget; next login re-syncs anyway).
 *
 * `@custom-variant dark` in index.css keys off `.dark`; the dark-family
 * themes (dark, ledgerly, console, bold, terminal) carry it, the light
 * family (light, ledgerly-light, paper, shell) never does.
 */
import { setThemePref } from '@/api/client';
import { DEFAULT_THEME, THEME_REGISTRY, type ThemeMode } from '@/lib/theme-registry';

export type { ThemeMode } from '@/lib/theme-registry';

const KEY = 'itms_theme';
const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

const THEMES: ThemeMode[] = Object.keys(THEME_REGISTRY) as ThemeMode[];

/** Every class any theme can put on <html> — cleared before each apply. */
const ALL_THEME_CLASSES: string[] = [
  ...new Set(Object.values(THEME_REGISTRY).flatMap((m) => m.classes)),
];

export function isThemeMode(v: unknown): v is ThemeMode {
  return typeof v === 'string' && (THEMES as string[]).includes(v);
}

export function getThemeMode(): ThemeMode {
  const v = localStorage.getItem(KEY);
  return isThemeMode(v) ? v : DEFAULT_THEME;
}

/**
 * Resolved theme: 'system' follows the device (light/dark); every other
 * mode is identity. Never returns 'system', so the registry's static
 * system placeholder is always resolved dynamically at apply time.
 */
export function getResolvedTheme(): Exclude<ThemeMode, 'system'> {
  const mode = getThemeMode();
  if (mode === 'system') return mq().matches ? 'dark' : 'light';
  return mode;
}

export function applyTheme() {
  const resolved = getResolvedTheme();
  const root = document.documentElement;
  // Clear every known theme class, then apply the resolved theme's classes
  // from the registry. `.dark` drives the @custom-variant dark: utilities —
  // it is present ONLY for the dark-family themes.
  root.classList.remove(...ALL_THEME_CLASSES);
  const classes = THEME_REGISTRY[resolved].classes;
  if (classes.length > 0) root.classList.add(...classes);
  // meta theme-color follows the resolved theme (PWA chrome)
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', THEME_REGISTRY[resolved].themeColor);
  }
}

/** Apply immediately + persist locally only (no server push — pre-auth safe). */
export function setThemeModeLocal(mode: ThemeMode) {
  localStorage.setItem('itms_theme', mode);
  applyTheme();
  window.dispatchEvent(new Event('itms-theme-changed'));
}

/** Apply immediately + persist locally + push to the server (best-effort). */
export function setThemeMode(mode: ThemeMode) {
  setThemeModeLocal(mode);
  // Fire-and-forget: failing here is fine — the next login re-syncs.
  // (apiFetch's 401 path redirects to /login, which is correct when the
  // session really is dead; network failures just no-op.)
  void setThemePref(mode).catch(() => {});
}

/**
 * Server → local hydration. Called after login / /auth/me / SSO: the per-user
 * pref is authoritative on every device, so it overrides the local cache.
 * Unknown/absent values fall back to the default (never trusts client input).
 */
export function hydrateThemeFromUser(user?: { theme?: string } | null) {
  const v = user?.theme;
  const mode = isThemeMode(v) ? v : DEFAULT_THEME;
  if (localStorage.getItem(KEY) !== mode) {
    localStorage.setItem(KEY, mode);
    applyTheme();
    window.dispatchEvent(new Event(THEME_CHANGED));
  }
}

const THEME_CHANGED = 'itms-theme-changed';

/**
 * Login-choice handshake (Task 16 / UI-15): the theme a visitor picks on
 * /login must survive authentication. The server column is NOT NULL with a
 * never-explicitly-chosen default, so a plain "server wins" hydrate at login
 * would clobber the login pick back to the default right after auth.
 *
 * LoginThemeMenu.choose() marks the choice; the login-success path consumes
 * it exactly once via syncThemeAfterLogin(), which keeps the local pick and
 * pushes it up (awaited — RequireAuth's /auth/me hydrate then reads the
 * same value back, so there is no flash and no race). When nothing was
 * marked, sync falls through to the plain server-wins hydrate, preserving
 * cross-device sync.
 *
 * sessionStorage (not a module flag): the SSO round-trip reloads the page,
 * which would drop module state; the same-tab session flag survives it.
 * This is a boolean marker only — the theme VALUE still lives solely in
 * the existing `itms_theme` localStorage key.
 */
const LOGIN_CHOICE_KEY = 'itms_theme_login_choice';

export function markLoginThemeChoice(): void {
  try {
    sessionStorage.setItem(LOGIN_CHOICE_KEY, '1');
  } catch {
    /* private-mode: choice just won't survive auth */
  }
}

/** Single-shot: true iff a login choice was marked since the last consume. */
export function consumeLoginThemeChoice(): boolean {
  try {
    const marked = sessionStorage.getItem(LOGIN_CHOICE_KEY) === '1';
    sessionStorage.removeItem(LOGIN_CHOICE_KEY);
    return marked;
  } catch {
    /* private-mode: treat as unmarked */
    return false;
  }
}

/**
 * Login-success theme sync. Returns 'pushed' when an explicit login-screen
 * choice won (local value kept + pushed to the server pref), 'hydrated'
 * when the server pref won (no choice was made).
 */
export async function syncThemeAfterLogin(
  user?: { theme?: string } | null,
): Promise<'pushed' | 'hydrated'> {
  if (consumeLoginThemeChoice()) {
    // Awaited: callers navigate right after, and RequireAuth's /auth/me
    // hydrate must observe the pushed value, not the stale default.
    // Best-effort — a failure here degrades to today's behavior
    // (RequireAuth re-syncs from the server anyway).
    await setThemePref(getThemeMode()).catch(() => {});
    return 'pushed';
  }
  hydrateThemeFromUser(user);
  return 'hydrated';
}

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
    if (getThemeMode() === 'system') applyTheme();
  };
  mq().addEventListener('change', systemListener);
}
