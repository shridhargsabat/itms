# ITMS — IT Management System

<p align="center">
  <a href="https://itms.ai-automation-hub.tech"><img src="https://img.shields.io/badge/●_Live_Demo-online-brightgreen?style=for-the-badge" alt="Live demo online"></a>
  <img src="https://img.shields.io/github/stars/shridhargsabat/itms?style=for-the-badge&label=Stars" alt="GitHub stars">
  <img src="https://img.shields.io/badge/Rust-axum-orange?style=for-the-badge" alt="Rust axum">
  <img src="https://img.shields.io/badge/React-19-blue?style=for-the-badge" alt="React 19">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="MIT license">
</p>

> **One system for ITAM + ITSM + CMDB** — track assets, resolve tickets, and map blast radius. Liquid Glass UI in light & dark. 👇 Watch it move:
>
> 1. **ITAM** — hardware inventory, JSONB specs, user assignments, lifecycle tracking
> 2. **ITSM** — incidents, service requests, priority matrices, requester→asset linkages
> 3. **CMDB** — CI dependency mapping with recursive downstream impact analysis

<p align="center">
  <a href="https://itms.ai-automation-hub.tech">
    <img src="./docs/demo/hero-dashboard.gif" alt="ITMS dashboard animating: KPIs count up over drifting aurora" width="800">
  </a>
  <br><em>Live demo (seeded data, password <code>demo1234</code>) — <a href="https://itms.ai-automation-hub.tech">itms.ai-automation-hub.tech →</a></em>
</p>

## ✨ Liquid Glass — light & dark

<p align="center">
  <img src="./docs/demo/theme-switch.gif" alt="Switching ITMS from Liquid Glass Light to Dark" width="800">
  <br><em>One click: Liquid Glass Light → Dark. System-auto mode follows your device.</em>
</p>

| ☀︎ Liquid Glass Light | ☾ Liquid Glass Dark |
|---|---|
| ![Dashboard light](./docs/demo/dashboard-light.png) | ![Dashboard dark](./docs/demo/dashboard-dark.png) |
| ![Assets light](./docs/demo/assets-light.png) | ![Assets dark](./docs/demo/assets-dark.png) |
| ![Login light](./docs/demo/login-light.png) | ![Login dark](./docs/demo/login-dark.png) |

<details>
<summary>🎬 More clips (tickets · CMDB impact · mobile)</summary>
<br>

| Flow | Preview |
|---|---|
| 🎫 Tickets (dark) — list → drawer → Advance status | <img src="./docs/demo/tickets-flow.gif" alt="Ticket drawer opening and status advancing to resolved" width="480"> |
| 🕸 CMDB blast radius (light) — click switch → 2 impacted | <img src="./docs/demo/cmdb-impact.gif" alt="CMDB impact analysis showing 2 impacted servers" width="480"> |
| 📱 Mobile bottom-nav (375px) | <img src="./docs/demo/mobile-nav.gif" alt="Mobile navigation across Dashboard, Tickets, Scan, CMDB" width="240"> |

Full-quality MP4s (no GIF dither): [`docs/demo/`](./docs/demo/) — `hero-dashboard.mp4`, `theme-switch.mp4`, `tickets-flow.mp4`, `cmdb-impact.mp4`, `mobile-nav.mp4`.

</details>

📸 Full gallery with MP4s: [`docs/DEMO.md`](./docs/DEMO.md).

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Rust 1.85+ · axum 0.8 · sqlx 0.9 (runtime queries, embedded migrations) |
| Database | PostgreSQL 18 (`postgres:18-alpine`) · jsonb specs |
| Frontend | React 19 · Vite · TypeScript · Tailwind CSS v4 · TanStack Query · react-router 7 |
| Routing/TLS | Traefik v3.6 (shared VPS ingress, Let's Encrypt) |
| Deploy | Docker Compose on `itms-net` + `dokploy-network` |

## Layout

```
backend/    Rust API server (server bin) + seed bin
frontend/   React SPA (Vite build → nginx, /api proxied to backend)
docs/       PLAN.md (build & deploy plan), screenshots/
docker-compose.yml   db + backend + frontend, Traefik labels for itms.ai-automation-hub.tech
```

## Local run

```bash
cp .env.example .env   # set POSTGRES_PASSWORD
docker compose up -d --build
docker compose exec backend /usr/local/bin/seed   # demo data
```

## API surface

- `GET /api/v1/dashboard/metrics`
- `GET|POST /api/v1/assets` · `PATCH /api/v1/assets/:id/assign`
- `GET|POST /api/v1/tickets` · `PATCH /api/v1/tickets/:id/status`
- `GET /api/v1/cmdb/topology` · `GET /api/v1/cmdb/impact/:asset_id`
- `GET /api/v1/audit/log`

## Project management

Issues and milestones live here on GitHub. Live demo: https://itms.ai-automation-hub.tech (seeded demo data, demo logins use credentials that are provisioned out-of-band and rotated).

## License

MIT — see [LICENSE](LICENSE).
