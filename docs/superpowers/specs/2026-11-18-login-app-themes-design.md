# ITMS: Five New App Themes + Matching Login Skins — Design

**Status:** proposed (awaiting owner approval)
**Date:** 2026-11-18
**Sketches:** `~/.hermes/cache/scratch/itms-login-sketches/001..006` (throwaway mockups; verified in browser)
**Related:** `docs/PLAN.md` (original build plan)

## Intent and the why

ITMS ships one visual identity (Liquid Glass + Ledgerly variants). The owner
reviewed six login mockups and wants the best five integrated as full,
selectable app themes — not just login pages — with Warm Paper as the new
default, while keeping every existing theme pixel-identical and selectable.
Why: demo wow-factor plus user choice; different users (and the same user in
different moods) want different faces on the same tool.

## Goals

- G1: Five new themes, each = app-wide token palette + matching login skin:
  1. **Paper** (default) — warm-paper calm enterprise; split login, serif display.
  2. **Console** — dark ops console; minimal centered login, emerald accent, mono labels.
  3. **Bold** — dark loud-brand; gradient-mesh hero login with live stats, lime accent.
  4. **Shell** — clean light; login modal over blurred dashboard mock, indigo accent.
  5. **Terminal** — phosphor-terminal dark; CLI login window, green mono.
- G2: Existing five modes (`light`, `dark`, `ledgerly`, `ledgerly-light`,
  `system`) and the current login page stay byte-for-byte identical in look
  and remain selectable (10 themes total).
- G3: Theme choice keeps working the way it does today: instant local apply
  (FOUC-safe), persisted to `localStorage`, synced to server
  (`PUT /auth/theme`, cross-device), previewed in Settings → Theme manager.
- G4: Login skin follows the active theme automatically (pre-auth it reads the
  local cache): Paper→WarmPaper, Console→DarkConsole, Bold→BoldBrand,
  Shell→AppShell, Terminal→Terminal, any legacy mode→current login unchanged.
- G5: New-user default becomes Paper (existing users keep whatever they have).

## Non-goals

- No new features, routes, or API surface (one allowlist widening excepted).
- No changes to the five legacy token blocks, legacy login markup, or
  `AnimatedBackground` behavior under legacy themes.
- No 5-layouts × 10-color-modes matrix: each login skin has fixed art
  direction and does not recolor with other themes.
- Light Minimal (mockup 004) is dropped as a login skin; its restraint
  informs the Shell app theme.

## Anti-goals (failure even if it technically works)

- A legacy-theme user notices ANY visual difference after this ships.
- A new-theme user sees a flash of the wrong theme on load (FOUC) or on login.
- The theme list becomes unusable (10 indistinguishable options, broken toggle
  cycling, previews that lie).
- Fonts block first paint or break the offline/PWA story (Google Fonts
  `<link>` in mockups must NOT ship as-is).

## Constraints

- C1 (additive-only): existing CSS blocks, `THEME_CYCLE` entries for legacy
  modes, `VALID_THEMES` legacy values, and migration defaults for existing
  rows are never edited for restyle — only extended.
- C2 (token contract): every theme defines the same 15 `--t-*` tokens
  (`base/surface/elevated/elevated2/input/edge/edge2/primary/secondary/muted/
  accent/accent-strong/glass-hi/glass-edge/glass-shadow`) so all 20 views
  recolor with zero per-view code changes.
- C3 (dark-variant contract): dark-family themes MUST carry `.dark` on
  `<html>` (drives `@custom-variant dark`); light themes MUST NOT.
  Console/Bold/Terminal carry it; Paper/Shell don't.
- C4 (a11y): muted text must clear WCAG AA (≥4.5:1) like ledgerly-light's
  `#6f6a61` fix; `prefers-reduced-motion`/`reduced-transparency` guards keep
  working (new theme classes get added to the transparency guard list);
  keyboard + screen-reader behavior of login unchanged in every skin.
- C5 (no FOUC): `frontend/index.html` inline script must map the 5 new stored
  values to classes synchronously, same as legacy values today.
- C6 (offline fonts): display/mono fonts ship via bundled `@fontsource`
  packages, never a render-blocking Google Fonts stylesheet.
- C7 (backend): `users.theme` stays `VARCHAR(20)`; new values are short
  lowercase slugs. New-user default flips to Paper via a new migration;
  existing rows are never rewritten.

## Approaches considered

