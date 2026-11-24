# Five New App Themes + Login Skins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five new selectable app themes (Paper default, Console, Bold, Shell, Terminal), each with its matching login skin, while leaving all five legacy themes and the current login pixel-identical.

**Architecture:** Additive extension of the existing token pipeline — new `ThemeMode` values flow through a single `THEME_REGISTRY` source of truth into `theme.ts`, the FOUC script, `index.css` token blocks, the manager/dropdown UI, and the widened backend allowlist; `Login.tsx` becomes a thin router over one shared `useLogin()` hook plus six skins (five new + frozen legacy).

**Tech Stack:** React 19 + Vite + Tailwind v4 + TanStack Query (frontend), Rust axum + sqlx (one allowlist + one migration), vitest + jsdom + @testing-library/react (new harness), @fontsource (bundled fonts)

**Spec:** `docs/superpowers/specs/2026-11-18-login-app-themes-design.md` — the plan argues from the spec, so the spec travels with it; executors read both.

## Global Constraints

- New theme slugs (permanent `users.theme` strings): `paper | console | bold | shell | terminal`. Never rename after merge.
- New CSS token classes: `.theme-paper | .theme-console | .theme-bold | .theme-shell | .theme-terminal`. Dark-family (`console`, `bold`, `terminal`) MUST also carry `.dark` on `<html>`; light ones (`paper`, `shell`) MUST NOT.
- Every theme defines the same 15 `--t-*` color tokens as legacy (C2) plus 3 font vars (`--t-font-display`, `--t-font-body`, `--t-font-mono`). Legacy blocks are never edited.
- PWA `theme-color` values: paper `#f6f5f1`, console `#09090b`, bold `#0d0716`, shell `#ffffff`, terminal `#0a0f0d`.
- New-user default is `paper` (FOUC fallback, `getThemeMode()` fallback, `hydrateThemeFromUser` fallback, DB default via new migration). Existing stored values and rows are never rewritten.
- Mockup 006's hardcoded `demo1234` MUST NOT ship; every skin's demo path fires the server-side `POST /auth/demo` mutation.
- Fonts via `@fontsource` npm packages only — no Google Fonts `<link>`, no render-blocking stylesheet.
- No new API endpoints. Backend diff = `VALID_THEMES` widen + error string + one default-flip migration.
- Every task ends green (`npx vitest run`, `npx tsc -b`, and where touched `cargo test`) and commits.

## Review Focus

- Pre-auth theme pick firing `PUT /auth/theme` → 401 → redirect-to-/login loop: the Q6 login menu MUST use local-only apply. Pinned by Task 6's `setThemeModeLocal` test (asserts `fetch` never called).
- New dark theme missing `.dark` → `dark:` utilities and native controls render light. Pinned by Task 2's FOUC-parity test (asserts class strings per slug).
- Legacy login visual drift during the freeze move. Pinned by Task 6's legacy-render test (asserts identical key selectors/classes) + Task 15's side-by-side screenshot.
- SSO-only deployments: a skin missing the OAuth entry locks users out. Pinned by every skin task's R1 contract test (`oauth.enabled=true` → link present).
- Muted/secondary text below WCAG AA in new palettes. Pinned by Task 3's contrast test (primary ≥7.0, secondary/muted ≥4.5 on base, computed, not eyeballed).

---

## File Structure

New files (create):
- `frontend/vitest.config.ts` — harness (jsdom, `@/` alias).
- `frontend/src/lib/theme-registry.ts` — `THEME_REGISTRY`, `skinForTheme()`, `DEFAULT_THEME`. Single source of truth; `theme.ts` delegates to it.
- `frontend/src/lib/theme-registry.test.ts`, `frontend/src/lib/theme-parity.test.ts` (index.html/index.css file-parity + contrast), `frontend/src/views/login/useLogin.ts`, `frontend/src/views/login/skins.ts` (skin map, tested via registry), `frontend/src/views/login/skins/*.test.tsx` + `*.tsx` × 6 (Legacy, Paper, Console, Bold, Shell, Terminal), `frontend/src/components/LoginThemeMenu.tsx` (+ test), `backend/migrations/0023_theme_default_paper.sql` (confirm number first).
- `frontend/src/components/ThemeToggle.test.tsx`, `ThemeManager` grouping (no new file).

Modified (extend-only unless noted):
- `frontend/package.json` (devDeps: vitest, jsdom, @testing-library/react, @testing-library/jest-dom; deps: 3 @fontsource packages), `frontend/src/lib/theme.ts` (delegate to registry; add `setThemeModeLocal`), `frontend/index.html` (FOUC map + default), `frontend/src/index.css` (append-only: 5 token blocks, font plumbing, glass overrides, transparency guard), `frontend/src/components/ThemeToggle.tsx` (rewrite as dropdown — explicit redesign per Q2), `frontend/src/components/ThemeManager.tsx` (grouped 10), `frontend/src/views/Login.tsx` (thin router), `frontend/src/main.tsx` (fontsource imports), `backend/src/routes/auth.rs` (allowlist + pure helper), `frontend/src/api/types.ts` (one comment line listing valid themes).

