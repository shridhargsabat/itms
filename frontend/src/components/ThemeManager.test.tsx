import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
