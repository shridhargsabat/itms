import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('liquid glass tokens (task 3)', () => {
  // NOTE: fileURLToPath resolution (not `new URL(..., import.meta.url)`)
  // because Vite rewrites that pattern as a bundled-asset import.
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), './index.css'),
    'utf8',
  );
  const CLASSES = [
    'liquid-glass-panel',
    'liquid-glass-subcard',
    'liquid-glass-pill',
    'liquid-glass-btn-primary',
  ];
  // Guard chains copied verbatim from the refraction selectors in index.css.
  const LIGHT_GUARD =
    ':root:not(.dark):not(.theme-paper):not(.theme-console):not(.theme-bold):not(.theme-shell):not(.theme-terminal):not(.theme-clarity):not(.theme-clarity-dark):not(.ledgerly-dark):not(.ledgerly-light)';
  const DARK_GUARD =
    '.dark:not(.theme-console):not(.theme-bold):not(.theme-terminal):not(.theme-clarity):not(.theme-clarity-dark):not(.ledgerly-dark)';
  const FALLBACK_SCOPES = [
    '.theme-paper',
    '.theme-console',
    '.theme-bold',
    '.theme-shell',
    '.theme-terminal',
    '.theme-clarity',
    '.theme-clarity-dark',
    '.ledgerly-dark',
    '.ledgerly-light',
  ];

  /** Extract every `@media <query> { ... }` block (brace-matched). */
  function mediaBlocks(src: string, query: string): string[] {
    const blocks: string[] = [];
    const marker = `@media ${query}`;
    let idx = src.indexOf(marker);
    while (idx !== -1) {
      const open = src.indexOf('{', idx);
      let depth = 0;
      for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
          depth--;
          if (depth === 0) {
            blocks.push(src.slice(open, i + 1));
            break;
          }
        }
      }
      idx = src.indexOf(marker, idx + marker.length);
    }
    return blocks;
  }

  it('defines the four liquid-glass classes', () => {
    CLASSES.forEach((c) => expect(css).toContain(`.${c}`));
  });

  it('scopes day rules under the light guard chain', () => {
    expect(css).toContain(`${LIGHT_GUARD} .liquid-glass-panel`);
    expect(css).toContain(`${LIGHT_GUARD} .liquid-glass-subcard`);
    expect(css).toContain(`${LIGHT_GUARD} .liquid-glass-pill`);
  });

  it('scopes night rules under the dark guard chain', () => {
    expect(css).toContain(`${DARK_GUARD} .liquid-glass-panel`);
    expect(css).toContain(`${DARK_GUARD} .liquid-glass-subcard`);
    expect(css).toContain(`${DARK_GUARD} .liquid-glass-pill`);
  });

  it('falls back to token surfaces in all 9 non-glass themes', () => {
    FALLBACK_SCOPES.forEach((s) => {
      expect(css).toContain(`${s} .liquid-glass-panel`);
      expect(css).toContain(`${s} .liquid-glass-btn-primary`);
    });
    expect(css).toContain('background: var(--t-surface)');
    expect(css).toContain('background: var(--t-accent)');
  });

  it('covers all four classes in a prefers-reduced-transparency guard block', () => {
    const blocks = mediaBlocks(css, '(prefers-reduced-transparency: reduce)');
    expect(blocks.length).toBeGreaterThan(0);
    const hit = blocks.some((b) => CLASSES.every((c) => b.includes(`.${c}`)));
    expect(hit).toBe(true);
  });

  it('covers all four classes in a print guard block', () => {
    const blocks = mediaBlocks(css, 'print');
    expect(blocks.length).toBeGreaterThan(0);
    const hit = blocks.some((b) => CLASSES.every((c) => b.includes(`.${c}`)));
    expect(hit).toBe(true);
  });

  it('carries the spec values (radii, panel blur, button gradient)', () => {
    expect(css).toContain('border-radius: 26px');
    expect(css).toContain('border-radius: 20px');
    expect(css).toContain('border-radius: 9999px');
    expect(css).toContain('blur(40px) saturate(160%)');
    expect(css).toContain('#0A84FF');
    expect(css).toContain('#0066D6');
  });
});
