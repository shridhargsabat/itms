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

describe('themed scrollbars (tokens)', () => {
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), './index.css'),
    'utf8',
  );
  const SCOPES = [
    ':root',
    '.dark',
    '.ledgerly-dark',
    '.ledgerly-light',
    '.theme-light',
    '.theme-paper',
    '.theme-console',
    '.theme-bold',
    '.theme-shell',
    '.theme-terminal',
    '.theme-clarity',
    '.theme-clarity-dark',
  ];

  it('defines thumb + hover vars in every theme scope', () => {
    SCOPES.forEach((s) => {
      const re = new RegExp(`${s.replace(/[.:]/g, (c) => `\\${c}`)}\\s*{[^}]*--t-scroll-thumb:`, 's');
      expect(css, `missing --t-scroll-thumb in ${s}`).toMatch(re);
      const reHover = new RegExp(
        `${s.replace(/[.:]/g, (c) => `\\${c}`)}\\s*{[^}]*--t-scroll-thumb-hover:`, 's',
      );
      expect(css, `missing --t-scroll-thumb-hover in ${s}`).toMatch(reHover);
    });
  });

  it('uses translucent glass values for the liquid-glass themes', () => {
    expect(css).toContain('rgb(15 23 42 / 0.28)');
    expect(css).toContain('rgb(15 23 42 / 0.45)');
    expect(css).toContain('rgb(255 255 255 / 0.22)');
    expect(css).toContain('rgb(255 255 255 / 0.38)');
  });

  it('has no early comment terminator in prose (a "*/" inside a comment would swallow the rule after it)', () => {
    // Regression: ".theme-*/" in a comment once closed the comment early and
    // dropped the :root token rule from the parsed sheet.
    expect(css).not.toContain('theme-*/');
    expect(css).not.toContain('ledgerly-*/');
  });
});

describe('themed scrollbars (rules)', () => {
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), './index.css'),
    'utf8',
  );

  it('styles webkit scrollbars as thin floating pills', () => {
    expect(css).toContain('::-webkit-scrollbar {');
    expect(css).toContain('width: 10px');
    expect(css).toContain('height: 10px');
    expect(css).toContain('::-webkit-scrollbar-track');
    expect(css).toContain('::-webkit-scrollbar-thumb');
    expect(css).toContain('::-webkit-scrollbar-thumb:hover');
    expect(css).toContain('::-webkit-scrollbar-thumb:active');
    expect(css).toContain('::-webkit-scrollbar-corner');
    expect(css).toContain('border-radius: 9999px');
    expect(css).toContain('background-clip: padding-box');
    expect(css).toContain('background-color: var(--t-scroll-thumb)');
    expect(css).toContain('background-color: var(--t-scroll-thumb-hover)');
    expect(css).toContain('background-color: var(--t-accent)');
  });

  it('sets the Firefox standard properties', () => {
    expect(css).toContain('scrollbar-width: thin');
    expect(css).toContain('scrollbar-color: var(--t-scroll-thumb) transparent');
  });
});

describe('themed scrollbars (a11y guards)', () => {
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), './index.css'),
    'utf8',
  );
  const LIGHT_GUARD =
    ':root:not(.dark):not(.theme-paper):not(.theme-console):not(.theme-bold):not(.theme-shell):not(.theme-terminal):not(.theme-clarity):not(.theme-clarity-dark):not(.ledgerly-dark):not(.ledgerly-light)';
  const DARK_GUARD =
    '.dark:not(.theme-console):not(.theme-bold):not(.theme-terminal):not(.theme-clarity):not(.theme-clarity-dark):not(.ledgerly-dark)';

  it('goes solid under prefers-reduced-transparency, glass themes only', () => {
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(css).toContain(`${LIGHT_GUARD} {`);
    expect(css).toContain(`${DARK_GUARD} {`);
    expect(css).toContain('--t-scroll-thumb: #64748b');
    expect(css).toContain('--t-scroll-thumb-hover: #475569');
    expect(css).toContain('--t-scroll-thumb: #94a3b8');
    expect(css).toContain('--t-scroll-thumb-hover: #cbd5e1');
  });

  it('reverts to native scrollbars under forced-colors', () => {
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('scrollbar-color: auto');
    expect(css).toContain('scrollbar-width: auto');
  });
});
