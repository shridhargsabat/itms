import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME_REGISTRY, type ThemeMode } from './theme-registry';

describe('fouc parity', () => {
  // NOTE: resolved via fileURLToPath (not `new URL(..., import.meta.url)`)
  // because Vite rewrites that pattern as a bundled-asset import.
  const html = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html'),
    'utf8',
  );
  it('defaults to paper and maps every slug to its classes', () => {
    expect(html).toContain(`|| 'paper'`);
    (Object.keys(THEME_REGISTRY) as ThemeMode[]).forEach((m) => {
      if (m === 'light' || m === 'system') return; // default branch covers these
      expect(html).toContain(`'${m}'`);
    });
    expect(html).toContain(`'theme-console'`);
    expect(html).toContain(`'theme-terminal'`);
  });
});
