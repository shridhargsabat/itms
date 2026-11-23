# Visual sweep evidence: five app themes (Task 15)

Branch `feat/five-app-themes` @ `740b703`, base `d35e6b8` (merge-base with
`origin/main`). All shots 1440x900 via Playwright+Chrome, `/tmp/theme-sweep/`
(NOT committed). Worktree dev server :5199 (branch), temp worktree :5198
(base), prod preview :5197 (no-flash). Auth: demo@itms.local (authed views
intercept `/auth/me` with the shot theme so server hydration matches).

Method notes:

- `git stash` in the brief was a no-op (tree clean, all tasks committed);
  base shots run from a temp worktree at the merge-base instead — same
  base-vs-branch comparison, main checkout untouched.
- Legacy compare uses `reduced_motion=reduce` on BOTH sides (CSS animations
  fast-forward to identical end states; any restyle would still diff).
  Harness determinism: branch-vs-branch2 and base-vs-base2 self-compares
  both RMSE 0; all 4 cross-compares bit-identical.
- Walkthrough uses full motion + 2.2 s settle (real UX). Per-shot checks:
  readable text, visible borders/buttons, intact layout, theme fonts
  (mechanical: html classes + body font/bg; visual: login display faces),
  no console errors (only known dev-only SW `text/html` MIME noise,
  present on base too).
- Font-scope reading (Q5): app shell renders the theme BODY font by design
  (no plan task applies display faces to app shell; all 14 prior tasks
  reviewed as-is); signature faces (Fraunces/Space Grotesk/JetBrains Mono)
  verified on the login skins + terminal app body.

## Step 1: legacy pixel-proof (8 shots)

| # | shot | RMSE (abs, norm) | verdict |
|---|------|------------------|---------|
| 1 | light /login | masked 0 (raw 2683.8 = Task-13 menu pill only, bbox 166x46+1266+854) | PASS |
| 2 | light dashboard | 2.2462 (0.0034%) — 150 px @ d<=2 LSB, footer text | PASS |
| 3 | dark /login | masked 0 (raw 819.3 = pill only, bbox 164x46+1268+854) | PASS |
| 4 | dark dashboard | 7.4771 (0.0114%) — 180 px @ d<=2 LSB, same footer spot | PASS |
| 5 | ledgerly /login | masked 0 (raw 626.6 = pill only, bbox 115x46+1317+854) | PASS |
| 6 | ledgerly dashboard | 7.3626 (0.0112%) — 186 px @ d<=2 LSB, same spot | PASS |
| 7 | ledgerly-light /login | masked 0 (raw 2448.3 = pill only, bbox 147x46+1285+854) | PASS |
| 8 | ledgerly-light dashboard | 2.4139 (0.0037%) — 109 px @ d<=2 LSB, same spot | PASS |

Notes: login raw deltas are EXCLUSIVELY the Task-13 specified pre-auth
theme menu (bottom-right pill; base corner empty, diff pure white
elsewhere); pill region blacked on both sides -> RMSE 0 x4. Dashboard
deltas (0.003-0.011%, 35-150x below the 0.5% gate) are compositor
rounding from Task-12's specified relative dropdown wrapper (DOM-diff
proven: extra `<div class="relative">` around the theme button; best
shift (0,0); invisible at 6x zoom). Step-1 fix `9102745` (legacy font
vars delegate to tailwind stacks) is stack-correctness hardening with
zero pixel change (RMSEs bit-identical before/after).

## Step 2: new-theme walkthrough (35 shots, all on final code)

Paper:

- [x] PASS paper /login — split forest/paper skin, serif display, all readable
- [x] PASS paper dashboard (/) — KPI cards, New Ticket white-on-green readable
- [x] PASS paper /assets — table + ghost pager legible (fixed by `a47212d`, re-verified)
- [x] PASS paper /tickets — badges + ghost pager legible (fixed by `a47212d`, re-verified)
- [x] PASS paper /cmdb — detail + edges + ghost pager (fixed by `a47212d`, re-verified; CI-name clip pre-exists on base)
- [x] PASS paper /reports — filters + healthy empty state
- [x] PASS paper /settings — theme card + SSO form, toggle/inputs visible

