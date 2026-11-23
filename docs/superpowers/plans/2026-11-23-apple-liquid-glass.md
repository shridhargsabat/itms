# Apple Liquid Glass Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the exact Apple Liquid Glass Day/Night theme from the reference (ambient orbs, specular panels, floating shell, Bento dashboard with real 7d/30d velocity chart) across the ITMS frontend, adding one read-only backend endpoint to power the chart.

**Architecture:** New `GET /dashboard/velocity` endpoint (zero-fill time series from tickets + TICKET_STATUS audit rows, no migration); new `liquid-glass-*` CSS classes scoped to glass themes only (light/dark/system-resolved) with token-surface fallbacks for the other 9 themes; Dashboard rebuilt as reference-exact Bento on live TanStack Query; Recharts for the velocity row.

**Tech Stack:** React 19, Vite, TypeScript strict, Tailwind v4, TanStack Query, react-router 7, lucide-react, recharts 3.x + react-is, vitest + RTL + jsdom; Rust 1.85+, axum 0.8, sqlx 0.9, PostgreSQL 18.

**Spec:** `docs/superpowers/specs/apple-liquid-glass/spec.md` (owner prompt; binding, except §2 backend freeze is LIFTED per owner 2026-11-23: additive backend changes allowed) + visual reference `docs/superpowers/specs/apple-liquid-glass/AppleLiquidGlassDashboard.ref.tsx` (PIXEL AUTHORITY for all glass-theme visuals; its sample data + local day/night state + internal nav are demo scaffolding — rewire to live queries + `setThemeMode` + react-router).

## Global Constraints

- Backend additive-only: new endpoint + new models allowed; NO migrations (no schema change needed), NO edits to existing handlers/SQL, NO changes to existing response shapes.
- `frontend/src/api/types.ts`: ADDITIVE ONLY (new `Velocity*` interfaces); existing contracts untouched.
- Routes frozen: all 17 protected + 4 public routes keep path, element, and guards (`frontend/src/main.tsx` untouched).
- No new `ThemeMode` values: Day/Night toggle = `setThemeMode('light' | 'dark')` only; `index.html` FOUC script untouched.
- No other theme may visually change: paper, console, bold, shell, terminal, clarity, clarity-dark, ledgerly, ledgerly-light stay pixel-identical (additive-only CSS, glass-scope guards).
- Fixed Apple hexes (`#007AFF #0A84FF #0066D6 #34C759 #FF9500 #FF3B30 #AF52DE`) appear ONLY under glass-scope selectors or glass-only components — never in `Button.tsx` recipes, never as bare utilities in shared components.
- Node 22 toolchain; `npx vitest run` + `npm run build` must pass after every frontend task; `cargo check` (+ `--release` at the end) after the backend task.
- Every new/edited test file: explicit `afterEach(cleanup)` import from `@testing-library/react` (repo-wide auto-cleanup is OFF).
- Conventional commits: `feat(frontend): ...` / `fix(frontend): ...`, one task = commits prefixed with task number in body.

## Review Focus

- Empty metrics/buckets (older backend, zero rows): chart, queue, expiring stack render empty states, never crash — pinned by tests in Tasks 8, 9.
- Non-ADMIN user: Quick Capture invoice hidden, service queue + KPIs still render — pinned by tests in Tasks 5, 9.
- jsdom zero-size containers: Recharts must render in tests via the ResizeObserver + clientWidth stub in Task 8 (never `if (test)` branches in prod code).
- 375px overflow: long titles/tags truncate, queue/drawer never cause horizontal scroll — pinned by class assertions in Tasks 7, 9.
- Reduced motion/transparency: orbs static, glass falls back to solid surfaces — pinned by guard-selector tests in Task 3 (CSS text assertions).

---

