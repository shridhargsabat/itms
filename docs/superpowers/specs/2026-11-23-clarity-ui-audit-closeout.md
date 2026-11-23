# Clarity UI Audit Closeout — 2026-11-23

Branch: `feat/five-app-themes` (worktree `/home/shridharsabat/itms/.worktrees/feat-five-app-themes`)
Plan: `/home/shridharsabat/.hermes/plans/2026-11-23_144157-clarity-complete-ui-ux-redesign.md`

## Result

All 12 plan tasks implemented and verified. The app now ships **12 selectable themes**
(10 existing + `clarity` + `clarity-dark`), with every authenticated route using the
same page hierarchy (`PageHeader`), filter language (`FilterBar`), empty states
(`EmptyState`), opaque surfaces, tabular numerals, and visible focus rings.

Final gates (all green):
- `npx vitest run` → 19 files / 86 tests pass
- `npx tsc -b` → exit 0
- `npm run build` → succeeds (PWA precache generated)
- `cargo test theme` → `allowlist_covers_all_twelve_modes` passes
- Live round-trip: `PUT /api/v1/auth/theme {"theme":"clarity-dark"}` → 200
  `{"ok":true,"theme":"clarity-dark"}`; `GET /api/v1/auth/me` returns the slug;
  theme survives full page reloads.

## Audit findings → fix commits

| # | Finding | Fix commit |
|---|---------|------------|
| 1 | Visual language fragmentation (glass bleed into opaque themes) | `14e1028` scoped Clarity remap (`backdrop-filter: none`, solid surfaces, ambient layers hidden); `9b2c8e0` excludes Clarity from liquid-glass SVG refraction selectors |
| 2 | Uneven component coverage across routes | `a37d0f8`, `49cee1a`, `ad710b3`, `6bf4478`, `fbe84da` route refactors |
| 3 | Unsystematic typography | `14e1028` (Space Grotesk h1, tabular `.text-3xl` KPIs, JetBrains Mono `.font-mono`) |
| 4 | No shared page hierarchy | `5ad5488` (`PageHeader`, `FilterBar`, `EmptyState` primitives) |
| 5 | Hardcoded status colors in views | Route refactors reuse `TicketBadge`/`AssetStatusBadge`/semantic tokens; zero new hex |
| 6 | Decorative background competes with data | `.theme-clarity[-dark] .ab-* { display: none }`, verified live (`display:none` on all 4 layers) |
| 7 | Translucent floating surfaces | Clarity menus/modals/popovers opaque; earlier `4131187` fixed Select + notifications globally |
| 8 | Mobile shell consistency | `fbe84da` presentation-only Layout/BottomNav sweep; positioning/z-index/safe-area preserved |

Supporting commits: `5e82509` (registry + backend allowlist), `b7780d6` (tokens +
contrast guards), `d948e22` (Clarity login), `e197b92` (FOUC + pickers + routing).

## Browser verification matrix

Backend `:8080` (rebuilt with 12-theme allowlist) + frontend `:5199`, demo account.

| Route | Clarity | Clarity Dark | Notes |
|---|---|---|---|
| /login | ✅ screenshot | n/a (shared skin) | Opaque 400px card, no glass/aurora |
| / | ✅ screenshot | ✅ screenshot | One h1, tabular KPIs, EmptyState activity |
| /assets | ✅ screenshot | ✅ probed | FilterBar, mono tags, readable badges |
| /tickets | ✅ screenshot | — | FilterBar, opaque badges, no bleed |
| /cmdb | ✅ screenshot | — | Same quirks as Paper (pre-existing, see below) |
| /reports | — | ✅ screenshot | FilterBar + EmptyState, no overflow |
| /audit | — | ✅ probed | One h1, table renders |
| /onboarding | — | ✅ probed | h1 “Onboarding / Offboarding”, no overflow |
| /licenses | — | ✅ probed | h1 + KPIs, no overflow |
| /settings | — | ✅ probed | h1 + OAuth form intact |
| /requests | — | ✅ probed | h1 + EmptyState + action |
| /kb | — | ✅ probed | h1 + type pills + search |
| /warranty | — | ✅ probed | h1 + EmptyState |
| /account | — | ✅ probed | h1 + password form |

Probes: `overflowX === 0`, exactly one `main h1`, theme persists across full
reloads. Modal check: New Ticket dialog opaque, `backdrop-filter: none`,
readable in Clarity Dark (screenshot).

Screenshots: `docs/superpowers/specs/assets/clarity/`.

## Issues found during closeout (fixed)

1. **Clarity surfaces inherited the liquid-glass SVG refraction filter.** The
   `:not()` exclusion selectors predated Clarity, and their specificity beat the
   Clarity `backdrop-filter: none` rule. Fixed in `9b2c8e0` with a regression
   test asserting every `url(#itms-liquid-glass-refract)` selector excludes both
   Clarity classes. Verified live: computed `backdrop-filter: none`, no specular
   layers, no filter bank in Clarity Dark.
2. **Running backend predated the 12-theme allowlist.** The dev server binary was
   started before the Task 1 commit, so it rejected `clarity`/`clarity-dark`
   pushes and navigation re-hydrated the old server theme. Fixed by rebuilding
   and restarting the backend; round-trip verified afterward. (Deployment note:
   backend and frontend must ship together.)

## Pre-existing issues (not Clarity regressions, left for follow-up)

Verified identical in Paper theme (`paper-cmdb-comparison.png`):
- CMDB CI table shows 2 of 10 rows in view with “Showing 1–10 of 10”.
- CMDB Name column truncates without ellipsis/tooltip.
- CMDB pagination footer wraps to two lines in the narrow container.
- CMDB Relationships list is global, not filtered to the selected CI.
- Assets table header casing mixes Title Case (sortable) with ALL-CAPS
  (non-sortable); sort affordance is faint.
- Assets LOCATION column is entirely empty (10/10 `—`).

## Open product question (unchanged from plan)

Whether Clarity should become the default for new users. Default remains `paper`;
changing it needs a product decision plus backend migration and FOUC/default-test
updates.