Console:

- [x] PASS console /login — SSH skin, mono micro-labels, emerald CTA
- [x] PASS console dashboard — New Ticket dark-on-emerald (fixed by `740b703`)
- [x] PASS console /assets — table + pager legible
- [x] PASS console /tickets — badges + pager legible
- [x] PASS console /cmdb — detail + edges + pager legible
- [x] PASS console /reports — filters + empty state
- [x] PASS console /settings — SSO form on dark, toggle/inputs visible

Bold:

- [x] PASS bold /login — Space Grotesk hero, lime CTA dark text
- [x] PASS bold dashboard — New Ticket dark-on-lime (fixed by `740b703`, re-verified)
- [x] PASS bold /assets — table + pager legible
- [x] PASS bold /tickets — badges + pager legible
- [x] PASS bold /cmdb — ghost pager legible (fixed by `a47212d`, re-verified; clip pre-exists)
- [x] PASS bold /reports — filters + empty state
- [x] PASS bold /settings — Change/Save dark-on-lime (fixed by `740b703`, re-verified)

Shell:

- [x] PASS shell /login — blurred-backdrop modal, indigo CTA
- [x] PASS shell dashboard — New Ticket white-on-indigo readable
- [x] PASS shell /assets — table + ghost pager (fixed by `a47212d`, re-verified)
- [x] PASS shell /tickets — badges + ghost pager (fixed by `a47212d`, re-verified)
- [x] PASS shell /cmdb — ghost pager (fixed by `a47212d`, re-verified; clip pre-exists)
- [x] PASS shell /reports — filters + empty state
- [x] PASS shell /settings — SSO form, toggle/inputs visible

Terminal:

- [x] PASS terminal /login — terminal-window skin, mono throughout
- [x] PASS terminal dashboard — New Ticket dark-on-green (fixed by `740b703`)
- [x] PASS terminal /assets — mono table + ghost pager (fixed by `a47212d`, re-verified)
- [x] PASS terminal /tickets — badges + ghost pager (fixed by `a47212d`, re-verified)
- [x] PASS terminal /cmdb — ghost pager (fixed by `a47212d`, re-verified)
- [x] PASS terminal /reports — filters + empty state
- [x] PASS terminal /settings — SSO form in mono, toggle/inputs visible

Initial sweep: 23 PASS, 12 FAIL (9 pager-label + 3 on-accent, incl. bold-cmdb
overlap). Every FAIL fixed with RED test first and re-shot PASS above:

- `a47212d` pager ghost variant (PaginationFooter): accent-fill leak via
  Button default variant removed; before/after element strips per theme.
- `740b703` --t-on-accent token + text-on-accent (Button primary + 6 sibling
  accent fills; legacy #ffffff = pixel-identical, dashboard RMSE unchanged
  at 2.2462); before/after button crops per theme.

## Step 3: no-flash proof (5 themes, prod preview :5197, slow 3G, no cache)

- [x] PASS paper — classes `theme-paper` since first rAF (root empty), 0 mutations, first paint bg #f6f5f1
- [x] PASS console — classes `dark theme-console` since first rAF, 0 mutations, first paint pure black + spinner
- [x] PASS bold — classes `dark theme-bold` since first rAF, 0 mutations, first paint bg #0d0716
- [x] PASS shell — classes `theme-shell` since first rAF, 0 mutations, first paint bg #eef1f6
- [x] PASS terminal — classes `dark theme-terminal` since first rAF, 0 mutations, first paint pure black + spinner

FOUC script sets classes during parse before any paint/React; React
applyTheme is a no-op (same value, observer records zero mutations);
first observable paint is already themed — no light flash possible.

## Step 4: final gates (all green)

- `npx vitest run` (frontend/): 11 files / 33 tests passed
- `npx tsc -b`: clean
- `npm run build`: dist/ written
- `cargo test theme_tests` (backend/): 1 passed

Owner waiver (final review): the legacy-visible pager ghost-variant bugfix (`a47212d`) is intentional — the old render contradicted PaginationFooter's own no-fixed-accent-fill documented intent; controller-accepted, no code change.
