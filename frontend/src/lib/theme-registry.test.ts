import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, THEME_REGISTRY, skinForTheme, type ThemeMode } from './theme-registry';

const TEN: ThemeMode[] = ['light','dark','ledgerly','ledgerly-light','system','paper','console','bold','shell','terminal'];
describe('theme registry', () => {
  it('covers exactly 10 modes with default paper', () => {
    expect(Object.keys(THEME_REGISTRY).sort()).toEqual([...TEN].sort());
    expect(DEFAULT_THEME).toBe('paper');
  });
  it('maps dark families correctly', () => {
    expect(THEME_REGISTRY.console.dark).toBe(true);
    expect(THEME_REGISTRY.bold.dark).toBe(true);
    expect(THEME_REGISTRY.terminal.dark).toBe(true);
    expect(THEME_REGISTRY.paper.dark).toBe(false);
    expect(THEME_REGISTRY.shell.dark).toBe(false);
    expect(THEME_REGISTRY.console.classes).toContain('.dark'.slice(1));
  });
  it('pins PWA theme colors', () => {
    expect(THEME_REGISTRY.paper.themeColor).toBe('#f6f5f1');
    expect(THEME_REGISTRY.console.themeColor).toBe('#09090b');
    expect(THEME_REGISTRY.bold.themeColor).toBe('#0d0716');
    expect(THEME_REGISTRY.shell.themeColor).toBe('#ffffff');
    expect(THEME_REGISTRY.terminal.themeColor).toBe('#0a0f0d');
  });
  it('routes skins: new modes to own skin, legacy to legacy', () => {
    expect(skinForTheme('paper')).toBe('paper');
    expect(skinForTheme('terminal')).toBe('terminal');
    expect(skinForTheme('light')).toBe('legacy');
    expect(skinForTheme('ledgerly')).toBe('legacy');
    expect(skinForTheme('system')).toBe('legacy');
  });
});
