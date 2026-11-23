import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, THEME_REGISTRY, skinForTheme, type ThemeMode } from './theme-registry';

const TEN: ThemeMode[] = ['light','dark','ledgerly','ledgerly-light','system','paper','console','bold','shell','terminal','clarity','clarity-dark'];
describe('theme registry', () => {
  it('covers exactly 12 modes with default light', () => {
    expect(Object.keys(THEME_REGISTRY).sort()).toEqual([...TEN].sort());
    expect(DEFAULT_THEME).toBe('light');
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
    expect(skinForTheme('clarity')).toBe('clarity');
    expect(skinForTheme('clarity-dark')).toBe('clarity');
    expect(skinForTheme('light')).toBe('legacy');
    expect(skinForTheme('ledgerly')).toBe('legacy');
    expect(skinForTheme('system')).toBe('legacy');
  });
  it('registers Clarity light and dark modes', () => {
    const light = THEME_REGISTRY.clarity;
    expect(light.label).toBe('Clarity');
    expect(light.group).toBe('new');
    expect(light.dark).toBe(false);
    expect(light.classes).toEqual(['theme-clarity']);
    expect(light.themeColor).toBe('#f6f7f9');
    expect(light.skin).toBe('clarity');
    expect(light.glass).toBe(false);
    const dark = THEME_REGISTRY['clarity-dark'];
    expect(dark.label).toBe('Clarity Dark');
    expect(dark.group).toBe('new');
    expect(dark.dark).toBe(true);
    expect(dark.classes).toEqual(['dark', 'theme-clarity-dark']);
    expect(dark.themeColor).toBe('#0b0d10');
    expect(dark.skin).toBe('clarity');
    expect(dark.glass).toBe(false);
  });
});