### Task 1: Recharts dependency + dashboard data helpers

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json` (via npm, never hand-edited)
- Create: `frontend/src/lib/chartData.ts`
- Create: `frontend/src/lib/chartData.test.ts`

**Interfaces:**
- Produces: `topExpiringAlerts(alerts: WarrantyAlert[], n: number): WarrantyAlert[]` (days_left asc, nulls last, expired (d<0) first; take n)
- Produces: `licenseDaysLeft(expiry_date: string | null): number | null` (same math as `daysLeft` in `src/views/Licenses.tsx:47`)
- Consumes: nothing (pure helpers over `WarrantyAlert` from `@/api/types`)

- [ ] **Step 1: Read test harness conventions**

Read `frontend/vitest.config.ts` and `frontend/src/components/ThemeManager.test.tsx` (query-wrapper + mock patterns to copy).

- [ ] **Step 2: Write the failing test** (`frontend/src/lib/chartData.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { licenseDaysLeft, topExpiringAlerts } from './chartData';

describe('chartData', () => {
  it('sorts expiring alerts by days_left, nulls last', () => {
    const rows = topExpiringAlerts([
      { id: 'a', days_left: null } as never,
      { id: 'b', days_left: 12 } as never,
      { id: 'c', days_left: -2 } as never,
    ], 5).map((r) => r.id);
    expect(rows).toEqual(['c', 'b', 'a']);
  });
  it('computes license days-left like Licenses view', () => {
    expect(licenseDaysLeft(null)).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/chartData.test.ts`
Expected: FAIL with "Failed to resolve import ./chartData".

- [ ] **Step 4: Install recharts + react-is (React 19 line)**

Run: `cd frontend && npm install recharts react-is`
Expected: `recharts@3.x` in package.json (peer `react ^19` satisfied — verified upstream), lockfile updated, no peer warnings for react 19.

- [ ] **Step 5: Implement `chartData.ts`** (four pure functions per Interfaces; `licenseDaysLeft` mirrors `Licenses.tsx` daysLeft day-math exactly)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/chartData.test.ts`
Expected: 2 passed.

- [ ] **Step 7: Full gates**

Run: `cd frontend && npx vitest run` then `npm run build`
Expected: all green, clean build.

- [ ] **Step 8: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/lib/chartData.ts frontend/src/lib/chartData.test.ts
git commit -m "feat(frontend): add recharts + chart data helpers

Task 1: recharts 3.x (React 19) + pure expiry mappers."
```

### Task 2: Backend velocity endpoint + frontend contract (additive, no migration)

**Files:**
- Modify: `backend/src/routes/dashboard.rs` (add `.route("/velocity", get(velocity))` + handler; existing `/metrics` untouched)
- Modify: `backend/src/models.rs` (ADD: `VelocityPoint { day: String, incidents: i64, requests: i64, resolved: i64 }`, `VelocityResponse { range: String, points: Vec<VelocityPoint> }` — Serialize; touch nothing else)
- Modify: `frontend/src/api/types.ts` (ADD: `VelocityPoint`, `VelocityResponse` interfaces; touch nothing else)
- Modify: `frontend/src/api/client.ts` (ADD: `getVelocity(range: '7d' | '30d')` via the file's existing `apiFetch` helper → `GET /dashboard/velocity?range=`; touch nothing else)

**Interfaces:**
- `GET /api/v1/dashboard/velocity?range=7d|30d` → `{ range, points }`; absent range defaults `7d`; unknown range → 400 via existing `AppError` (read `routes/mod.rs` for the error type first).
- 7d: 7 rows, calendar days today-6..today, `day` = `to_char(d, 'Dy')`.
- 30d: 4 rows, 7-day buckets ending today, `day` = `Wk 1`..`Wk 4` oldest→newest.
- incidents = COUNT tickets `ticket_type='INCIDENT'` by `created_at::date`; requests = `ticket_type='SERVICE_REQUEST'` by `created_at::date`; resolved = COUNT audit_logs `action='TICKET_STATUS' AND target_type='ticket' AND diff->>'to' IN ('RESOLVED','CLOSED')` by `created_at::date`.
- Day spine via `generate_series` + LEFT JOIN counts (zero-fill idle days). Auth: same as `/metrics` (inherits router middleware — verify, do not add).
- Produces for Task 8: `getVelocity` + `['velocity', range]` query key.

- [ ] **Step 1: Read `routes/mod.rs` (AppError + auth wiring), `models.rs` dashboard structs, `client.ts` apiFetch helper.**

- [ ] **Step 2: Implement backend models + route + handler** per Interfaces (runtime `sqlx::query_as`, same style as `metrics`).

- [ ] **Step 3: Add frontend `Velocity*` interfaces + `getVelocity`.**

- [ ] **Step 4: Backend gates** — `cargo check` then `cargo check --release` (CI parity) from `backend/`, both clean. If a local postgres with the ITMS schema is reachable, also run the two SELECTs by hand to validate syntax; otherwise flag SQL as reviewer-verified in the report.

- [ ] **Step 5: Frontend gates** — `cd frontend && npx vitest run` then `npm run build`, all green (contract compiles).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/dashboard.rs backend/src/models.rs frontend/src/api/types.ts frontend/src/api/client.ts
git commit -m "feat(backend): add dashboard velocity endpoint

Task 2: GET /dashboard/velocity?range=7d|30d (additive, no migration)
+ frontend Velocity contract."
```

### Task 3: Liquid glass CSS tokens (glass-scoped + fallbacks + guards)

**Files:**
- Modify: `frontend/src/index.css` (append new section; never edit existing blocks)
- Create: `frontend/src/index.css.test.ts` (CSS-text guard assertions via `fs.readFileSync`)

**Interfaces:**
- Produces classes: `.liquid-glass-panel` (radius 26px), `.liquid-glass-subcard` (radius 20px), `.liquid-glass-pill` (radius 9999px), `.liquid-glass-btn-primary` (gradient `#0A84FF`→`#0066D6`, `inset 0 1px 1px rgba(255,255,255,0.5)`, radius full)
- Spec values: Day panel `rgba(255,255,255,0.50)` + `blur(40px) saturate(160%)` + `1px solid rgba(255,255,255,0.78)` + `inset 0 1.5px 1px rgba(255,255,255,0.95), 0 12px 36px rgba(15,23,42,0.08)`; Day subcard `rgba(255,255,255,0.62)` / `rgba(255,255,255,0.85)` / `inset 0 1px 0 rgba(255,255,255,0.92), 0 4px 14px rgba(15,23,42,0.04)`; Day pill `rgba(255,255,255,0.62)` + `blur(24px) saturate(150%)` + `rgba(255,255,255,0.85)` border + `inset 0 1px 0 rgba(255,255,255,0.95), 0 6px 20px rgba(15,23,42,0.06)`; `.dark` overrides per spec §3B (panel `rgba(255,255,255,0.09)`/`rgba(255,255,255,0.20)`/`inset 0 1px 1px rgba(255,255,255,0.35), 0 16px 40px rgba(0,0,0,0.45)`; subcard `0.07/0.15/inset 0 1px 0 rgba(255,255,255,0.20)`; pill `0.10/0.20/inset 0 1px 0 rgba(255,255,255,0.30)`); btn-primary hover `:brightness(1.06)`, active `:scale(0.98)`.
- Glass scope: Day rules prefixed with the light guard copied verbatim from the refraction selectors (`:root:not(.dark):not(.theme-paper):not(.theme-console):not(.theme-bold):not(.theme-shell):not(.theme-terminal):not(.theme-clarity):not(.theme-clarity-dark):not(.ledgerly-dark):not(.ledgerly-light)`); Night rules under `.dark:not(.theme-console):not(.theme-bold):not(.theme-terminal):not(.theme-clarity):not(.theme-clarity-dark):not(.ledgerly-dark)`.
- Non-glass fallback: for each of `.theme-paper .theme-console .theme-bold .theme-shell .theme-terminal .theme-clarity .theme-clarity-dark .ledgerly-dark .ledgerly-light`, the four classes resolve to token surfaces (`background: var(--t-surface)`, `border: 1px solid var(--t-edge)`, same radii, no backdrop-filter); btn-primary fallback = `background: var(--t-accent); color: #fff`.
- Consumes: nothing.

- [ ] **Step 1: Write the CSS-text test** (`frontend/src/index.css.test.ts`)

Assert the css file text contains: `.liquid-glass-panel`, `.liquid-glass-subcard`, `.liquid-glass-pill`, `.liquid-glass-btn-primary`, the light `:not(.theme-paper)` guard chain, the dark guard chain, all 9 fallback scopes, and the four class names inside the `prefers-reduced-transparency` guard block.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/index.css.test.ts`
Expected: FAIL (classes absent).

- [ ] **Step 3: Append the glass token section to `src/index.css`** (after the refraction block, before `@layer base`); extend the existing `prefers-reduced-transparency` selector list and the `@media print` glass rule with the four new classes (same declarations as `.glass-card` there).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/index.css.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gates**

Run: `cd frontend && npx vitest run` then `npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/index.css frontend/src/index.css.test.ts
git commit -m "feat(frontend): add glass-scoped liquid-glass tokens

Task 3: panel/subcard/pill/btn-primary under glass guards + token
fallbacks for the 9 non-glass themes + transparency/print guards."
```

### Task 4: Ambient orbs + BentoCard glass geometry

**Files:**
- Modify: `frontend/src/components/AnimatedBackground.tsx`
- Modify: `frontend/src/components/BentoCard.tsx`
- Create: `frontend/src/components/GlassShell.test.tsx`

**Interfaces:**
- Consumes: Task 3 classes.
- Produces: `AnimatedBackground` renders `.ab-glass-orbs` (3 fixed orbs, `data-testid="glass-orb"`) visible only under glass scope (CSS-gated via the Task 2 guard chains + `.dark` variants; other themes hide via `display:none` under their 9 classes); `BentoCard` root carries `liquid-glass-panel rounded-[26px] hover:-translate-y-0.5` while keeping the `LiquidGlassSurface variant="card" interactive` wrapper and all props.

- [ ] **Step 1: Write the failing test** (`GlassShell.test.tsx`, explicit `afterEach(cleanup)`)

Render `<AnimatedBackground/>`: expect 3 `glass-orb` nodes. Render `<BentoCard>hi</BentoCard>`: expect `liquid-glass-panel`, `rounded-[26px]`, `hover:-translate-y-0.5` classes and `data-liquid-glass="active"` present when theme is glass (mock `localStorage itms_theme=light` + matchMedia light).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/GlassShell.test.tsx`
Expected: FAIL (orbs + classes absent).

- [ ] **Step 3: Implement orbs** — Day orbs: `rgba(56,189,248,0.45)` top-left, `rgba(129,140,248,0.35)` center-right, `rgba(253,164,175,0.38)` bottom-center; Night orbs: `rgba(14,165,233,0.28)`, `rgba(124,58,237,0.28)`, `rgba(45,212,191,0.18)`; each `pointer-events-none fixed rounded-full blur-[80px]`, sizes ~480/520/460px per reference; canvas gradient on `body` via glass-scope CSS (`linear-gradient(135deg,#DCEBFF 0%,#EEF2FF 50%,#FCE7F3 100%)` day, `linear-gradient(135deg,#0B1226 0%,#131836 50%,#0A192F 100%)` night). Keep existing mesh/blobs/grid/particles untouched (other themes rely on them).

- [ ] **Step 4: Implement BentoCard geometry** — add the three classes via `cn()`; nothing else changes.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/GlassShell.test.tsx`
Expected: PASS.

- [ ] **Step 6: Full gates** (`npx vitest run`, `npm run build`) — all green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/AnimatedBackground.tsx frontend/src/components/BentoCard.tsx frontend/src/components/GlassShell.test.tsx frontend/src/index.css
git commit -m "feat(frontend): ambient glass orbs + BentoCard geometry

Task 4: 3-orb refracting backdrop (glass scope) + BentoCard
liquid-glass-panel rounded-[26px] hover lift."
```

### Task 5: Floating shell — sidebar capsule, nav pills, Quick Capture, BottomNav

**Files:**
- Modify: `frontend/src/components/Layout.tsx`
- Modify: `frontend/src/components/SidebarNav.tsx`
- Modify: `frontend/src/components/BottomNav.tsx`
- Modify: `frontend/src/index.css` (append: nav-pill active overrides + dock styles, glass-scoped)
- Create: `frontend/src/components/QuickCapture.tsx`
- Create: `frontend/src/components/FloatingShell.test.tsx`

**Interfaces:**
- Consumes: Task 3 classes.
- Produces: `QuickCapture({ wide }: { wide: boolean })` — glass dock; Invoice button (FileSpreadsheet icon, admin-only via `getCachedUser()?.role`) opens `Modal` + `AddAssetForm` (same as AddAssetButton); Scan button (QrCode icon) `navigate('/scan')`; collapsed rail renders icon-only stack with titles.
- Sidebar geometry (lg+ only): aside keeps `aside` element + `glass-chrome` class, gains `lg:left-4 lg:top-4 lg:bottom-4 lg:rounded-[28px]`; main margins become `lg:ml-[5.5rem]` collapsed / `lg:ml-[16.5rem]` wide; hover-peek, collapse toggle, user card, footer, ThemeToggle all preserved.
- Nav pills: `SidebarNav` rowBase `rounded-lg`→`rounded-full`; glass-scope CSS: day active link `color:#007AFF` on frosted pill, night active `bg-white/20` luminous pill (other themes: token behavior unchanged).
- BottomNav floating: bar `fixed inset-x-0 bottom-0 ... border-t` → `fixed inset-x-4 bottom-4 rounded-[26px] border glass-chrome lg:hidden` (keep flush-content rule: no extra safe-area padding on bar); More sheet → `inset-x-4 bottom-4 rounded-[26px]` panel.

- [ ] **Step 1: Write the failing test** (`FloatingShell.test.tsx`, `afterEach(cleanup)`, MemoryRouter wrapper)

Render `<Layout/>` route shell? (heavy) — instead render `SidebarNav wide`, `QuickCapture wide`, `BottomNav` directly + a Layout aside-geometry assertion via `render(<Layout/>)` with mocked `Outlet`? Keep it light: assert QuickCapture invoice opens Modal w/ AddAssetForm for admin + hidden for non-admin; Scan navigates `/scan`; BottomNav root has `rounded-[26px] inset-x-4`; SidebarNav active link has `rounded-full`. Layout geometry asserted in Task 10 diff audit + existing e2e-less suite.

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/components/FloatingShell.test.tsx`, FAIL (QuickCapture missing).

- [ ] **Step 3: Implement `QuickCapture.tsx`** per Interfaces (copy AddAssetButton's modal pattern verbatim).

- [ ] **Step 4: Implement Layout/SidebarNav/BottomNav geometry + CSS overrides** per Interfaces.

- [ ] **Step 5: Run test to verify it passes.**

- [ ] **Step 6: Full gates** (`npx vitest run`, `npm run build`) — all green.

- [ ] **Step 7: Commit** (all Task 5 files).

### Task 6: Pills, badges, modal, frosted table rows

**Files:**
- Modify: `frontend/src/components/SlaChip.tsx` (shape only: `rounded`→`rounded-full`, `px-1.5`→`px-2.5`)
- Modify: `frontend/src/components/Modal.tsx` (panel `sm:rounded-xl`→`sm:rounded-[26px]`, `rounded-t-2xl`→`rounded-t-[26px]`, add `liquid-glass-panel`; scrim keeps `backdrop-blur-sm`)
- Modify: `frontend/src/components/DataTable.tsx` (row hover `hover:bg-surface`→ frosted `hover:bg-white/40 dark:hover:bg-white/10` — verify current row class on line ~311 first; keep selection/checkbox/sort logic identical)
- Modify: `frontend/src/index.css` (append: glass-scope Apple semantic overrides for badges — URGENT `#FF3B30`, HIGH `#FF9500`, MEDIUM `#007AFF`, OPEN `#007AFF`, IN_PROGRESS `#FF9500`, RESOLVED `#34C759` — as tinted pill text/border overrides; base token classes in `TicketBadge.tsx` UNTOUCHED)
- Create: `frontend/src/components/GlassPrimitives.test.tsx`

**Interfaces:**
- Consumes: Task 3 guards. Produces: no new exports; visual-only changes.

- [ ] **Step 1: Write the failing test** — SlaChip renders `rounded-full`; Modal panel has `liquid-glass-panel` + `sm:rounded-[26px]`; DataTable row hover class present; CSS text contains the 6 glass badge overrides.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** per Files (TicketBadge.tsx itself NOT edited — overrides live in CSS).

- [ ] **Step 4: Run → PASS. Step 5: Full gates green. Step 6: Commit.**

### Task 7: Dashboard Bento shell — toolbar, Day/Night toggle, KPI lenses

**Files:**
- Modify: `frontend/src/views/Dashboard.tsx`
- Create: `frontend/src/views/Dashboard.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–6, `getDashboardMetrics` (`['metrics']`), `getCachedUser`, `AddAssetButton`, existing `NewTicketForm`/`CountUp` (keep, move into toolbar/modal as today).
- Produces: toolbar = `liquid-glass-panel rounded-[26px]` header with Day/Night segmented pill (`setThemeMode('light'|'dark')`, state via `getResolvedTheme()` + `onThemeChanged`), `AddAssetButton`, New Ticket trigger with `liquid-glass-btn-primary` (opens existing modal); 4 KPI lenses exactly (whole lens = `Link`, visual identical to reference): Total Assets `asset_count` + `${in_stock_count} in stock` (`#007AFF`, Monitor), Open Tickets `open_tickets` + `${high_priority_count} high priority` (`#AF52DE`, Ticket), SLA Escalated `overdue_tickets` (`#FF3B30`, AlertTriangle), Warranty & License `warranty_alerts_count + license_alerts` + `Expiring ≤ 45d` (`#FF9500`, ShieldCheck); secondary pills: `onboarding_overdue`→`/onboarding`, `open_requests`→`/requests`. Keep: metrics error banner, KPI `CountUp`, sticky behavior (`sticky top-... z-30` preserved on toolbar), Recent Activity + OverdueTickets sections untouched (moved below new rows).

- [ ] **Step 1: Write the failing test** (mock `getDashboardMetrics` with all 11 fields; MemoryRouter + QueryClient wrapper): KPIs show values, Day/Night buttons call `setThemeMode`, secondary pills link correctly, long titles truncate (`truncate` class present).

- [ ] **Step 2: Run → FAIL. Step 3: Implement** toolbar + KPI grid (`grid-cols-2 xl:grid-cols-4`), keep everything else. **Step 4: Run → PASS. Step 5: Full gates. Step 6: Commit.**

### Task 8: Analytics row — velocity chart + Expiring Soon stack

**Files:**
- Create: `frontend/src/components/VelocityChart.tsx`
- Create: `frontend/src/components/ExpiringSoon.tsx`
- Modify: `frontend/src/views/Dashboard.tsx` (insert 8/4 row: `xl:grid-cols-12`, chart `xl:col-span-8`, stack `xl:col-span-4`)
- Create: `frontend/src/components/AnalyticsRow.test.tsx`

**Interfaces:**
- Consumes: Task 2 `getVelocity` (`['velocity', range]`), Task 1 `topExpiringAlerts` + `licenseDaysLeft`, `getWarrantyAlerts('expiring')` (`['alerts','expiring']`), `getLicenses({ scope: 'expiring', limit: 5 })` (`['licenses','expiring']`).
- Produces: `VelocityChart()` — `liquid-glass-panel rounded-[28px]`, `7d`/`30d` toggle pills (exact reference behavior), Recharts `AreaChart` (`h-60`, two areas: `resolved` stroke `#34C759` fill `url(#algGreen)`, `incidents` stroke `#007AFF` fill `url(#algBlue)`, gradient defs + CartesianGrid/XAxis(day)/YAxis/Tooltip per reference); empty points → `EmptyState`. `ExpiringSoon()` — `${n} Alerts` pill, warranty rows (top 5, `Xd` countdown pill `#FF9500`) + license rows (name + `Xd` via `licenseDaysLeft`), `Open CMDB Impact Lens →` button navigating `/cmdb`; empty → `EmptyState`.

- [ ] **Step 1: Write the failing test** — ResizeObserver + clientWidth/clientHeight stubs (standard recharts-jsdom recipe), mocked queries; assert 7d/30d toggle refetches with new range, areas render, expiring rows + countdown pills render, empty states on `[]`.

- [ ] **Step 2: Run → FAIL. Step 3: Implement** both components + Dashboard wiring. **Step 4: Run → PASS. Step 5: Full gates. Step 6: Commit.**

### Task 9: Live service queue + inspect slide-over

**Files:**
- Create: `frontend/src/components/ServiceQueue.tsx`
- Modify: `frontend/src/views/Dashboard.tsx` (queue section below analytics row, above Recent Activity)
- Create: `frontend/src/components/ServiceQueue.test.tsx`

**Interfaces:**
- Consumes: `listTickets({ limit: 25 })` (`['service-queue']`, `refetchInterval: 60_000`), `patchTicketStatus(id, status)` + invalidate `['service-queue'], ['tickets'], ['metrics']`.
- Produces: `ServiceQueue()` — `liquid-glass-panel rounded-[28px]`; filter input (matches title/number/asset_tag, client-side); rows = OPEN/IN_PROGRESS only, `PriorityBadge` + `SlaChip`, `truncate` titles; click → right slide-over (`fixed inset-y-0 right-0 w-full max-w-md liquid-glass-panel`, scrim `bg-black/40 backdrop-blur-sm`, Escape/backdrop close): ticket_number/title/description/badges/SLA, status `Select` (OPEN/IN_PROGRESS/RESOLVED/CLOSED → mutation + toast-free inline confirm), `Open in Service Desk →` link to `/tickets`; empty → `EmptyState`.

- [ ] **Step 1: Write the failing test** — mocked `listTickets`; filter narrows rows; click opens drawer (`ticket_number` visible); status change calls `patchTicketStatus` with new status; non-admin sees queue (no admin gate on this query).

- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run → PASS. Step 5: Full gates. Step 6: Commit.**

### Task 10: Tickets/Assets/Warranty/CMDB glass pass

**Files:**
- Modify: `frontend/src/views/CMDB.tsx` (root header tag + `cmdb-root-tag` class → glass-scope `#007AFF`; depth badge + `cmdb-depth` class → glass-scope `#AF52DE` `DEPTH n` pill; panels `rounded-xl glass-card`→ add `liquid-glass-panel rounded-[26px]`; CI list buttons `rounded-lg`→`rounded-[18px]`; NOTHING else)
- Modify: `frontend/src/views/Tickets.tsx`, `frontend/src/views/Assets.tsx`, `frontend/src/views/Warranty.tsx` (class-only: cards/panels gain `liquid-glass-panel`/`liquid-glass-subcard` alongside existing token classes; no logic, prop, or query changes)
- Modify: `frontend/src/index.css` (append `cmdb-root-tag`/`cmdb-depth` glass-scope rules)
- Create: `frontend/src/views/CMDBGlass.test.tsx`

**Interfaces:** Consumes Tasks 3, 6. Produces no new exports.

- [ ] **Step 1: Write the failing test** — mocked `getTopology`/`getImpact`; root tag carries `cmdb-root-tag`, depth badge `cmdb-depth`, panels carry `liquid-glass-panel`.

- [ ] **Step 2: Run → FAIL. Step 3: Implement** (read each view first; minimal diffs). **Step 4: Run → PASS. Step 5: Full gates. Step 6: Commit.**

### Task 11: Verification sweep (no prod code)

**Files:** none (evidence only).

- [ ] **Step 1: Full suite** — `cd frontend && npx vitest run` → 0 failures.
- [ ] **Step 2: Typecheck + build** — `npm run build` → 0 TS errors, clean Vite build.
- [ ] **Step 3: Backend gate** — `cd backend && cargo check --release` → clean.
- [ ] **Step 4: Diff audit** — `git diff --stat origin/main`: frontend changes + `backend/src/routes/dashboard.rs` + `backend/src/models.rs` + `docs/superpowers/**` ONLY; no migrations, no `main.tsx`, no `index.html`, no existing-handler edits. `git diff origin/main -- backend/migrations frontend/src/main.tsx frontend/index.html` must be empty.
- [ ] **Step 5: Scope-leak grep** — fixed Apple hexes occur only in `index.css` glass-scope blocks or glass-only components: `grep -rn "#007AFF\|#AF52DE\|#FF3B30\|#FF9500\|#34C759\|#0A84FF" frontend/src --include=*.tsx | grep -v "VelocityChart\|ServiceQueue\|ExpiringSoon\|QuickCapture\|Dashboard"` must be empty (Dashboard-family components are glass-scoped by the Task 3 fallbacks).
- [ ] **Step 6: Record evidence** — commit nothing; append results to the SDD ledger (controller duty).
