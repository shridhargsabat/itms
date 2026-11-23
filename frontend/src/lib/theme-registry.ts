/**
 * Theme registry: single source of truth for all 12 theme modes.
 *
 * Consumed by Tasks 2, 6, 12, 13. Legacy entries (group 'classic') copy
 * labels verbatim from ThemeManager.tsx and theme colors from theme.ts —
 * legacy theme code is never restyled, only extended.
 */

export type ThemeMode =
  | 'light'
  | 'dark'
  | 'ledgerly'
  | 'ledgerly-light'
  | 'system'
  | 'paper'
  | 'console'
  | 'bold'
  | 'shell'
  | 'terminal'
  | 'clarity'
  | 'clarity-dark';

export type SkinName = 'legacy' | 'paper' | 'console' | 'bold' | 'shell' | 'terminal' | 'clarity';

export interface ThemeMeta {
  value: ThemeMode;
  label: string;
  group: 'new' | 'classic';
  dark: boolean;
  classes: string[];
  themeColor: string;
  skin: SkinName;
  glass: boolean;
}

export const DEFAULT_THEME: ThemeMode = 'light';

export const THEME_REGISTRY: Record<ThemeMode, ThemeMeta> = {
  light: {
    value: 'light',
    label: 'Liquid Glass Light',
    group: 'classic',
    dark: false,
    classes: [],
    themeColor: '#ffffff',
    skin: 'legacy',
    glass: true,
  },
  dark: {
    value: 'dark',
    label: 'Liquid Glass Dark',
    group: 'classic',
    dark: true,
    classes: ['dark'],
    themeColor: '#020617',
    skin: 'legacy',
    glass: true,
  },
  system: {
    value: 'system',
    label: 'Liquid Glass (Auto)',
    group: 'classic',
    dark: false,
    classes: [],
    themeColor: '#ffffff',
    skin: 'legacy',
    glass: true,
  },
  'ledgerly-light': {
    value: 'ledgerly-light',
    label: 'Ledgerly Light',
    group: 'classic',
    dark: false,
    classes: ['ledgerly-light'],
    themeColor: '#f6f5f1',
    skin: 'legacy',
    glass: false,
  },
  ledgerly: {
    value: 'ledgerly',
    label: 'Ledgerly',
    group: 'classic',
    dark: true,
    classes: ['dark', 'ledgerly-dark'],
    themeColor: '#141311',
    skin: 'legacy',
    glass: false,
  },
  paper: {
    value: 'paper',
    label: 'Paper',
    group: 'new',
    dark: false,
    classes: ['theme-paper'],
    themeColor: '#f6f5f1',
    skin: 'paper',
    glass: false,
  },
  console: {
    value: 'console',
    label: 'Console',
    group: 'new',
    dark: true,
    classes: ['dark', 'theme-console'],
    themeColor: '#09090b',
    skin: 'console',
    glass: false,
  },
  bold: {
    value: 'bold',
    label: 'Bold',
    group: 'new',
    dark: true,
    classes: ['dark', 'theme-bold'],
    themeColor: '#0d0716',
    skin: 'bold',
    glass: false,
  },
  shell: {
    value: 'shell',
    label: 'Shell',
    group: 'new',
    dark: false,
    classes: ['theme-shell'],
    themeColor: '#ffffff',
    skin: 'shell',
    glass: false,
  },
  terminal: {
    value: 'terminal',
    label: 'Terminal',
    group: 'new',
    dark: true,
    classes: ['dark', 'theme-terminal'],
    themeColor: '#0a0f0d',
    skin: 'terminal',
    glass: false,
  },
  clarity: {
    value: 'clarity',
    label: 'Clarity',
    group: 'new',
    dark: false,
    classes: ['theme-clarity'],
    themeColor: '#f6f7f9',
    skin: 'clarity',
    glass: false,
  },
  'clarity-dark': {
    value: 'clarity-dark',
    label: 'Clarity Dark',
    group: 'new',
    dark: true,
    classes: ['dark', 'theme-clarity-dark'],
    themeColor: '#0b0d10',
    skin: 'clarity',
    glass: false,
  },
};

/** New modes route to their own login skin; legacy modes share the legacy skin. */
export function skinForTheme(mode: ThemeMode): SkinName {
  return THEME_REGISTRY[mode].skin;
}
