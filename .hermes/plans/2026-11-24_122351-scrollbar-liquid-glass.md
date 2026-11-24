# Themed Scrollbars (Liquid Glass) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Style all scrollbars (window + inner containers) to match the Liquid Glass theme instead of showing native OS scrollbars.

**Architecture:** Add two per-theme CSS tokens (`--t-scroll-thumb`, `--t-scroll-thumb-hover`) in one additive section at the end of `index.css`, then style scrollbars once globally with `::-webkit-scrollbar` rules plus the standard `scrollbar-width`/`scrollbar-color` for Firefox, so all 12 themes pick up matching scrollbars automatically.

**Tech Stack:** CSS (custom properties, `::-webkit-scrollbar`, `scrollbar-color`), Vitest CSS-text tests, Vite.

**Spec:** Screenshot in the request (Dashboard, Light Glass: native light scrollbar visible at the window's far-right edge) + this plan. No separate design doc.

## Global Constraints

- Legacy token blocks at the top of `frontend/src/index.css` are NEVER edited (`:root` lines 25-41, `.dark` 43-59, `.ledgerly-dark` 62-77, `.ledgerly-light` 85-100, `.theme-light` 106-123) — use the separate-rule idiom: set new vars in new rules appended later in the file (equal specificity, later wins; see the `:root, .ledgerly-dark, ...` font rules at lines 145/156).
- Additive-only: no existing selector's declarations may change; only append new rules.
- Theme classes live on `<html>` (= `:root`), so within the new section `:root` comes first, theme overrides after.
- All work in `/home/shridharsabat/itms/frontend`; run commands with `workdir` = that dir.
- Commit per task; never delete branches.

## Current Context / Assumptions

- Verified by repo inspection (2026-11-24): **zero** scrollbar CSS exists today (`scrollbar` appears in `Layout.tsx`/`DataTable.tsx` only in comments) — every scrollbar is 100% native OS chrome, hence the mismatch in the screenshot.
- 12 theme modes in `frontend/src/lib/theme-registry.ts`; glass ones are `light`/`dark`/`system` (bare `:root` / `.dark` on `<html>`). The other 9 scopes set solid palettes: `.ledgerly-dark`, `.ledgerly-light`, `.theme-paper`, `.theme-console`, `.theme-bold`, `.theme-shell`, `.theme-terminal`, `.theme-clarity` (line 901), `.theme-clarity-dark` (line 922). `.theme-light` (line 106) is the ThemeManager preview reset and must also set scrollbar vars or previews show wrong scrollbars.
- Scroll containers: window-level + `Layout.tsx` content wrapper (`lg:overflow-y-auto`) + `DataTable` inner scroller. Global `::-webkit-scrollbar` / inherited `scrollbar-color` covers all of them with no component edits.
- Established test pattern: `frontend/src/index.css.test.ts` reads `index.css` as text and asserts selectors/values (no DOM, no RTL — the repo's RTL auto-cleanup caveat does not apply).
- No `test` npm script; tests run via `npx vitest run` (vitest.config.ts + node_modules exist).
- Locked design (do not improvise): 10px thin overlay-style pill, transparent track, thumb = pill with 3px transparent border + `background-clip: padding-box` (≈4px visible pill, macOS-like). Glass themes get translucent thumbs; opaque themes get solid thumbs sampled from their own `--t-edge2` (rest) / `--t-muted` (hover) hex values (copied verbatim from the blocks above). Thumb `:active` uses the theme accent.

## Review Focus

- Firefox shows hover-state thumb color change — reasonable person expects hover feedback there too, but only a static color is feasible without flicker-prone `*:hover` hacks (documented tradeoff; Task 2 test pins static `scrollbar-color` only).
- A user in Windows forced-colors / high-contrast mode — scrollbars must revert to native, never invisible translucent pills (Task 3 test pins the `forced-colors` revert).
- A user with `prefers-reduced-transparency` — glass thumbs must go solid while opaque themes stay byte-identical (Task 3 test pins the guard chains).
- ThemeManager "Light"/"System" preview cards rendered while the app is dark — preview scrollbars must stay light (Task 1 test pins `.theme-light` vars).
- Horizontal scrollbars (wide DataTables) — must match vertical styling, not stay native (Task 2 test pins `height: 10px` + corner rule).

---

### Task 0: Branch setup

**Files:** none (git only).

- [ ] **Step 1: Create the feature branch**

Run: `git checkout -b ui/themed-scrollbars`
Expected: `Switched to a new branch 'ui/themed-scrollbars'` (run from `/home/shridharsabat/itms`).

---

### Task 1: Scrollbar tokens for all 12 theme scopes + preview reset

**Files:**
- Modify: `frontend/src/index.css` (append after line 1232, end of file)
- Test: `frontend/src/index.css.test.ts` (append after line 106, end of file)

**Interfaces:**
- Produces: `--t-scroll-thumb`, `--t-scroll-thumb-hover` custom properties on `:root`, `.dark`, `.ledgerly-dark`, `.ledgerly-light`, `.theme-light`, `.theme-paper`, `.theme-console`, `.theme-bold`, `.theme-shell`, `.theme-terminal`, `.theme-clarity`, `.theme-clarity-dark` — consumed by Task 2's global rules and Task 3's guards.

- [ ] **Step 1: Write the failing test** — append this describe block at the end of `frontend/src/index.css.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/index.css.test.ts -t "themed scrollbars"`
Expected: FAIL — `missing --t-scroll-thumb in :root` (2 failed, rest of file passes).

- [ ] **Step 3: Append the token section** at the end of `frontend/src/index.css` (after line 1232). Copy verbatim — values for opaque themes are their own `--t-edge2` (rest) / `--t-muted` (hover) hex, copied from each block; order matters (`:root` first, overrides after):

```css
/* ---------- Themed scrollbars: tokens (additive-only) ----------
   Separate-rule idiom: legacy blocks above are never edited, so these
   rules re-declare each scope. Theme classes live on <html> (= :root),
   so at equal specificity the later rule wins — :root first, overrides
   after. Glass themes = translucent overlay pills; opaque themes =
   solid pills sampled from their own edge2/muted tokens. */
:root {
  --t-scroll-thumb: rgb(15 23 42 / 0.28);
  --t-scroll-thumb-hover: rgb(15 23 42 / 0.45);
}
.dark {
  --t-scroll-thumb: rgb(255 255 255 / 0.22);
  --t-scroll-thumb-hover: rgb(255 255 255 / 0.38);
}
.theme-light {
  --t-scroll-thumb: rgb(15 23 42 / 0.28);
  --t-scroll-thumb-hover: rgb(15 23 42 / 0.45);
}
.ledgerly-dark {
  --t-scroll-thumb: #44403a;
  --t-scroll-thumb-hover: #98938a;
}
.ledgerly-light {
  --t-scroll-thumb: #d8d4c9;
  --t-scroll-thumb-hover: #6f6a61;
}
.theme-paper {
  --t-scroll-thumb: #cfc9bb;
  --t-scroll-thumb-hover: #6f6a61;
}
.theme-console {
  --t-scroll-thumb: #35353e;
  --t-scroll-thumb-hover: #8b8b93;
}
.theme-bold {
  --t-scroll-thumb: #4a3f66;
  --t-scroll-thumb-hover: #a79fc0;
}
.theme-shell {
  --t-scroll-thumb: #cbd5e1;
  --t-scroll-thumb-hover: #5b6a82;
}
.theme-terminal {
  --t-scroll-thumb: #2e4439;
  --t-scroll-thumb-hover: #8ba89a;
}
.theme-clarity {
  --t-scroll-thumb: #cbd3dc;
  --t-scroll-thumb-hover: #667085;
}
.theme-clarity-dark {
  --t-scroll-thumb: #333d49;
  --t-scroll-thumb-hover: #929dac;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/index.css.test.ts -t "themed scrollbars"`
Expected: PASS — `2 passed` (the `(tokens)` tests; other file tests are filtered out by `-t`, which is fine).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/index.css frontend/src/index.css.test.ts
git commit -m "feat: per-theme scrollbar tokens (glass translucent, opaque solid)"
```

---

### Task 2: Global WebKit + Firefox scrollbar rules

**Files:**
- Modify: `frontend/src/index.css` (append after the Task 1 section)
- Test: `frontend/src/index.css.test.ts` (append new describe at end of file)

**Interfaces:**
- Consumes: `--t-scroll-thumb`, `--t-scroll-thumb-hover`, `--t-accent` from Task 1 / existing tokens.
- Produces: global scrollbar rendering for every scroll container (window, Layout wrapper, DataTable). No component edits.

- [ ] **Step 1: Write the failing test** — append at end of `frontend/src/index.css.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/index.css.test.ts -t "themed scrollbars (rules)"`
Expected: FAIL — `expected ... to contain '::-webkit-scrollbar {'`.

- [ ] **Step 3: Append the rules** after the Task 1 token section in `frontend/src/index.css`, verbatim:

```css
/* ---------- Themed scrollbars: global rules ----------
   One rule set for every scroller (window, Layout wrapper, DataTables):
   theme classes sit on <html>, so the per-theme vars resolve everywhere.
   Firefox: thin + themed thumb; hover there stays static (documented). */
:root {
  scrollbar-width: thin;
  scrollbar-color: var(--t-scroll-thumb) transparent;
}
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background-color: var(--t-scroll-thumb);
  border-radius: 9999px;
  border: 3px solid transparent;
  background-clip: padding-box;
}
::-webkit-scrollbar-thumb:hover {
  background-color: var(--t-scroll-thumb-hover);
  border: 3px solid transparent;
  background-clip: padding-box;
}
::-webkit-scrollbar-thumb:active {
  background-color: var(--t-accent);
  border: 3px solid transparent;
  background-clip: padding-box;
}
::-webkit-scrollbar-corner {
  background: transparent;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/index.css.test.ts`
Expected: PASS — all tests in the file pass (existing 7 + 4 new = 11).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/index.css frontend/src/index.css.test.ts
git commit -m "feat: global thin-pill scrollbar rules (webkit + firefox)"
```

---

### Task 3: Accessibility guards (reduced transparency + forced colors)

**Files:**
- Modify: `frontend/src/index.css` (append after the Task 2 section)
- Test: `frontend/src/index.css.test.ts` (append new describe at end of file)

**Interfaces:**
- Consumes: Task 1 tokens; the codebase's LIGHT_GUARD/DARK_GUARD selector chains (copied verbatim from the existing test file lines 20-23 so non-glass themes are untouched).

- [ ] **Step 1: Write the failing test** — append at end of `frontend/src/index.css.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/index.css.test.ts -t "themed scrollbars (a11y guards)"`
Expected: FAIL — `expected ... to contain '@media (prefers-reduced-transparency: reduce)'`.

- [ ] **Step 3: Append the guards** after the Task 2 section in `frontend/src/index.css`, verbatim (guard chains copied verbatim from `index.css.test.ts` lines 20-23; opaque themes keep their solid tokens untouched):

```css
/* ---------- Themed scrollbars: accessibility guards ---------- */
@media (prefers-reduced-transparency: reduce) {
  :root:not(.dark):not(.theme-paper):not(.theme-console):not(.theme-bold):not(.theme-shell):not(.theme-terminal):not(.theme-clarity):not(.theme-clarity-dark):not(.ledgerly-dark):not(.ledgerly-light) {
    --t-scroll-thumb: #64748b;
    --t-scroll-thumb-hover: #475569;
  }
  .dark:not(.theme-console):not(.theme-bold):not(.theme-terminal):not(.theme-clarity):not(.theme-clarity-dark):not(.ledgerly-dark) {
    --t-scroll-thumb: #94a3b8;
    --t-scroll-thumb-hover: #cbd5e1;
  }
}
@media (forced-colors: active) {
  :root {
    scrollbar-width: auto;
    scrollbar-color: auto;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/index.css.test.ts`
Expected: PASS — 13/13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/index.css frontend/src/index.css.test.ts
git commit -m "feat: scrollbar a11y guards (reduced-transparency, forced-colors)"
```

---

### Task 4: Visual verification across themes + full suite + build

**Files:** none (verification only; fix forward in a new commit only if something looks wrong).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: `Local: http://localhost:5173/` (leave running; Ctrl+C when done).

- [ ] **Step 2: Eyeball 4 themes in Chromium/Chrome** — open the app, use the theme switcher (ThemeManager / Day-Night toggle in the top bar), and on a page with a window scrollbar (Dashboard) plus a DataTable page (Assets) confirm each:
  - Liquid Glass Light: thin dark-translucent pill, transparent track, no native gray bar; hover darkens; drag uses indigo accent.
  - Liquid Glass Dark: thin white-translucent pill.
  - One opaque light (Paper or Shell): thin solid tan/gray pill matching the theme.
  - One opaque dark (Console or Terminal): thin solid dark pill, visible against the surface.
  - Horizontal DataTable scrollbar (narrow the window until the table overflows): same pill style, transparent corner.
- [ ] **Step 3: Run the FULL frontend suite**

Run: `npx vitest run`
Expected: all test files pass, zero failures.

- [ ] **Step 4: Run the production build**

Run: `npm run build`
Expected: `tsc -b` clean + `vite build` succeeds (`✓ built in ...`).

- [ ] **Step 5: Push and open a PR** (repo convention: PRs, e.g. #37; do NOT delete the branch after merge)

```bash
git push -u origin ui/themed-scrollbars
```

Then open a PR with before/after screenshots of the Dashboard scrollbar in Light + Dark glass.

---

## Tests / Validation Summary

- TDD per task: new `describe` block → `npx vitest run src/index.css.test.ts [-t ...]` red → append CSS → green → commit. Final file state: 13 tests (7 pre-existing + 6 new).
- Full gate (Task 4): `npx vitest run` (all green) + `npm run build` (tsc + vite clean) + 4-theme visual check.

## Risks, Tradeoffs, and Open Questions

- **Firefox hover is static.** Per-element `:hover` → `scrollbar-color` swap on `*` causes flicker (inherited property re-resolves on every descendant hover); accepted: Firefox gets thin + themed thumb, hover feedback is Chromium-only. Pinned by test (static `scrollbar-color` only).
- **No `backdrop-filter` on thumbs.** `backdrop-filter` does not apply to `::-webkit-scrollbar-thumb`; the "glass" read comes from translucency + floating-pill geometry, matching the `--t-glass-*` token language. Do not attempt SVG-filter refraction on scrollbars.
- **Overlay scrollbars (mobile / macOS trackpads)** may hide entirely per OS settings — nothing to do; `color-scheme` (already set per theme) keeps any OS-rendered parts tinted.
- **Thumb contrast on photos/auroras:** 0.28/0.22 alpha is macOS-like but subtle over busy backgrounds; hover/active states compensate. If the user finds it too faint, bump `:root` to 0.34 — one-line change, no plan amendment needed.
- **Open question (non-blocking):** should ` ledgerly-*` (warm paper, non-glass) thumbs be translucent too for a softer look? Plan says solid (matches their opaque surfaces); easy follow-up if the user disagrees.
- **Scope kept tight (YAGNI):** no per-component scrollbar variants, no JS-driven custom scrollers (breaks a11y + momentum scroll), no `::-webkit-scrollbar-button` styling (deprecated/never rendered in Chrome).
