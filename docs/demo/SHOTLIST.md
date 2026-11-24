# ITMS Demo Shot List (v1 — engagement cut)

Viewports: desktop 1440x900 (deviceScaleFactor 2 → export at 1440w), mobile 375x812.
Seed: `seed` bin defaults. Login: demo user / `demo1234` (whatever seed creates — assert login form present, do not hardcode email; try admin@itms.local first, fall back to first seeded user).

## Animated (MP4 primary + GIF fallback, 8–15s, no audio)
1. `hero-dashboard.mp4/.gif` — Login → dashboard KPIs count up → aurora drifts → hover 1 BentoCard. START light, END light. The README hero.
2. `theme-switch.mp4/.gif` — Dashboard light → open ThemeManager → click Liquid Glass Dark → close → aurora + glass visibly shift. Shows BOTH liquid themes in ONE clip.
3. `tickets-flow.mp4/.gif` — Tickets list → open ticket → change status → toast. Dark theme.
4. `cmdb-impact.mp4/.gif` — CMDB topology → click asset → impact panel expands. Light theme.
5. `mobile-nav.mp4/.gif` — 375px: bottom nav Dashboard→Tickets→Scan→CMDB. Light theme.

## Static (PNG, ≤400KB each)
- `dashboard-light.png` / `dashboard-dark.png` (1440x900)
- `assets-light.png` / `assets-dark.png`
- `tickets-dark.png`
- `cmdb-light.png`
- `login-light.png` / `login-dark.png`
- `theme-manager-light.png` / `theme-manager-dark.png` (modal open)
- `mobile-dashboard-light.png` (375x812)
- `social-preview.png` (1280x640, Task 10)

## Out of scope (v1)
Ledgerly themes, Settings/Masters views, PWA install prompt, audio narration.
