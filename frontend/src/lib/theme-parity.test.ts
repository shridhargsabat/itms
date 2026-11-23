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
  it('maps all five theme classes with correct dark pairings', () => {
    // Light themes carry no .dark; dark themes pair theme class with .dark.
    expect(html).toContain(`d.classList.add('theme-paper')`);
    expect(html).toContain(`d.classList.add('theme-shell')`);
    expect(html).toContain(`d.classList.add('dark', 'theme-console')`);
    expect(html).toContain(`d.classList.add('dark', 'theme-bold')`);
    expect(html).toContain(`d.classList.add('dark', 'theme-terminal')`);
  });
});

describe('css token contract', () => {
  // NOTE: same fileURLToPath resolution as 'fouc parity' above — the
  // `new URL(..., import.meta.url)` pattern is rewritten by Vite as a
  // bundled-asset import and cannot read source files under vitest.
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'),
    'utf8',
  );
  const TOKENS = ['base','surface','elevated','elevated2','input','edge','edge2','primary','secondary','muted','accent','accent-strong','glass-hi','glass-edge','glass-shadow'];
  const FONTS = ['font-display','font-body','font-mono'];
  it.each(['theme-paper','theme-console','theme-bold','theme-shell','theme-terminal'])(
    '.%s defines all tokens', (cls) => {
      const block = css.match(new RegExp(`\\.${cls}\\s*{([^}]*)}`, 's'))?.[1] ?? '';
      [...TOKENS, ...FONTS].forEach((t) => expect(block).toContain(`--t-${t}:`));
    });
  it('legacy blocks are untouched', () => {
    expect(css).toContain('.ledgerly-light {');
    expect(css).toContain('--t-accent: #0e7c6b;');
  });
  it('legacy font vars delegate to the tailwind stacks (pixel-identity)', () => {
    // Task-15 pixel-proof: legacy --t-font-* must resolve EXACTLY to the
    // preflight stacks. A literal copy drifted once (ui-sans-serif/system-ui
    // vs tailwind --font-sans) and rasterized 1 LSB off on Linux — delegation
    // to the theme vars cannot drift.
    const legacy = css.match(/:root,\s*\.ledgerly-dark,\s*\.ledgerly-light,\s*\.theme-light\s*{([^}]*)}/s)?.[1] ?? '';
    expect(legacy).toContain('--t-font-display: var(--font-sans)');
    expect(legacy).toContain('--t-font-body: var(--font-sans)');
    expect(legacy).toContain('--t-font-mono: var(--font-mono)');
  });
  it('muted/secondary hit AA and primary hits AAA on base (all new themes)', () => {
    // parse hexes per theme block, relative-luminance contrast vs --t-base
    const hex = (cls: string, t: string) =>
      css.match(new RegExp(`\\.${cls}\\s*{[^}]*--t-${t}:\\s*(#[0-9a-fA-F]{6})`, 's'))?.[1] ?? '';
    const lum = (h: string) => { const c = [0,2,4].map((i) => { const v = parseInt(h.slice(1+i,3+i),16)/255;
      return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; };
    const ratio = (a: string, b: string) => { const [x,y] = [lum(a),lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
    ['theme-paper','theme-console','theme-bold','theme-shell','theme-terminal'].forEach((cls) => {
      const base = hex(cls,'base');
      expect(ratio(hex(cls,'primary'),base)).toBeGreaterThanOrEqual(7.0);
      expect(ratio(hex(cls,'secondary'),base)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(hex(cls,'muted'),base)).toBeGreaterThanOrEqual(4.5);
    });
  });
  it('every theme block defines --t-on-accent (task-15 sweep)', () => {
    // White-on-accent text is unreadable on bold lime / terminal green /
    // console emerald — each theme needs its own on-accent ink.
    ['theme-paper','theme-console','theme-bold','theme-shell','theme-terminal'].forEach((cls) => {
      const block = css.match(new RegExp(`\\.${cls}\\s*{([^}]*)}`, 's'))?.[1] ?? '';
      expect(block).toContain('--t-on-accent:');
    });
    // Legacy default keeps pre-existing white-on-accent (pixel-identical).
    // (All :root/ledgerly legacy-selector blocks are scanned: the default
    // lives in its own rule after the font rule, same selector idiom.)
    const legacy = [...css.matchAll(/:root,\s*\.ledgerly-dark,\s*\.ledgerly-light[^{]*{([^}]*)}/gs)]
      .map((m) => m[1]).join('\n');
    expect(legacy).toContain('--t-on-accent: #ffffff;');
    // Wired as a semantic color so components use text-on-accent.
    expect(css).toContain('--color-on-accent: var(--t-on-accent);');
  });
  it('on-accent hits AA on accent (all new themes)', () => {
    const hex = (cls: string, t: string) =>
      css.match(new RegExp(`\\.${cls}\\s*{[^}]*--t-${t}:\\s*(#[0-9a-fA-F]{6})`, 's'))?.[1] ?? '';
    const lum = (h: string) => { const c = [0,2,4].map((i) => { const v = parseInt(h.slice(1+i,3+i),16)/255;
      return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; };
    const ratio = (a: string, b: string) => { const [x,y] = [lum(a),lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
    ['theme-paper','theme-console','theme-bold','theme-shell','theme-terminal'].forEach((cls) => {
      expect(ratio(hex(cls,'on-accent'),hex(cls,'accent'))).toBeGreaterThanOrEqual(4.5);
    });
  });
});

describe('hardcoded-color sweep (task 14)', () => {
  // NOTE: same fileURLToPath resolution as above. Block comments are
  // stripped before matching so mockup-anchor hexes in file headers
  // (e.g. Console's `#10b981`) don't trip the code assertions.
  const skinsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../views/login/skins');
  const code = (f: string) =>
    readFileSync(resolve(skinsDir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const consoleSrc = code('ConsoleLogin.tsx');
  const boldSrc = code('BoldLogin.tsx');
  it('console skin drives accent glow from var(--t-accent)', () => {
    expect(consoleSrc).not.toMatch(/#10b981/);
    expect(consoleSrc).not.toMatch(/rgba\(16,185,129/);
    expect(consoleSrc).toContain('var(--t-accent)');
  });
  it('bold skin drives fleet-bar lead stop from var(--t-accent)', () => {
    expect(boldSrc).not.toMatch(/#d4ff3f/);
    expect(boldSrc).toContain('var(--t-accent)');
  });
});