---

### Task 1: Harness + theme registry (source of truth)

**Files:**
- Create: `frontend/vitest.config.ts`, `frontend/src/lib/theme-registry.ts`, `frontend/src/lib/theme-registry.test.ts`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `ThemeMode` (10 values), `SkinName`, `ThemeMeta`, `THEME_REGISTRY: Record<ThemeMode, ThemeMeta>`, `DEFAULT_THEME='paper'`, `skinForTheme(m): SkinName` — consumed by Tasks 2, 6, 12, 13.
- `ThemeMeta` shape: `{ value, label, group: 'new'|'classic', dark: boolean, classes: string[], themeColor: string, skin: SkinName, glass: boolean }`.

- [ ] **Step 1: Install the test harness**

Run: `cd /home/shridharsabat/itms/frontend && npm i -D vitest jsdom @testing-library/react @testing-library/jest-dom && npx vitest --version`
Expected: version printed (vitest 3.x/4.x), exit 0. (`package-lock.json` updates; commit it with this task.)

- [ ] **Step 2: Write `vitest.config.ts`**

```ts
import path from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'] },
});
```

plus `vitest.setup.ts` containing exactly: `import '@testing-library/jest-dom/vitest';`

- [ ] **Step 3: Write the failing registry test** (`src/lib/theme-registry.test.ts`)

```tsx
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
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd /home/shridharsabat/itms/frontend && npx vitest run src/lib/theme-registry.test.ts 2>&1 | tail -5`
Expected: FAIL — `Failed to resolve import "./theme-registry"`.

- [ ] **Step 5: Implement `src/lib/theme-registry.ts`** (minimal to pass)

10 entries; new labels `Paper|Console|Bold|Shell|Terminal`, group `new`; legacy labels copied verbatim from `ThemeManager.tsx` (`Liquid Glass Light|Liquid Glass Dark|Liquid Glass (Auto)|Ledgerly Light|Ledgerly`), group `classic`; `classes`: paper `['theme-paper']`, console `['dark','theme-console']`, bold `['dark','theme-bold']`, shell `['theme-shell']`, terminal `['dark','theme-terminal']`, light `[]`, dark `['dark']`, system `[]` (resolved at apply time), ledgerly `['dark','ledgerly-dark']`, ledgerly-light `['ledgerly-light']`; `glass`: true for light/dark/system, false for the rest; `themeColor` per Global Constraints (legacy: light `#ffffff`, dark `#020617`, system `#ffffff`, ledgerly `#141311`, ledgerly-light `#f6f5f1` — copied from `theme.ts`).

- [ ] **Step 6: Run to verify pass**

Run: `cd /home/shridharsabat/itms/frontend && npx vitest run src/lib/theme-registry.test.ts 2>&1 | tail -4`
Expected: `Test Files  1 passed`, `Tests  4 passed`.

- [ ] **Step 7: Commit**

```bash
cd /home/shridharsabat/itms && git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/vitest.setup.ts frontend/src/lib/theme-registry.ts frontend/src/lib/theme-registry.test.ts && git commit -m "feat(themes): test harness + 10-mode theme registry"
```

---

### Task 2: Rewire theme.ts + FOUC to the registry

**Files:**
- Modify: `frontend/src/lib/theme.ts`, `frontend/index.html`
- Create: `frontend/src/lib/theme-parity.test.ts` (FOUC part; CSS part added in Task 3)

**Interfaces:**
- Consumes: `THEME_REGISTRY`, `DEFAULT_THEME` from Task 1.
- Produces: `setThemeModeLocal(m)` (local-only apply, no fetch — for Task 13), FOUC mapping used by Task 15's no-flash check.

- [ ] **Step 1: Write the failing parity test** (append later in Task 3; FOUC block now)

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { THEME_REGISTRY, type ThemeMode } from './theme-registry';

