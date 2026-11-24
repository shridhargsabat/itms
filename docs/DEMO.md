# ITMS Demo Gallery

All captures are scripted and reproducible: `cd scripts/demo && npm install && node capture.mjs`, then `./convert.sh`. Budgets: GIF ≤3MB, MP4 ≤8MB, PNG ≤400KB.

> Capture stack: Postgres via podman + native backend (`PORT=8080`) + Vite dev (`:5173`, proxies `/api`). Set `ITMS_BASE_URL=http://localhost:5173`. Re-seed before capture (`./target/debug/seed`) — the tickets clip advances a real ticket. Needs `ffmpeg` (libx264 preferred; Hermes toolchain has it), `gifsicle`, `pngquant`.

## Hero

![Hero dashboard](./demo/hero-dashboard.gif)

[`hero-dashboard.mp4`](./demo/hero-dashboard.mp4) — full quality, no dither.

## Theme switch (Light → Dark)

![Theme switch](./demo/theme-switch.gif)

[`theme-switch.mp4`](./demo/theme-switch.mp4)

## Flows

### Tickets (dark) — list → drawer → Advance status

![Tickets flow](./demo/tickets-flow.gif) — [`tickets-flow.mp4`](./demo/tickets-flow.mp4)

### CMDB impact (light) — click switch → 2 impacted

![CMDB impact](./demo/cmdb-impact.gif) — [`cmdb-impact.mp4`](./demo/cmdb-impact.mp4)

### Mobile nav (375px, light)

<img src="./demo/mobile-nav.gif" alt="Mobile bottom navigation" width="240">

[`mobile-nav.mp4`](./demo/mobile-nav.mp4)

## Static — Liquid Glass Light vs Dark

| View | Light | Dark |
|---|---|---|
| Dashboard | ![dl](./demo/dashboard-light.png) | ![dd](./demo/dashboard-dark.png) |
| Assets | ![al](./demo/assets-light.png) | ![ad](./demo/assets-dark.png) |
| Login | ![ll](./demo/login-light.png) | ![ld](./demo/login-dark.png) |
| Theme manager | ![tl](./demo/theme-manager-light.png) | ![td](./demo/theme-manager-dark.png) |

## Re-shoot checklist

1. Start stack (any throwaway local password — e.g. `export PGPASS="$(openssl rand -hex 12)"`): `podman run -d --name itms-demo-db -e POSTGRES_USER=itms -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB=itms -p 5433:5432 postgres:18-alpine` → backend `DATABASE_URL=postgres://itms:"$PGPASS"@localhost:5433/itms PORT=8080 ./target/debug/server` → `DATABASE_URL=... ./target/debug/seed` → frontend `npm run dev` (or `docker compose up -d --build` + `docker compose exec backend /usr/local/bin/seed` where compose exists)
2. `cd scripts/demo && npm install && npx playwright install chromium && ITMS_BASE_URL=http://localhost:5173 node capture.mjs`
3. `FFMPEG=<libx264 ffmpeg> ./convert.sh` → budget check (Task 9) → commit.