**A. Login skins only, app untouched.** (Rejected — owner explicitly expanded
scope to the complete app UI.)

**B. Replace the theme system with 5 new themes, delete legacy.** (Rejected —
owner requires legacy themes preserved and selectable.)

**C. Additive theme extension (chosen).** Five new `ThemeMode` values flow
through the existing pipes (`theme.ts`, FOUC script, `index.css` token
blocks, `ThemeManager`, `ThemeToggle`, `PUT /auth/theme` allowlist,
`users.theme`). Login becomes a thin router: legacy modes render the current
page frozen as `LegacyLogin.tsx`; new modes render their skin. All auth
logic lives in one shared `useLogin()` hook so skins are pure presentational
variants. Why: smallest possible diff surface for a 10-theme system, zero
risk to legacy rendering, and every integration point already exists.

## Decided parts (as the owner decided them)

- D1: The five themes are Paper, Console, Bold, Shell, Terminal. Login skins
  match mockups 001/002/003/005/006 respectively. Mockup 004 dropped as skin.
- D2: Paper is the default (new users, unknown/empty stored value, logged-out
  first paint).
- D3: Legacy themes and the current login are preserved untouched and stay
  selectable forever ("later can be used").
- D4: Complete phase — all five themes ship together, not one-by-one.
- D5: Scope is the whole app (all views recolor via tokens), not login-only.

## Builder-check resolutions (my calls — veto welcome)

- R1 (skin auth contract): EVERY skin carries EVERY auth path — password
  form, demo button via the server-side demo mutation, Google OAuth entry
  when the backend reports it enabled, forgot-password link, error +
  `sso_failed` flash states, build-SHA footer. Mockup 006's hardcoded
  `demo1234` MUST NOT ship; Terminal's `demo` affordance fires the same
  demo mutation as the other skins. This defines the `useLogin()` API and
  the per-skin acceptance checklist.
- R2 (static, not live): Bold "live stats" = fixed numbers, Shell's blurred
  dashboard = static fake markup, Terminal boot lines may type-in as pure
  decoration but the form itself is real labeled inputs (no fake-typing
  input paradigm). Follows from the no-new-API non-goal + C4.
- R3 (faces): Paper = Fraunces/serif, Console = JetBrains Mono,
  Bold = Space Grotesk (per mockup 003 — correcting the draft), Shell =
  Inter/system, Terminal = JetBrains Mono. All via `@fontsource`.
- R4 (slugs): locked as `paper | console | bold | shell | terminal` unless
  vetoed. Short, permanent `users.theme` strings.
- R5 (font weight): the ~100–300 KB `@fontsource` addition is accepted
  unless vetoed.

## Decisions (answered by owner 2026-11-18)

- Q1 (names): `paper|console|bold|shell|terminal` — locked, no veto.
- Q2 (toggle): **dropdown instead of cycle button** — the header
  `ThemeToggle` becomes a compact theme menu listing all 10 themes
  (grouped New/Classic); one click applies. No cycling.
- Q3 (fonts): accepted, no veto. Faces per R3 via `@fontsource`.
- Q4 (charts/maps): **yes, rewire** hardcoded colors to `var(--t-*)`
  (verified invisible under legacy themes).
- Q5 (font scope): **app-wide** — serif/mono faces apply across all views,
  not login-only. Requires `--t-font-*` plumbing + typography verification
  (20 views × 5 themes).
- Q6 (logged-out switcher): **tiny theme menu on login** — visitors can
  browse all five login skins (+ legacy login) without logging in. Writes
  the same `itms_theme` cache (pre-auth: local only, no server push).
- Q7 (login hydration): **keep server-wins** — on login the server pref
  still overrides local; a skin→theme transition on login is accepted.

## What's left to the builder

- Exact per-theme token values (eyedrop from the mockups, then AA-checked).
- Exact font files/weights and the `--t-font-*` plumbing (tokens vs classes).
- `ThemeToggle` cycle implementation honoring Q2's answer.
- Per-view visual verification list (20 views; dense ones screenshotted in
  every new theme).
- Whether `AnimatedBackground` is reused by any new skin or stays legacy-only
  (suggestion: legacy-only; skins bring their own backgrounds).
- Seed/demo users' `theme` values: leave as-is (they'll render their stored
  legacy theme until changed) — confirm at plan time.
- PWA `theme-color` values for the 5 new themes.