describe('fouc parity', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/shridharsabat/itms/frontend && npx vitest run src/lib/theme-parity.test.ts 2>&1 | tail -4`
Expected: FAIL — `expected ... to contain '|| 'paper''`.

- [ ] **Step 3: Rewrite `theme.ts`** to delegate: `ThemeMode` re-exported from registry (keep the export path stable — 4 files import it); `THEMES` = registry keys; `getThemeMode()` fallback `DEFAULT_THEME`; `getResolvedTheme()` unchanged for classic + identity for new; `applyTheme()` toggles classes from `THEME_REGISTRY[resolved].classes` (clearing all known theme classes first) + sets `meta theme-color` from registry; `hydrateThemeFromUser()` fallback `DEFAULT_THEME`; add:

```ts
export function setThemeModeLocal(mode: ThemeMode) {
  localStorage.setItem('itms_theme', mode);
  applyTheme(mode);
  window.dispatchEvent(new Event('itms-theme-changed'));
}
```

and reimplement `setThemeMode()` as `setThemeModeLocal(mode)` + existing fire-and-forget `setThemePref`. Keep `watchSystemTheme`/`onThemeChanged` behavior identical.

- [ ] **Step 4: Rewrite the FOUC script** in `frontend/index.html`: default `'paper'`; explicit branches mapping `paper→theme-paper`, `console→dark+theme-console`, `bold→dark+theme-bold`, `shell→theme-shell`, `terminal→dark+theme-terminal`; legacy branches byte-identical logic to today.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd /home/shridharsabat/itms/frontend && npx vitest run 2>&1 | tail -3 && npx tsc -b && echo TSC_OK`
Expected: all tests pass, `TSC_OK`.

- [ ] **Step 6: Commit**

```bash
cd /home/shridharsabat/itms && git add frontend/src/lib/theme.ts frontend/src/lib/theme-parity.test.ts frontend/index.html && git commit -m "feat(themes): registry-driven theme.ts + FOUC with paper default"
```

---

### Task 3: Token blocks + font plumbing in index.css

**Files:**
- Modify: `frontend/src/index.css` (APPEND-ONLY above the glass utilities; legacy blocks untouched)
- Modify: `frontend/src/lib/theme-parity.test.ts` (add CSS contract + contrast tests)

**Interfaces:**
- Consumes: class names + dark flags from Task 1.
- Produces: 15 color tokens + 3 font vars per new theme; `font-display`/`font-body`/`font-mono2` utilities; glass + transparency-guard entries. Consumed by Tasks 7–11 (skins) and Task 14 (sweep).

- [ ] **Step 1: Write the failing CSS contract test** (append to `theme-parity.test.ts`)

```ts
describe('css token contract', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/shridharsabat/itms/frontend && npx vitest run src/lib/theme-parity.test.ts 2>&1 | tail -4`
Expected: FAIL — `.theme-paper defines all tokens` (block missing).

- [ ] **Step 3: Append the 5 token blocks.** Eyedrop base values from the mockups at `/home/shridharsabat/.hermes/cache/scratch/itms-login-sketches/00{1,2,3,5,6}-*/index.html` (`:root` blocks) and complete to 15 tokens + 3 font vars each, satisfying the contrast test. Anchors (must match): paper base `#f6f5f1` accent `#2f6b3c`-family (AA-checked); console base `#09090b` accent `#10b981`; bold base `#0d0716` accent `#d4ff3f`; shell base `#eef1f6`-family surface with `#ffffff` cards, accent `#4f46e5`; terminal base `#0a0f0d` accent `#4ade80`. Font vars: paper display `Fraunces, Georgia, serif`; console/bold/terminal mono `JetBrains Mono, ui-monospace, monospace` (bold display `Space Grotesk, Inter, sans-serif`); shell = system stack; every legacy theme gets explicit font vars equal to the current stack (invisible).

- [ ] **Step 4: Wire utilities + guards.** In `@theme`: `--font-display: var(--t-font-display); --font-body: var(--t-font-body);` (Tailwind v4 then provides `font-display`/`font-body` utilities); set `body { font-family: var(--t-font-body); }` in `@layer base`. Add the 5 classes to the `.dark .glass-*` freeze selector list ONLY where the theme uses glass (console/bold/shell use the frozen recipe; paper/terminal are opaque: set their `--t-glass-*` so `glass-*` renders near-opaque). Add all 5 classes to the `prefers-reduced-transparency` guard list.

- [ ] **Step 5: Run tests + build**

Run: `cd /home/shridharsabat/itms/frontend && npx vitest run 2>&1 | tail -3 && npm run build 2>&1 | tail -3`
Expected: all pass; `vite build` succeeds (`dist/` written, exit 0).

- [ ] **Step 6: Commit**

```bash
cd /home/shridharsabat/itms && git add frontend/src/index.css frontend/src/lib/theme-parity.test.ts && git commit -m "feat(themes): 5 token palettes + font plumbing (AA-gated)"
```

---

### Task 4: Bundle fonts via @fontsource

**Files:**
- Modify: `frontend/package.json`, `frontend/src/main.tsx`

**Interfaces:**
- Consumes: font vars from Task 3 (families must exist at runtime).
- Produces: offline-safe Fraunces + JetBrains Mono + Space Grotesk.

- [ ] **Step 1: Install** (no test to fail first — asset wiring; verification is build + computed-style check)

Run: `cd /home/shridharsabat/itms/frontend && npm i @fontsource/fraunces @fontsource/jetbrains-mono @fontsource/space-grotesk && ls node_modules/@fontsource | head -4`
Expected: `fraunces`, `jetbrains-mono`, `space-grotesk` listed.

- [ ] **Step 2: Import weights in `src/main.tsx`** (top, before CSS): `fraunces/500.css`, `fraunces/600.css`, `jetbrains-mono/400.css`, `jetbrains-mono/500.css`, `jetbrains-mono/700.css`, `space-grotesk/500.css`, `space-grotesk/700.css`. Import ONLY these weights (bundle discipline per R5).

- [ ] **Step 3: Verify build + no external font requests**

Run: `cd /home/shridharsabat/itms/frontend && npm run build 2>&1 | tail -2 && grep -ro "fonts.googleapis\|fonts.gstatic" dist/ | head -3; echo "ext_refs_above(empty_good)"`
Expected: build succeeds; no googleapis/gstatic refs.

- [ ] **Step 4: Commit**

```bash
cd /home/shridharsabat/itms && git add frontend/package.json frontend/package-lock.json frontend/src/main.tsx && git commit -m "feat(themes): bundled @fontsource faces (offline-safe)"
```

---

### Task 5: Backend allowlist + paper default migration

**Files:**
- Modify: `backend/src/routes/auth.rs`
- Create: `backend/migrations/0023_theme_default_paper.sql` (confirm number in Step 1)

**Interfaces:**
- Consumes: slug list from Task 1 (must match exactly).
- Produces: `PUT /auth/theme` accepts 10 values; new users default `paper`.

- [ ] **Step 1: Confirm the next migration number**

Run: `ls /home/shridharsabat/itms/backend/migrations/ | tail -3`
Expected: ends at `0022_...` (if a higher number exists, use max+1 for the new file and note it in the commit message).

- [ ] **Step 2: Extract a pure helper + failing test.** Refactor `set_theme` to call `fn is_valid_theme(t: &str) -> bool` (move the `VALID_THEMES.contains` check into it), and add at the bottom of `auth.rs`:

```rust
#[cfg(test)]
mod theme_tests {
    use super::is_valid_theme;
    #[test]
    fn allowlist_covers_all_ten_modes() {
        for t in ["light","dark","ledgerly","ledgerly-light","system","paper","console","bold","shell","terminal"] {
            assert!(is_valid_theme(t), "missing {t}");
        }
        assert!(!is_valid_theme("paper "));
        assert!(!is_valid_theme("DARK"));
        assert!(!is_valid_theme(""));
    }
}
```

Note: `set_theme` lowercases/trims before calling, so the helper itself stays strict — the test pins that contract.

- [ ] **Step 3: Run to verify it fails**

Run: `cd /home/shridharsabat/itms/backend && cargo test theme_tests 2>&1 | tail -4`
Expected: FAIL — `missing paper` (helper still uses the 5-value array).

- [ ] **Step 4: Widen `VALID_THEMES: [&str; 10]`** with the 5 new slugs + update the 422 message to list all ten.

- [ ] **Step 5: Write the migration** (`0023_theme_default_paper.sql`):

```sql
-- Default theme: Paper for new users (10-theme expansion). Existing rows untouched.
ALTER TABLE users ALTER COLUMN theme SET DEFAULT 'paper';
```

- [ ] **Step 6: Run backend tests + typecheck frontend (untouched, sanity)**

Run: `cd /home/shridharsabat/itms/backend && cargo test theme_tests 2>&1 | tail -3`
Expected: `test result: ok. 1 passed`. (Full `cargo test` may need a DB; the pure unit test must not.)

- [ ] **Step 7: Commit**

```bash
cd /home/shridharsabat/itms && git add backend/src/routes/auth.rs backend/migrations/0023_theme_default_paper.sql && git commit -m "feat(themes): allowlist 10 modes + paper default for new users"
```

---

### Task 6: useLogin hook + legacy freeze + Login router

**Files:**
- Create: `frontend/src/views/login/useLogin.ts`, `frontend/src/views/login/skins/LegacyLogin.tsx`, `frontend/src/views/login/skins/LegacyLogin.test.tsx`
- Modify: `frontend/src/views/Login.tsx` (thin router — skins only; Task 13 adds the menu render)

**Interfaces:**
- Consumes: `skinForTheme`, `setThemeModeLocal` (Tasks 1–2); `login`, `demoLogin`, `getOAuthStatus`, `setSession` from `@/api/client`; `hydrateThemeFromUser`.
- Produces: `useLogin()` API consumed by Tasks 7–11:
```ts
{ email, setEmail, password, setPassword, flash, oauthEnabled: boolean,
  submit(e: React.FormEvent), onDemoClick(), loginPending: boolean,
  loginError: string | null, demoPending: boolean }
```
- Router contract: `Login.tsx` reads `getThemeMode()` (+ `onThemeChanged` subscription) and renders the skin for `skinForTheme(mode)`. Task 13 adds the menu render.

- [ ] **Step 1: Write the failing legacy-freeze render test** (`skins/LegacyLogin.test.tsx`). Hook behavior is covered by the six per-skin R1 tests; routing is covered by Task 1's `skinForTheme` test — this file pins the frozen markup only:

```tsx
// skins/LegacyLogin.test.tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import LegacyLogin from './LegacyLogin';
const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
describe('legacy login freeze', () => {
  it('renders the exact legacy structure', () => {
    const { container } = wrap(<LegacyLogin />);
    expect(screen.getByRole('heading', { name: 'ITMS' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@company.com')).toBeInTheDocument();
    expect(container.querySelector('.glass-card')).not.toBeNull();
    expect(container.querySelector('.animate-pulse-ring')).not.toBeNull();
    expect(screen.getByText(/argon2 hashes/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/shridharsabat/itms/frontend && npx vitest run src/views/login 2>&1 | tail -4`
Expected: FAIL — cannot find `./LegacyLogin`.

- [ ] **Step 3: Extract `useLogin.ts`** — move ALL logic from current `Login.tsx` (state, `useQuery(oauth-status)`, both mutations, `submit`, `onDemoClick`, `flash` effect, view-transition navigate) into the hook returning the exact API above. No JSX in the hook.

- [ ] **Step 4: Create `LegacyLogin.tsx`** — current `Login.tsx` JSX verbatim (same classes, same `AnimatedBackground`, same strings), consuming `useLogin()` instead of local state. Byte-identical render is the goal; the ONLY allowed diffs are mechanical (hook call vs useState lines).

- [ ] **Step 5: Rewrite `Login.tsx` as router** (legacy-only for now; each skin task appends its own branch):

```tsx
import { useEffect, useState } from 'react';
import { getThemeMode, onThemeChanged } from '@/lib/theme';
import { skinForTheme } from '@/lib/theme-registry';
import LegacyLogin from './login/skins/LegacyLogin';
export default function Login() {
  const [mode, setMode] = useState(getThemeMode());
  useEffect(() => onThemeChanged(() => setMode(getThemeMode())), []);
  const skin = skinForTheme(mode);
  if (skin === 'paper') return <LegacyLogin />; // Task 7 swaps to PaperLogin
  return <LegacyLogin />;
}
```

(The `paper` branch looks silly — it exists so Task 7's diff is exactly two lines: import + element swap. Until a skin lands, every mode renders legacy: safe intermediate state, typechecks at every commit.)

- [ ] **Step 6: Run tests + typecheck + legacy visual check**

Run: `cd /home/shridharsabat/itms/frontend && npx vitest run 2>&1 | tail -3 && npx tsc -b && echo OK`
Expected: all pass + OK. Then start dev (`npm run dev`), set `localStorage.itms_theme='light'`, open `/login`, screenshot; compare against `main`-branch screenshot pixel-wise (same viewport) — Task 15 automates the final proof; here, eyeball-confirm identical.

- [ ] **Step 7: Commit**

```bash
cd /home/shridharsabat/itms && git add frontend/src/views/login frontend/src/views/Login.tsx && git commit -m "feat(themes): useLogin hook + frozen legacy login + skin router"
```

---

### Task 7: Paper skin (default)

**Files:**
- Create: `frontend/src/views/login/skins/PaperLogin.tsx`, `frontend/src/views/login/skins/PaperLogin.test.tsx`
- Modify: `frontend/src/views/Login.tsx` (add branch)

**Interfaces:**
- Consumes: `useLogin()` from Task 6.
- Produces: `PaperLogin` + router branch. Pattern for Tasks 8–11.

- [ ] **Step 1: Write the failing R1 contract test** (adapt per skin; structure identical for Tasks 8–11):

```tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import PaperLogin from './PaperLogin';
vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return { ...mod, getOAuthStatus: () => Promise.resolve({ enabled: true, client_id_set: true }) };
});
const wrap = () => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter><PaperLogin /></MemoryRouter></QueryClientProvider>);
describe('paper skin R1 contract', () => {
  it('carries every auth path', async () => {
    wrap();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /demo/i })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /google/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /forgot/i })).toBeInTheDocument();
  });
});
```

(Test asserts roles/labels, NOT mockup class names — skins are free to differ in markup as long as every path exists and is labeled. OAuth link: skins render `<a href="/api/v1/auth/oauth/start">` exactly like legacy.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/shridharsabat/itms/frontend && npx vitest run src/views/login/skins/PaperLogin.test.tsx 2>&1 | tail -3`
Expected: FAIL — cannot find `./PaperLogin`.

- [ ] **Step 3: Implement `PaperLogin.tsx`** — port mockup `001-warm-paper/index.html` to JSX consuming `useLogin()`: split layout, forest panel (`#14301f`), Fraunces via `font-display`, hairline borders. Replace mock toast logic with real `loginError`/`flash` display (same red/amber treatment as legacy, recolored to palette). Keep `__BUILD_SHA__` footer line. No credentials in bundle.

- [ ] **Step 4: Add router branch** in `Login.tsx` (`skin === 'paper'` → `<PaperLogin/>`).

- [ ] **Step 5: Run tests + visual check**

Run: `cd /home/shridharsabat/itms/frontend && npx vitest run src/views/login 2>&1 | tail -3 && npx tsc -b && echo OK`
Expected: pass + OK. Then `localStorage.itms_theme='paper'` → `/login` → screenshot → compare to mockup 001 side by side (layout, palette, typeface).

- [ ] **Step 6: Commit**

```bash
cd /home/shridharsabat/itms && git add frontend/src/views/login/skins/PaperLogin.tsx frontend/src/views/login/skins/PaperLogin.test.tsx frontend/src/views/Login.tsx && git commit -m "feat(themes): paper login skin (default)"
```

---

### Task 8: Console skin

Same 6 steps as Task 7 with `Console/002-dark-console`: near-black `#09090b`, emerald `#10b981` primary, JetBrains Mono micro-labels, status line, grid texture. Router branch `console`.

- [ ] Steps 1–6 mirror Task 7 (test file `ConsoleLogin.test.tsx`, same R1 assertions, button name `/authenticate/i`).
- [ ] Visual check against mockup 002 with `itms_theme='console'`.
- [ ] Commit: `feat(themes): console login skin`

### Task 9: Bold skin

Same 6 steps with `Bold/003-bold-brand`: void `#0d0716`, mesh blobs, Space Grotesk mega-type, lime `#d4ff3f` CTA, STATIC stat numbers (R2 — copy the mockup's final values `1,284 / 98% / 36s` as literals), fleet-health bars at fixed widths. Router branch `bold`.

- [ ] Steps 1–6 mirror Task 7 (button name `/sign in/i`).
- [ ] Visual check against mockup 003 with `itms_theme='bold'`.
- [ ] Commit: `feat(themes): bold login skin`

### Task 10: Shell skin

Same 6 steps with `Shell/005-app-shell`: light scrim + blurred static dashboard mock (R2 — literal fake rows, no data fetching), indigo `#4f46e5` primary, white modal. Router branch `shell`. Include the hold-to-peek button (harmless, already mocked).

- [ ] Steps 1–6 mirror Task 7.
- [ ] Visual check against mockup 005 with `itms_theme='shell'`.
- [ ] Commit: `feat(themes): shell login skin`

### Task 11: Terminal skin

Same 6 steps with `Terminal/006-terminal`: terminal window, boot lines (typed decoration allowed — pure CSS/JS effect, real `<label>`+`<input>` underneath per R2/C4), JetBrains Mono, green `#4ade80`. `demo` affordance calls `onDemoClick()` (NEVER fills `demo1234` into the bundle — call the mutation directly). Router branch `terminal`.

- [ ] Steps 1–6 mirror Task 7 (button name `/signin\.sh/i`; test ALSO asserts `demo1234` appears nowhere: `expect(document.documentElement.innerHTML).not.toContain('demo1234')`).
- [ ] Visual check against mockup 006 with `itms_theme='terminal'`.
- [ ] Commit: `feat(themes): terminal login skin`

---

### Task 12: ThemeToggle dropdown + ThemeManager grouping

**Files:**
- Modify: `frontend/src/components/ThemeToggle.tsx` (rewrite as dropdown per Q2), `frontend/src/components/ThemeManager.tsx` (group New/Classic)
- Create: `frontend/src/components/ThemeToggle.test.tsx`

**Interfaces:**
- Consumes: `THEME_REGISTRY` (Task 1), `setThemeMode` (Task 2).
- Produces: 10-option dropdown; grouped manager. Both must keep working when logged out? Toggle lives in authed Layout; manager too — server push stays (logged-in only surfaces).

- [ ] **Step 1: Write the failing dropdown test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ThemeToggle from './ThemeToggle';
vi.mock('@/api/client', () => ({ setThemePref: () => Promise.resolve() }));
describe('theme dropdown', () => {
  it('lists all 10 themes grouped, applies on click', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /theme/i }));
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('Classic')).toBeInTheDocument();
    ['Paper','Console','Bold','Shell','Terminal','Liquid Glass Light','Liquid Glass Dark',
     'Liquid Glass (Auto)','Ledgerly Light','Ledgerly'].forEach((label) =>
      expect(screen.getByRole('menuitemradio', { name: new RegExp(label) })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Console/ }));
    expect(localStorage.getItem('itms_theme')).toBe('console');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/shridharsabat/itms/frontend && npx vitest run src/components/ThemeToggle.test.tsx 2>&1 | tail -3`
Expected: FAIL — `Unable to find role="menuitemradio"` (current toggle is a cycle button).

- [ ] **Step 3: Rewrite `ThemeToggle.tsx`** as an accessible dropdown (`aria-haspopup`, `menu`/`menuitemradio` roles, Escape closes, click-outside closes, current mode `aria-checked`). Options generated from `THEME_REGISTRY` (group headers New/Classic). Keep the icon-button footprint (`size="icon"`, same className/showLabel props — Layout imports must not change).

- [ ] **Step 4: Group `ThemeManager.tsx`** — render `THEMES` in two labeled sections (New: paper/console/bold/shell/terminal with 1-line descriptions; Classic: existing 5 verbatim). Add the 5 new `ThemeMeta` entries (`wrapperClass` = registry classes joined, `glass` per registry). The existing `ThemePreview` works unchanged (var()-based).

- [ ] **Step 5: Run tests + typecheck**

Run: `cd /home/shridharsabat/itms/frontend && npx vitest run 2>&1 | tail -3 && npx tsc -b && echo OK`
Expected: all pass + OK.

- [ ] **Step 6: Commit**

```bash
cd /home/shridharsabat/itms && git add frontend/src/components/ThemeToggle.tsx frontend/src/components/ThemeToggle.test.tsx frontend/src/components/ThemeManager.tsx && git commit -m "feat(themes): 10-option dropdown + grouped manager"
```

---

### Task 13: Login theme menu (Q6)

**Files:**
- Create: `frontend/src/components/LoginThemeMenu.tsx`, `frontend/src/components/LoginThemeMenu.test.tsx`
- Modify: `frontend/src/views/Login.tsx` (render menu above skin)

**Interfaces:**
- Consumes: `THEME_REGISTRY`, `setThemeModeLocal` (Tasks 1–2 — LOCAL-ONLY, no server push pre-auth).
- Produces: tiny fixed-corner menu on `/login` switching all 10 (legacy included → legacy skin).

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LoginThemeMenu from './LoginThemeMenu';
const fetchSpy = vi.spyOn(globalThis, 'fetch');
describe('login theme menu', () => {
  it('switches theme locally without any network call', () => {
    render(<LoginThemeMenu />);
    fireEvent.click(screen.getByRole('button', { name: /login theme/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Terminal/ }));
    expect(localStorage.getItem('itms_theme')).toBe('terminal');
    expect(document.documentElement.classList.contains('theme-terminal')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/shridharsabat/itms/frontend && npx vitest run src/components/LoginThemeMenu.test.tsx 2>&1 | tail -3`
Expected: FAIL — cannot find `./LoginThemeMenu`.

- [ ] **Step 3: Implement `LoginThemeMenu.tsx`** — fixed bottom-right, low-contrast trigger (`Palette` icon + current label), dropdown with 10 `menuitemradio` options (grouped, compact), `onClick` → `setThemeModeLocal(value)`. Theme-agnostic styling (fixed dark chip, readable on every skin).

- [ ] **Step 4: Render it in `Login.tsx` router** above the skin (`<><LoginThemeMenu/>{skin}</>`).

- [ ] **Step 5: Run tests + typecheck**

Run: `cd /home/shridharsabat/itms/frontend && npx vitest run 2>&1 | tail -3 && npx tsc -b && echo OK`
Expected: all pass + OK.

- [ ] **Step 6: Commit**

```bash
cd /home/shridharsabat/itms && git add frontend/src/components/LoginThemeMenu.tsx frontend/src/components/LoginThemeMenu.test.tsx frontend/src/views/Login.tsx && git commit -m "feat(themes): pre-auth theme menu on login"
```

---

### Task 14: Hardcoded-color sweep (Q4 verification)

**Files:**
- Modify: `frontend/src/api/types.ts` (1 comment line), possibly NONE others.
- Create: none (verification task; fixes—if any—get their own red/green cycle per finding)

**Interfaces:**
- Consumes: everything (final code state).
- Produces: proof that Q4 rewire is complete-or-unneeded.

- [ ] **Step 1: Inventory hardcoded colors**

Run: `cd /home/shridharsabat/itms/frontend && grep -rEn "#[0-9a-fA-F]{3,8}\b|rgba?\(" src/ --include="*.tsx" --include="*.ts" | grep -v "\.test\." | grep -vE "^\s*//|^\s*\*|#[0-9]+\b" | head -20`
Expected: ONLY allowlisted hits — `theme-registry.ts`/`theme.ts` meta colors, `Labels.tsx` QR print colors (`#111827`/`#ffffff` — REQUIRED for scanners, do not touch), `ThemeManager.tsx` preview `#ffffff` icon. Any view/component color hit = a finding: write a failing assertion (add to parity test: e.g. `expect(AssetsCss).not.toMatch(/#.../ )` — precise per finding), rewire to `var(--t-*)`, re-run, then screenshot that view in a legacy theme to prove invisibility.

- [ ] **Step 2: Backend/frontend slug parity**

Run: `cd /home/shridharsabat/itms && grep -o '"[a-z-]*"' backend/src/routes/auth.rs | tr -d '"' | sort -u > /tmp/be.txt && grep -oE "'(paper|console|bold|shell|terminal|light|dark|ledgerly|ledgerly-light|system)'" frontend/src/lib/theme-registry.ts | tr -d "'" | sort -u > /tmp/fe.txt && diff /tmp/be.txt /tmp/fe.txt && echo SLUGS_MATCH`
Expected: `SLUGS_MATCH` (both list the same 10 slugs; backend grep may catch a couple of extra string literals — if so, eyeball-confirm all 10 theme slugs are present in both and move on).

- [ ] **Step 3: Update the `AuthUser.theme` doc comment** in `src/api/types.ts:19` to list all ten values.

- [ ] **Step 4: Full gates**

Run: `cd /home/shridharsabat/itms/frontend && npx vitest run 2>&1 | tail -3 && npx tsc -b && npm run build 2>&1 | tail -2 && cd ../backend && cargo test theme_tests 2>&1 | tail -2`
Expected: vitest all pass, tsc clean, vite build exit 0, `1 passed`.

- [ ] **Step 5: Commit**

```bash
cd /home/shridharsabat/itms && git add frontend/src/api/types.ts && git commit -m "chore(themes): Q4 sweep clean + doc comment" # + any rewire files from Step 1
```

---

### Task 15: Visual proof sweep (20 views × themes)

**Files:**
- Modify: none (evidence task). Screenshots to `/tmp/theme-sweep/` (not committed).

**Interfaces:**
- Consumes: finished app (Tasks 1–14).
- Produces: PASS/FAIL per (view, theme) + fix commits for failures (each fix: failing assertion first where assertable, else before/after screenshots).

- [ ] **Step 1: Legacy pixel-proof.** Start dev server; for `light` + `dark` + `ledgerly` + `ledgerly-light`, screenshot `/login` + `/` (dashboard) at 1440×900; `git stash` the branch, screenshot the same 8 on `main`, unstash, `diff`/pixel-compare (e.g. ImageMagick `compare -metric RMSE`, expect `0` for all 8 — glass blur/animations may add noise; threshold ≤0.5% and eyeball-confirm any delta is animation, not restyle).

- [ ] **Step 2: New-theme walkthrough.** For each of `paper|console|bold|shell|terminal`, load and screenshot: `/login`, `/` (dashboard), `/assets`, `/tickets`, `/cmdb`, `/reports`, `/settings` (7 views × 5 themes = 35 shots). Checklist per shot: no unreadable text, no invisible borders/buttons, no broken layout, fonts applied (serif/paper, mono/console+terminal, grotesk/bold), no console errors. Record PASS/FAIL; every FAIL becomes a fix with before/after shots in the same commit message body.

- [ ] **Step 3: No-flash proof.** For each new theme: set cache, cold-load `/login` (disable cache, slow 3G), video/screenshot first paint — assert no light flash (first meaningful paint already themed). Failure = FOUC bug → fix in `index.html` + parity test, re-run Task 2 suite.

- [ ] **Step 4: Final full gates + commit evidence log**

Run: same gate command as Task 14 Step 4.
Expected: all green. Then commit a `docs/superpowers/specs/2026-11-18-login-app-themes-SWEEP.md` checklist (35 PASS lines + 8 legacy-compare lines) — the audit trail:

```bash
cd /home/shridharsabat/itms && git add docs/superpowers/specs/2026-11-18-login-app-themes-SWEEP.md && git commit -m "docs(themes): visual sweep evidence (35+8 shots)"
```

---

## Tests / Validation

TDD per task (RED→GREEN→commit) as scripted above. Suite summary:

| Layer | Command | Must show |
|---|---|---|
| Unit + render | `npx vitest run` (in `frontend/`) | all files pass, 0 fail |
| Types | `npx tsc -b` | clean, exit 0 |
| Build | `npm run build` | `dist/` written, exit 0 |
| Backend | `cargo test theme_tests` (in `backend/`) | `1 passed` |
| Contrast (in suite) | Task 3 test | primary ≥7.0, secondary/muted ≥4.5 × 5 themes |
| Legacy pixels | Task 15 Step 1 | RMSE 0 (≤0.5% animation noise) × 8 |
| Visual sweep | Task 15 Step 2 | 35 PASS lines committed |

## Risks, Tradeoffs, and Open Questions

- **RISK: `dark:` utilities in 4 files + native controls.** New dark themes inherit via `.dark` — verified by FOUC test, but eyeball form controls in Task 15 (Console/Bold/Terminal).
- **RISK: Tailwind v4 `font-display` name collision.** `@theme --font-display` generates a `font-display` utility; if it clashes with existing usage, rename to `--font-brand` (registry untouched — utility name only). Task 3 implementer checks `grep -r "font-display" src/` first (expected: no hits).
- **RISK: @testing-library/react + React 19.** Needs v16+; `npm i` resolves automatically — if peer conflicts arise, take the compatible major and note it in the Task 1 commit.
- **RISK: `system` mode semantics.** Unchanged (resolves light/dark only). New themes are fixed. If the owner later wants system→paper/console auto, that's a new design decision, not this plan.
- **TRADEOFF: 10 themes in one dropdown.** Chosen per Q2 over cycling. If usability suffers, a grouped two-section menu (already grouped) is the escape hatch — no architecture change.
- **TRADEOFF: static Bold stats / Shell backdrop.** Deliberate per R2 (no new API). If the owner wants live pre-auth data later, that's a new endpoint + design review.
- **OPEN (answered in spec):** Q1–Q7 all resolved 2026-11-18; see Decisions section. No open questions remain.
- **NOTE: migration number.** Task 5 Step 1 confirms `0023` (or max+1) at execution time.
- **NOTE: demo/seed users.** Seed sets no theme → existing dev rows keep current values; fresh DBs get `paper` default. No seed change needed.
