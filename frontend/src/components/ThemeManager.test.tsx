import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES } from './ThemeManager';
import { THEME_REGISTRY, type ThemeMode } from '@/lib/theme-registry';

describe('theme manager preview chip', () => {
  // NOTE: resolved via fileURLToPath (not `new URL(..., import.meta.url)`)
  // because Vite rewrites that pattern as a bundled-asset import.
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'ThemeManager.tsx'),
    'utf8',
  );
  it('renders the check chip ink from var(--t-on-accent), never hardcoded white', () => {
    // The chip sits on var(--t-accent): hardcoded #ffffff is unreadable on
    // bold lime / terminal green / console emerald.
    expect(src).toContain('var(--t-on-accent)');
    expect(src).not.toMatch(/color:\s*'#ffffff'/);
  });
});

describe('theme manager entries', () => {
  it('covers every registry mode exactly once (all 12)', () => {
    const values = THEMES.map((t) => t.value).sort();
    const registry = (Object.keys(THEME_REGISTRY) as ThemeMode[]).sort();
    expect(registry).toHaveLength(12);
    expect(values).toEqual(registry);
  });
  it('previews clarity with opaque wrapper classes and no glass', () => {
    const light = THEMES.find((t) => t.value === 'clarity')!;
    const dark = THEMES.find((t) => t.value === 'clarity-dark')!;
    expect(light.wrapperClass).toBe('theme-clarity');
    expect(light.glass).toBe(false);
    expect(dark.wrapperClass).toBe('dark theme-clarity-dark');
    expect(dark.glass).toBe(false);
  });
});
