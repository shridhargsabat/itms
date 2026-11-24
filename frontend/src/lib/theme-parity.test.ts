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
  // Wave 2-C: the pre-paint script is an external same-origin file
  // (public/theme-init.js) so the deployed CSP `script-src 'self'` holds
  // with zero inline scripts. Content assertions target it; ordering and
  // reference assertions target index.html.
  const initJs = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../public/theme-init.js'),
    'utf8',
  );
  it('defaults to light and maps every slug to its classes', () => {
    expect(initJs).toContain(`|| 'light'`);
    (Object.keys(THEME_REGISTRY) as ThemeMode[]).forEach((m) => {
      if (m === 'light' || m === 'system') return; // default branch covers these
      expect(initJs).toContain(`'${m}'`);
    });
    expect(initJs).toContain(`'theme-console'`);
    expect(initJs).toContain(`'theme-terminal'`);
  });
  it('maps all seven theme classes with correct dark pairings', () => {
    // Light themes carry no .dark; dark themes pair theme class with .dark.
    expect(initJs).toContain(`d.classList.add('theme-paper')`);
    expect(initJs).toContain(`d.classList.add('theme-shell')`);
    expect(initJs).toContain(`d.classList.add('theme-clarity')`);
    expect(initJs).toContain(`d.classList.add('dark', 'theme-console')`);
    expect(initJs).toContain(`d.classList.add('dark', 'theme-bold')`);
    expect(initJs).toContain(`d.classList.add('dark', 'theme-terminal')`);
    expect(initJs).toContain(`d.classList.add('dark', 'theme-clarity-dark')`);
  });
  it('falls unknown stored values through to the light branch', () => {
    // Missing values default via `|| 'light'`, but an invalid string (e.g.
    // 'banana') must not land in the unthemed else branch either.
    expect(initJs).toContain(`=== -1) m = 'light'`);
  });
  it('sets meta theme-color per theme before first paint', () => {
    // PWA chrome must match the theme from the first paint, not stay
    // static #ffffff until React mounts.
    expect(initJs).toContain(`meta[name="theme-color"]`);
    expect(initJs).toContain(`setAttribute('content'`);
    ['#f6f5f1', '#09090b', '#0d0716', '#0a0f0d', '#141311', '#020617', '#f6f7f9', '#0b0d10'].forEach((c) =>
      expect(initJs).toContain(c));
    // The meta tag must precede the script — the script queries it during parse.
    expect(html).toContain('<script src="/theme-init.js"></script>');
    expect(html.indexOf('<meta name="theme-color"')).toBeLessThan(html.indexOf('theme-init.js'));
  });
  it('has zero inline scripts (CSP script-src self holds)', () => {
    // Every <script> in index.html must load an external src: any inline
    // script would violate the deployed script-src 'self' policy.
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
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
  it.each(['theme-paper','theme-console','theme-bold','theme-shell','theme-terminal','theme-clarity','theme-clarity-dark'])(
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
    // preflight stacks. A literal copy diverged once (ui-sans-serif/system-ui
    // vs tailwind --font-sans) — latent cross-platform restyle risk, zero
    // pixels here but wrong on principle — delegation to the theme vars
    // cannot drift.
    const legacy = css.match(/:root,\s*\.ledgerly-dark,\s*\.ledgerly-light,\s*\.theme-light\s*{([^}]*)}/s)?.[1] ?? '';
    expect(legacy).toContain('--t-font-display: var(--font-sans)');
    expect(legacy).toContain('--t-font-body: var(--font-sans)');
    expect(legacy).toContain('--t-font-mono: var(--font-mono)');
  });
  it('shell font vars delegate to the tailwind stacks (no literal copies)', () => {
    // Same drift class as legacy: a literal ui-sans-serif/system-ui copy can
    // diverge from preflight's stack — delegation cannot drift.
    const block = css.match(/\.theme-shell\s*{([^}]*)}/s)?.[1] ?? '';
    expect(block).toContain('--t-font-display: var(--font-sans)');
    expect(block).toContain('--t-font-body: var(--font-sans)');
    expect(block).toContain('--t-font-mono: var(--font-mono)');
  });
  it('body stacks never lead with unbundled Inter', () => {
    // Inter is not bundled: a leading Inter in a body stack is a dead hop
    // before the system fallback on every render.
    expect(css).not.toMatch(/--t-font-body:\s*Inter/);
  });
  it('muted/secondary hit AA and primary hits AAA on base (all new themes)', () => {
    // parse hexes per theme block, relative-luminance contrast vs --t-base
    const hex = (cls: string, t: string) =>
      css.match(new RegExp(`\\.${cls}\\s*{[^}]*--t-${t}:\\s*(#[0-9a-fA-F]{6})`, 's'))?.[1] ?? '';
    const lum = (h: string) => { const c = [0,2,4].map((i) => { const v = parseInt(h.slice(1+i,3+i),16)/255;
      return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; };
    const ratio = (a: string, b: string) => { const [x,y] = [lum(a),lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
    ['theme-paper','theme-console','theme-bold','theme-shell','theme-terminal','theme-clarity','theme-clarity-dark'].forEach((cls) => {
      const base = hex(cls,'base');
      expect(ratio(hex(cls,'primary'),base)).toBeGreaterThanOrEqual(7.0);
      expect(ratio(hex(cls,'secondary'),base)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(hex(cls,'muted'),base)).toBeGreaterThanOrEqual(4.5);
    });
  });
  it('every theme block defines --t-on-accent (task-15 sweep)', () => {
    // White-on-accent text is unreadable on bold lime / terminal green /
    // console emerald — each theme needs its own on-accent ink.
    ['theme-paper','theme-console','theme-bold','theme-shell','theme-terminal','theme-clarity','theme-clarity-dark'].forEach((cls) => {
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
    ['theme-paper','theme-console','theme-bold','theme-shell','theme-terminal','theme-clarity','theme-clarity-dark'].forEach((cls) => {
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

describe('paper ambient background', () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');
  const bg = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../components/AnimatedBackground.tsx'), 'utf8');
  it('paper hides the cool aurora and shows warm glow instead', () => {
    expect(css).toContain('.theme-paper .ab-mesh');
    expect(css).toContain('.theme-paper .ab-blobs');
    expect(css).toContain('.theme-paper .ab-paper-glow');
    expect(css).toContain('.theme-paper .ab-particles span');
    expect(bg).toContain('ab-paper-glow');
    expect(bg).toContain('ab-mesh');
  });
  it('no other theme gets ambient overrides', () => {
    ['theme-console', 'theme-bold', 'theme-shell', 'theme-terminal'].forEach((cls) => {
      expect(css).not.toContain(`.${cls} .ab-`);
    });
  });
});

describe('paper forest sidebar + serif headings', () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');
  it('paper remaps the aside subtree to forest without touching other themes', () => {
    expect(css).toContain('.theme-paper aside.glass-chrome');
    expect(css).toContain('.theme-paper aside .text-primary');
    expect(css).toContain('.theme-paper aside .bg-elevated');
    expect(css).toContain('.theme-paper aside [role="menu"] .text-primary');
    ['theme-console', 'theme-bold', 'theme-shell', 'theme-terminal'].forEach((cls) => {
      expect(css).not.toContain(`.${cls} aside`);
    });
  });
  it('paper uses the display face for headings', () => {
    expect(css).toContain('.theme-paper h1');
  });
});

describe('liquid glass SVG refraction & non-glass opacity isolation', () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');
  it('binds url(#itms-liquid-glass-refract) to all .glass-card and .glass-chrome surfaces in Liquid Glass themes', () => {
    expect(css).toContain('url(#itms-liquid-glass-refract)');
    expect(css).toContain('.glass-chrome');
    expect(css).toMatch(/\.glass-chrome\s*\{[^}]*url\(#itms-liquid-glass-refract\)/s);
  });
  it('provides a high-contrast light-mode override for .animate-shimmer on LegacyLogin', () => {
    expect(css).toContain(':root:not(.dark) .animate-shimmer');
  });
  it('makes paper cards opaque with warm ring shadow instead of 60% translucent frost', () => {
    expect(css).toContain('.theme-paper .glass-card');
  });
  it('excludes clarity themes from the SVG refraction selectors (opaque by design)', () => {
    // Every selector binding url(#itms-liquid-glass-refract) must exclude
    // .theme-clarity and .theme-clarity-dark, else Clarity surfaces pay for
    // (and risk artifacts from) a filter they are specced not to use.
    const blocks = css.split('url(#itms-liquid-glass-refract)');
    expect(blocks.length).toBeGreaterThan(1);
    blocks.slice(0, -1).forEach((before) => {
      const selector = before.slice(before.lastIndexOf('}') + 1);
      expect(selector).toContain(':not(.theme-clarity)');
      expect(selector).toContain(':not(.theme-clarity-dark)');
    });
  });
});

describe('clarity shared surfaces', () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8');
  it('remaps shared glass utilities to opaque surfaces in both clarity themes', () => {
    ['theme-clarity', 'theme-clarity-dark'].forEach((cls) => {
      expect(css).toContain(`.${cls} .glass-card`);
      expect(css).toContain(`.${cls} .glass-chrome`);
      expect(css).toContain(`.${cls} .glass-dense`);
    });
  });
  it('sets backdrop-filter none on clarity glass cards', () => {
    expect(css).toMatch(/\.theme-clarity \.glass-card[\s\S]*?\{[^}]*backdrop-filter:\s*none/s);
  });
  it('hides ambient background layers in both clarity themes', () => {
    ['theme-clarity', 'theme-clarity-dark'].forEach((cls) => {
      expect(css).toContain(`.${cls} .ab-mesh`);
    });
    expect(css).toMatch(/\.theme-clarity \.ab-mesh[\s\S]*?\{[^}]*display:\s*none/s);
  });
  it('binds display type, tabular numerals, and focus ring in both clarity themes', () => {
    ['theme-clarity', 'theme-clarity-dark'].forEach((cls) => {
      expect(css).toContain(`.${cls} h1`);
      expect(css).toContain(`.${cls} .text-3xl`);
      expect(css).toContain(`.${cls} .font-mono`);
      expect(css).toContain(`.${cls} :focus-visible`);
    });
  });
  it('does not leak clarity selectors into the other new themes', () => {
    ['theme-paper', 'theme-console', 'theme-bold', 'theme-shell', 'theme-terminal'].forEach((cls) => {
      expect(css).not.toContain(`.${cls} :focus-visible`);
      expect(css).not.toContain(`.${cls} .text-3xl`);
      expect(css).not.toContain(`.${cls} [role="listbox"]`);
      expect(css).not.toContain(`.${cls} tbody tr:hover`);
    });
  });
});
