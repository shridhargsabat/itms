# PROMPT.md — Upgrade `shridhargsabat/itms` Frontend to Modern Apple Liquid Glass UI/UX

## 1. Objective
Redesign and upgrade the frontend UI/UX of `shridhargsabat/itms` to a **Modern Apple Liquid Glass** (macOS Tahoe / visionOS-inspired) design system supporting both **Day Glass (`light`)** and **Night Glass (`dark`)** modes, while preserving **100% of existing routes, TanStack Query data hooks, forms, modals, and Rust/Axum API contracts**.

Use the accompanying reference file `AppleLiquidGlassDashboard.tsx` as the visual and structural north star for surfaces, radii, specular highlights, spacing, and interactive polish.

---

## 2. Pinned Tech Stack & Hard Boundaries
- **Frontend**: React 19, Vite, TypeScript (strict), Tailwind CSS v4, TanStack Query, `react-router` 7, `lucide-react` (and `recharts` if already installed or lightweight SVG/Recharts charts).
- **Backend (DO NOT MODIFY)**: Rust 1.85+, `axum` 0.8, `sqlx` 0.9, PostgreSQL 18. Do **not** alter API routes, SQL migrations, or `frontend/src/api/types.ts` contracts.
- **Keep All Protected Routes Intact**: `/`, `/assets`, `/warranty`, `/onboarding`, `/notifications`, `/requests`, `/licenses`, `/tickets`, `/cmdb`, `/audit`, `/masters`, `/settings`, `/offline`, `/account`, `/kb`, `/reports`, `/scan`, `/labels`, plus public auth routes (`/login`, `/forgot-password`, `/reset-password`, `/oauth/callback`).

---

## 3. Apple Liquid Glass Design System Specification

### A. Ambient Refracting Backdrop (`frontend/src/components/AnimatedBackground.tsx` & `frontend/src/index.css`)
Real Liquid Glass requires luminous color underneath so `backdrop-filter` refracts naturally:
- **Day Glass (`light` default)**:
  - Canvas base: `linear-gradient(135deg, #DCEBFF 0%, #EEF2FF 50%, #FCE7F3 100%)`
  - 3 soft fixed blurred mesh orbs (`pointer-events: none`, `filter: blur(80px)`):
    - Top-left: `rgba(56, 189, 248, 0.45)` (Sky)
    - Center-right: `rgba(129, 140, 248, 0.35)` (Indigo)
    - Bottom-center: `rgba(253, 164, 175, 0.38)` (Soft Rose)
- **Night Glass (`dark`)**:
  - Canvas base: `linear-gradient(135deg, #0B1226 0%, #131836 50%, #0A192F 100%)`
  - 3 subtle fixed blurred mesh orbs:
    - Top-left: `rgba(14, 165, 233, 0.28)`
    - Center-right: `rgba(124, 58, 237, 0.28)`
    - Bottom-center: `rgba(45, 212, 191, 0.18)`
- Respect `@media (prefers-reduced-motion: reduce)` and keep GPU layer cost minimal (static or very slow CSS transforms only).

### B. Specular Glass Surface Tokens (`frontend/src/index.css`)
Define reusable CSS custom properties + utility classes in `frontend/src/index.css` so every view inherits the exact same Liquid Glass feel:

```css
/* Day Glass (light) */
.liquid-glass-panel {
  background: rgba(255, 255, 255, 0.50);
  backdrop-filter: blur(40px) saturate(160%);
  -webkit-backdrop-filter: blur(40px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.78);
  box-shadow:
    inset 0 1.5px 1px rgba(255, 255, 255, 0.95),
    0 12px 36px rgba(15, 23, 42, 0.08);
  border-radius: 26px;
}

.liquid-glass-subcard {
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 4px 14px rgba(15, 23, 42, 0.04);
  border-radius: 20px;
}

.liquid-glass-pill {
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.95),
    0 6px 20px rgba(15, 23, 42, 0.06);
  border-radius: 9999px;
}

/* Night Glass (dark) */
.dark .liquid-glass-panel {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 255, 255, 0.20);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.35),
    0 16px 40px rgba(0, 0, 0, 0.45);
}

.dark .liquid-glass-subcard {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.15);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.20);
}

.dark .liquid-glass-pill {
  background: rgba(255, 255, 255, 0.10);
  border-color: rgba(255, 255, 255, 0.20);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.30);
}
```

### C. Apple System Accent Palette
- Primary Action / Active Accent: `#007AFF` (gradient `#0A84FF` → `#0066D6` with top specular rim `inset 0 1px 1px rgba(255,255,255,0.5)`)
- Healthy / Resolved / SLA Met: `#34C759`
- Warning / Warranty Expiring / High Priority: `#FF9500`
- Critical / Overdue SLA / Urgent: `#FF3B30`
- CMDB / Licenses / Secondary Accent: `#AF52DE`

---

## 4. File-by-File Implementation Plan

1. **`frontend/src/index.css`**
   - Add the `.liquid-glass-panel`, `.liquid-glass-subcard`, `.liquid-glass-pill`, and `.liquid-glass-btn-primary` classes for both Day (`light`) and Night (`dark`) modes while keeping existing `ledgerly` / `ledgerly-light` theme hooks unbroken in `ThemeManager.tsx`.
2. **`frontend/src/components/AnimatedBackground.tsx`**
   - Render the 3-orb refracting ambient wallpaper behind the app shell (adapting to `light` Day Glass and `dark` Night Glass).
3. **`frontend/src/components/BentoCard.tsx`**
   - Upgrade `BentoCard` to use `.liquid-glass-panel` (`rounded-[26px]`, subtle hover elevation `hover:-translate-y-0.5 transition-transform`).
4. **`frontend/src/components/Layout.tsx`, `SidebarNav.tsx`, `BottomNav.tsx`**
   - Convert the desktop sidebar into a **floating rounded-[28px] Liquid Glass capsule** with generous outer padding (`p-4 lg:p-6 gap-6`).
   - Style active navigation links as floating frosted pills (`rounded-full`) with `#007AFF` active text/icon in Day mode and luminous `bg-white/20` glass pill in Night mode.
   - Preserve grouped navigation tree, collapsed rail toggle, `NotificationsBell`, `ThemeToggle`, `OfflineBanner`, and mobile `BottomNav` + More sheet styled as floating glass capsules.
   - Add a **Quick Capture** glass dock at the bottom of the sidebar linking to `InvoiceAssetUpload` and `/scan`.
5. **`frontend/src/components/SlaChip.tsx`, `TicketBadge.tsx`, `Button.tsx`, `Modal.tsx`, `DataTable.tsx`**
   - Update chips and badges to `rounded-full` Apple pill proportions with high-contrast semantic colors.
   - Upgrade `Modal.tsx` to use `.liquid-glass-panel` with `backdrop-blur-md` scrim.
   - Upgrade `DataTable.tsx` rows to spacious frosted hover rows (`rounded-[18px]` / clean subtle translucent dividers) with `ScrollX` preserved for mobile.
6. **`frontend/src/views/Dashboard.tsx`**
   - Implement the Bento layout from `AppleLiquidGlassDashboard.tsx` wired to the live `DashboardMetrics` TanStack Query endpoint:
     - Top floating glass toolbar with inline **Day / Night Glass** quick toggle (wired to `ThemeManager`), `+ Add Asset` (`AddAssetButton`), and `+ New Ticket`.
     - 4 primary KPI glass lenses (`asset_count` + `in_stock_count`, `open_tickets` + `high_priority_count`, `overdue_tickets`, `warranty_alerts_count` + `license_alerts`) plus secondary pills for `onboarding_overdue` and `open_requests`.
     - 8/4 asymmetric analytics row: Ticket velocity / `tickets_by_priority` & `assets_by_status` chart inside a `rounded-[28px]` glass panel + **Expiring Soon** Warranty/License countdown glass stack.
     - Live Priority Service Queue with instant filter input and click-to-inspect slide-over / route navigation.
7. **`frontend/src/views/Tickets.tsx`, `Assets.tsx`, `Warranty.tsx`, `CMDB.tsx`**
   - Apply `.liquid-glass-panel` and `.liquid-glass-subcard` consistently across tables, cards, and the **CMDB Downstream Impact Analysis** view (highlight root CI in `#007AFF` and depth-1/2/3 impacted badges in `#AF52DE`).

---

## 5. Verification & Acceptance Checklist (Run Before Completing)
1. Run `npm run typecheck` (or `npx tsc --noEmit`) inside `frontend/` — **0 TypeScript errors**.
2. Run `npm run build` inside `frontend/` — **clean Vite production build**.
3. Verify both **Day Glass (`light`)** and **Night Glass (`dark`)** modes maintain WCAG AA text contrast on all KPI numbers, table rows, badges, and form inputs.
4. Verify responsive behavior at `375px` (mobile with `BottomNav`), `768px` (tablet), and `1440px` (desktop with floating glass sidebar) with **zero horizontal overflow**.
5. Confirm all existing API calls (`api/client.ts`), auth flows, and protected routes continue working without regressions.
