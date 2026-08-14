# ITMS Prototype — Build & Deploy Plan (https://itms.ai-automation-hub.tech)

> **For Hermes:** Implement task-by-task; each task ends with a real verification command. Do NOT skip Task 0 version checks — several pinned versions in the spec are bleeding-edge and may not resolve.

**Goal:** Build a working ITMS prototype (ITAM + ITSM + CMDB) with a Rust/Axum backend, React SPA frontend, PostgreSQL 18, and deploy it on this VPS at `https://itms.ai-automation-hub.tech`, reachable and verifiable end-to-end.

**Architecture:** 3 containers on an internal bridge network (`itms-net`): `db` (postgres:18-alpine), `backend` (Rust axum, :8080, runs embedded SQL migrations on startup), `frontend` (nginx serving built SPA, proxies `/api` → backend). The frontend container also joins the external `dokploy-network` where Traefik (the VPS's only 80/443 ingress) routes `itms.ai-automation-hub.tech` via labels and terminates TLS with Let's Encrypt — exactly the proven Ledgerly pattern. DNS: single `A` record added via Hostinger `hapi` CLI.

**Tech Stack:** Rust 1.85+ / axum 0.8 / sqlx 0.9 (runtime queries, embedded migrations) · PostgreSQL 18-alpine · React 19 + Vite + TypeScript + Tailwind CSS v4 + TanStack Query + react-router · nginx:alpine · Traefik v3.6 (existing) · dokploy-network (existing)

---

## Current Context (verified on this VPS, 2026-08-14)

- VPS: 16 GB RAM (10 GB free), 4 cores, 139 GB free disk, Ubuntu kernel 6.8. Dokploy + Traefik v3.6 (`dokploy-traefik`) running; external network `dokploy-network` exists.
- Traefik label pattern to replicate (from `deploy/docker-compose.prod.yml` of Ledgerly): labels on the web container + `networks: [dokploy-network]`, `traefik.http.routers.<name>-web.rule=Host(...)`, redirect middlewares, `websecure` + `tls.certresolver=letsencrypt`, `loadbalancer.server.port=80`. No host ports in prod.
- DNS: Hostinger, managed via `hapi` CLI. Existing A records for `ledgerly`, `excalidraw`, `hermes`, `obsidian`, `dev`, `uat`, etc. → `187.127.163.128`. **No `itms` record yet.**
- Reference doc: `/root/.hermes/cache/documents/doc_803a5f1358ef_ITMS Prototype.md` (schema + API contract + frontend spec). The SQL schema and API list are copied verbatim from it.

## Assumptions

- Prototype = no auth, no pagination, no edit flows beyond what the spec lists (YAGNI).
- Backend migrations are **embedded** (`sqlx::migrate!()`) and run at container startup — no separate migrate step.
- Build both Docker images on the VPS (16 GB RAM is plenty; cargo release build ≈ 5–12 min one-time).
- VPS has Hostinger CPU-policy risk → all services get `deploy.resources.limits` (see Task 2).
- If a pinned npm/crate version doesn't resolve, drop to the latest stable of that major/minor and **record the actual version** in the plan output (Task 0).

---

## Directory Layout (target)

```
/root/itms/
├── docker-compose.yml
├── .env                     # gitignored; POSTGRES_PASSWORD, DATABASE_URL
├── .gitignore
├── README.md
├── backend/
│   ├── Cargo.toml
│   ├── migrations/
│   │   └── 0001_init.sql    # schema from spec, verbatim
│   ├── Dockerfile           # multi-stage rust:1.85 → debian:bookworm-slim
│   ├── src/
│   │   ├── main.rs          # router, CORS, tracing, migrate-on-start
│   │   ├── db.rs            # PgPool + AppState
│   │   ├── models.rs        # serde structs for users/assets/tickets/relationships/audit
│   │   ├── routes/
│   │   │   ├── mod.rs
│   │   │   ├── dashboard.rs # GET /api/v1/dashboard/metrics
│   │   │   ├── assets.rs    # GET/POST /api/v1/assets, PATCH /api/v1/assets/:id/assign
│   │   │   ├── tickets.rs   # GET/POST /api/v1/tickets, PATCH /api/v1/tickets/:id/status
│   │   │   ├── cmdb.rs      # GET /api/v1/cmdb/topology, GET /api/v1/cmdb/impact/:asset_id
│   │   │   └── audit.rs     # GET /api/v1/audit/log (feed for dashboard recent events)
│   │   └── bin/
│   │       └── seed.rs      # seed binary: 4 users, 8 assets, 5 tickets, 4 CI edges
└── frontend/
    ├── package.json
    ├── vite.config.ts       # proxy /api → http://localhost:8080 (dev), @ alias
    ├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
    ├── index.html
    ├── Dockerfile           # node build → nginx:alpine
    ├── nginx.conf           # SPA fallback + /api proxy to http://backend:8080
    └── src/
        ├── main.tsx         # QueryClientProvider + RouterProvider
        ├── index.css        # @import "tailwindcss"; slate-950 base
        ├── api/client.ts    # fetch wrapper + typed hooks
        ├── api/types.ts     # TS mirrors of Rust structs
        ├── components/Layout.tsx        # collapsible sidebar (lucide icons)
        ├── components/MetricCard.tsx, DataTable.tsx, AssetSpecModal.tsx, TicketBadge.tsx
        └── pages/
            ├── Dashboard.tsx            # metrics + quick-action modals + audit stream
            ├── Assets.tsx               # filterable table + spec slide-over
            ├── Tickets.tsx              # kanban/table + requester-asset badge
            ├── CMDB.tsx                 # dependency tree + impact selector
            └── AuditLog.tsx
```

---

## Task 0: Pre-flight version checks (5 min)

**Objective:** Confirm every pinned version exists before scaffolding; resolve conflicts cheaply.

**Files:** none

**Steps:**
1. `npm view vite version; npm view react version; npm view react-router-dom version; npm view lucide-react version; npm view @vitejs/plugin-react version; npm view tailwindcss version` — if any pinned version (vite ^8.2, react ^19.2, react-router-dom ^7.18, lucide-react ^1.31, plugin-react ^4.3, tailwind ^4.3) is missing or has peer conflicts (esp. plugin-react vs vite), note the newest compatible set.
2. `cargo search axum --limit 1; cargo search sqlx --limit 1` — confirm axum 0.8 / sqlx 0.9 resolve; if sqlx 0.9 absent, use 0.8 (API used here is identical).
3. `docker pull postgres:18-alpine` — confirm image exists (PostgreSQL 18 GA ⇒ expected).
4. `docker network ls | grep dokploy-network` → must exist (verified today).

**Verification:** a written list of final versions, e.g. `vite 8.2.x`, `lucide-react 1.31.x` — paste into plan output.

**Commit:** (after repo init in Task 1)

---

## Task 1: Workspace & repo scaffold (5 min)

**Objective:** Create `/root/itms` skeleton, git init, `.gitignore`, README.

**Files:**
- Create: `/root/itms/.gitignore`, `/root/itms/README.md`

**Steps:**
1. `mkdir -p /root/itms/{backend/src/routes,backend/src/bin,backend/migrations,frontend/src/{api,components,pages}} && cd /root/itms && git init -b main`
2. `.gitignore`: `target/`, `node_modules/`, `dist/`, `.env`, `*.log`
3. README: one-paragraph description + run commands.

**Verification:** `ls -R /root/itms | head -30`
**Commit:** `chore: scaffold workspace`

---

## Task 2: docker-compose.yml + .env (15 min)

**Objective:** 3-service compose with Traefik labels (Ledgerly pattern), internal network, resource limits, healthchecks.

**Files:**
- Create: `/root/itms/docker-compose.yml`
- Create: `/root/itms/.env` (gitignored)

**Complete compose:**

```yaml
services:
  db:
    image: postgres:18-alpine
    container_name: itms-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: itms
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set in .env}
      POSTGRES_DB: itms
    volumes:
      - itms_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U itms -d itms"]
      interval: 10s
      timeout: 5s
      retries: 10
    networks: [itms-net]
    deploy:
      resources:
        limits: { cpus: "0.75", memory: 768M }

  backend:
    build: ./backend
    container_name: itms-backend
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://itms:${POSTGRES_PASSWORD:?set in .env}@db:5432/itms
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/api/v1/dashboard/metrics"]
      interval: 15s
      timeout: 5s
      retries: 10
    networks: [itms-net]
    deploy:
      resources:
        limits: { cpus: "0.75", memory: 512M }

  frontend:
    build: ./frontend
    container_name: itms-frontend
    restart: unless-stopped
    depends_on:
      backend:
        condition: service_healthy
    networks:
      - itms-net
      - dokploy-network
    labels:
      - traefik.enable=true
      - traefik.docker.network=dokploy-network
      - traefik.http.routers.itms-web.rule=Host(`itms.ai-automation-hub.tech`)
      - traefik.http.routers.itms-web.entrypoints=web
      - traefik.http.routers.itms-web.middlewares=redirect-to-https@file
      - traefik.http.routers.itms-websecure.rule=Host(`itms.ai-automation-hub.tech`)
      - traefik.http.routers.itms-websecure.entrypoints=websecure
      - traefik.http.routers.itms-websecure.tls=true
      - traefik.http.routers.itms-websecure.tls.certresolver=letsencrypt
      - traefik.http.routers.itms-websecure.service=itms
      - traefik.http.services.itms.loadbalancer.server.port=80
    deploy:
      resources:
        limits: { cpus: "0.5", memory: 256M }

volumes:
  itms_pgdata:

networks:
  itms-net:
    driver: bridge
  dokploy-network:
    external: true
```

**Steps:**
1. Write compose + `.env` (`POSTGRES_PASSWORD=<openssl rand -hex 24>`; never commit).
2. `docker compose config` → must parse and interpolate `.env`.

**Verification:** `docker compose config --quiet && echo OK`
**Commit:** `chore: compose stack with traefik routing + resource limits`

---

## Task 3: Database migration (10 min)

**Objective:** Schema from the spec, verbatim.

**Files:**
- Create: `/root/itms/backend/migrations/0001_init.sql`

**Steps:**
1. Copy the spec's SQL exactly: `uuid-ossp` extension, `users`, `assets` (JSONB `specs`, status/category enums as VARCHAR + CHECK not required — spec uses plain VARCHAR), `tickets` (FK to requester/assignee/asset), `ci_relationships` (UNIQUE parent/child/type), `audit_logs`.
2. Add indexes for the query patterns: `assets(status)`, `assets(category)`, `tickets(status)`, `tickets(priority)`, `ci_relationships(parent_asset_id)`, `audit_logs(created_at DESC)`.

**Verification:** `psql`-parse check via sqlx at build time (Task 4/8). Static check: `docker run --rm -v $(pwd)/backend/migrations:/m:ro -e POSTGRES_PASSWORD=x -e POSTGRES_DB=itms -e POSTGRES_USER=itms -d postgres:18-alpine` + `docker exec <c> psql -U itms -f /m/0001_init.sql` then drop container.
**Commit:** `feat(db): initial schema`

---

## Task 4: Rust backend skeleton (30 min)

**Objective:** Compilable axum app with pool, migrate-on-start, router skeleton, tracing.

**Files:**
- Create: `/root/itms/backend/Cargo.toml` (exact deps from spec; edition 2021; two `[[bin]]`s: `server`, `seed`)
- Create: `/root/itms/backend/src/db.rs`
- Create: `/root/itms/backend/src/models.rs`
- Create: `/root/itms/backend/src/main.rs`
- Create: `/root/itms/backend/src/routes/mod.rs` (+ empty handler modules)

**Key content:**
- `db.rs`: `pub async fn create_pool(url: &str) -> sqlx::Result<PgPool>` (max_connections=10, acquire_timeout 10s), `AppState { pool: PgPool }` (Clone).
- `main.rs`: `dotenvy::dotenv().ok()`, tracing_subscriber env-filter, `sqlx::migrate!("./migrations").run(&pool).await?`, `CorsLayer` allowlist = `http://localhost:5173` + `https://itms.ai-automation-hub.tech`, `TraceLayer`, `Router` mounting `/api/v1` nested routes, listener `0.0.0.0:8080`.
- `models.rs`: `User`, `Asset` (with `specs: serde_json::Value`, joined `assigned_user_name: Option<String>` on read), `Ticket` (+ requester/assignee names, asset tag/name), `CiRelationship`, `AuditLog`, `DashboardMetrics` — all `#[derive(Serialize, Deserialize, Debug, sqlx::FromRow)]` where read-shaped.
- Handlers initially return `todo!()` or empty JSON lists so the crate compiles; fill in Tasks 5–8.

**Steps:**
1. Write files; `mkdir backend/src/routes` files with stub handlers.
2. `cd /root/itms/backend && cargo check` (first build: ~4–8 min; use `CARGO_BUILD_JOBS=4`).

**Verification:** `cargo check` exits 0; `cargo run --bin server` fails only at DB connect (expected — db not up yet).
**Commit:** `feat(backend): axum skeleton with pool + migrations`

---

## Task 5: Assets + Dashboard routes (40 min)

**Objective:** `GET/POST /api/v1/assets`, `PATCH /api/v1/assets/:id/assign`, `GET /api/v1/dashboard/metrics`, audit write on every mutation.

**Files:**
- Modify: `backend/src/routes/assets.rs`, `backend/src/routes/dashboard.rs`, `backend/src/routes/audit.rs`
- Create: `backend/tests/api_smoke.rs` (optional dev-time integration via `sqlx` against local docker db)

**API contract (exact):**
- `GET /api/v1/assets?search=&category=&status=` → `[{id, asset_tag, name, category, serial_number, status, assigned_to_user_id, assigned_user_name, specs, purchase_date, warranty_expiry, created_at}]` — WHERE clauses: ILIKE on name/asset_tag/serial for `search`, equality for category/status; `LEFT JOIN users` for name; ORDER BY created_at DESC.
- `POST /api/v1/assets` body `{name, category, serial_number, status?, specs?, purchase_date?, warranty_expiry?}` → generate `AST-XXXX` (next sequence = count-based or `substring` of max; simplest: `format!("AST-{:04}", n)` where n = `SELECT count(*) + 1` with retry on unique violation); insert; append `audit_logs` row `(action='ASSET_CREATE', target_type='asset', target_id=<id>, diff=<old={}, new={...}>)`.
- `PATCH /api/v1/assets/:id/assign` body `{assigned_to_user_id: Option<Uuid>}` (null = unassign) → UPDATE + audit `ASSET_ASSIGN` diff `{old_user_id, new_user_id}`; 404 if asset missing.
- `GET /api/v1/dashboard/metrics` → `{asset_count, open_tickets, high_priority_count, in_stock_count}` (one multi-row query or 4 scalar queries).
- `GET /api/v1/audit/log?limit=20` → recent audit rows joined with actor name (for Dashboard live stream).

**Verification:** temporary local run — `docker compose up -d db`, `cargo run --bin server`, then:
`curl -s localhost:8080/api/v1/dashboard/metrics` → `{"asset_count":0,...}`; `curl -s -X POST localhost:8080/api/v1/assets -H 'content-type: application/json' -d '{"name":"XPS 15","category":"LAPTOP","serial_number":"SN1"}'` → 201 with `asset_tag` starting `AST-`; `curl -s localhost:8080/api/v1/audit/log` shows `ASSET_CREATE`.
**Commit:** `feat(backend): assets + dashboard + audit`

---

## Task 6: Tickets routes (40 min)

**Objective:** list/create tickets, status transitions with audit.

**Files:**
- Modify: `backend/src/routes/tickets.rs`

**API contract (exact):**
- `GET /api/v1/tickets?status=&priority=&type=` → joined rows: `{id, ticket_number, title, description, ticket_type, priority, status, requester_id, requester_name, assignee_id, assignee_name, asset_id, asset_tag, asset_name, created_at, updated_at}` (LEFT JOIN users ×2, assets).
- `POST /api/v1/tickets` body `{title, description, ticket_type?, priority?, requester_id, assignee_id?, asset_id?}` → ticket_number `INC-XXXX` (same count+retry pattern as AST); insert; audit `TICKET_CREATE`.
- `PATCH /api/v1/tickets/:id/status` body `{status: OPEN|IN_PROGRESS|RESOLVED|CLOSED}` → validate transition against whitelist map `{OPEN→[IN_PROGRESS, CLOSED], IN_PROGRESS→[RESOLVED, OPEN], RESOLVED→[CLOSED, OPEN], CLOSED→[OPEN]}`; 422 on illegal transition; audit `TICKET_STATUS` with `{from, to}`.

**Verification:** POST ticket → `INC-0001`; PATCH OPEN→IN_PROGRESS→RESOLVED→CLOSED OK; PATCH OPEN→RESOLVED → 422; audit shows transitions.
**Commit:** `feat(backend): tickets + status workflow`

---

## Task 7: CMDB routes — topology + recursive impact (30 min)

**Objective:** graph endpoints for the frontend, recursive blast-radius CTE.

**Files:**
- Modify: `backend/src/routes/cmdb.rs`

**API contract (exact):**
- `GET /api/v1/cmdb/topology` → `{nodes: [{id, asset_tag, name, category, status}], edges: [{id, parent_asset_id, child_asset_id, relationship_type}]}` (two queries).
- `GET /api/v1/cmdb/impact/:asset_id` → recursive CTE walking `ci_relationships` DOWNSTREAM (parent→child), returning `{asset_id, depth}` list + count. SQL:

```sql
WITH RECURSIVE downstream AS (
  SELECT child_asset_id, 1 AS depth, ARRAY[parent_asset_id, child_asset_id] AS path
  FROM ci_relationships WHERE parent_asset_id = $1
  UNION ALL
  SELECT r.child_asset_id, d.depth + 1, d.path || r.child_asset_id
  FROM ci_relationships r JOIN downstream d ON r.parent_asset_id = d.child_asset_id
  WHERE NOT r.child_asset_id = ANY(d.path)
)
SELECT d.child_asset_id, a.asset_tag, a.name, a.category, d.depth
FROM downstream d JOIN assets a ON a.id = d.child_asset_id ORDER BY d.depth;
```

Return `{root_asset_id, impact_count, impacted: [...]}`; 404 if root asset unknown.

**Verification:** seed 4 relationships (Task 8) then `curl localhost:8080/api/v1/cmdb/impact/<root-id>` → ordered depth rows; verify cycle-safety with a temp 2-node cycle in seed.
**Commit:** `feat(backend): cmdb topology + blast radius`

---

## Task 8: Seed binary (20 min)

**Objective:** reproducible demo data per spec: 4 users, 8 assets, 5 tickets, 4 CI relationships.

**Files:**
- Modify: `backend/src/bin/seed.rs`

**Steps:**
1. Connect via `DATABASE_URL`; truncate `audit_logs, ci_relationships, tickets, assets, users` (CASCADE, in that order) then insert.
2. Users: 2 AGENT (support leads), 1 ADMIN, 1 EMPLOYEE across departments (IT, Finance, HR, Sales).
3. Assets: 8 — mix LAPTOP/DESKTOP/SERVER/NETWORK_DEVICE/MONITOR/LICENSE; 3 assigned to users (one each), 2 IN_STOCK, 1 MAINTENANCE, 1 RETIRED; realistic JSONB `specs` (cpu/ram/storage/os for laptops; cores/ram/rack for servers; seats/expiry for licenses).
4. Tickets: 5 — 2 INCIDENT, 2 SERVICE_REQUEST, 1 CHANGE; mix of statuses/priorities; link 2 tickets to assigned assets (exercises the requester→asset badge).
5. CI edges (4): `web-server RUNS_ON server-01`, `db-server RUNS_ON server-02`, `server-01 CONNECTS_TO switch-01`, `server-02 CONNECTS_TO switch-01` — so switch-01 outage impacts both servers (depth-2 chain optional via `DEPENDS_ON`).

**Verification:** `cargo run --bin seed` → prints row counts; `docker exec itms-db psql -U itms -d itms -c 'SELECT count(*) FROM assets'` → 8.
**Commit:** `feat(backend): seed data`

---

## Task 9: Backend Dockerfile + image build (20 min + 5–12 min build)

**Objective:** small, self-contained backend image.

**Files:**
- Create: `/root/itms/backend/Dockerfile`

```dockerfile
FROM rust:1.85-slim AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release --bin server --bin seed

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/server /usr/local/bin/server
COPY --from=builder /app/target/release/seed /usr/local/bin/seed
EXPOSE 8080
CMD ["server"]
```

**Steps:** `cargo generate-lockfile` in backend first (so Cargo.lock exists for the COPY), then `docker build -t itms-backend ./backend` with `DOCKER_BUILDKIT=1`. If build memory is a concern: `docker build --build-arg`/`cargo -j2`; 16 GB RAM makes this unlikely.

**Verification:** `docker run --rm itms-backend server --help`-style sanity (or just image build success + `docker images itms-backend`).
**Commit:** `feat(backend): docker image`

---

## Task 10: Frontend scaffold (25 min)

**Objective:** Vite React-TS app with Tailwind v4 zero-config, router, react-query, API client.

**Files:**
- Create (via `npm create vite@latest` in `frontend/` with react-ts template, then modify): `package.json` (deps per spec — adjust to Task 0 verdict), `vite.config.ts` (exact file from spec incl. `/api` proxy → `localhost:8080` + `@` alias), `tsconfig*.json`, `index.html`, `src/index.css` (exact spec file), `src/main.tsx`, `src/api/client.ts`, `src/api/types.ts`

**Key content:**
- `client.ts`: `apiFetch<T>(path, init?)` wrapper — JSON headers, 2s→30s timeout, throws with server error body; typed helpers `getDashboardMetrics`, `listAssets(params)`, `createAsset`, `assignAsset`, `listTickets`, `createTicket`, `patchTicketStatus`, `getTopology`, `getImpact(assetId)`, `getAuditLog(limit)`.
- `types.ts`: TS mirrors of Task 5–7 JSON shapes (`Asset`, `Ticket`, `DashboardMetrics`, `Topology`, `ImpactResult`, `AuditLogEntry`, `CiEdge`, enums as string unions).
- `main.tsx`: `QueryClient` (staleTime 30s, retry 1) + `BrowserRouter` + routes: `/` Dashboard, `/assets`, `/tickets`, `/cmdb`, `/audit` — all inside `Layout`.

**Verification:** `npm run dev` → open `http://localhost:5173` (via SSH tunnel or browser) → empty-shell Layout renders, sidebar links navigate, no console errors.
**Commit:** `feat(frontend): scaffold + api client`

---

## Task 11: Frontend views (1.5–2 h)

**Objective:** the 5 views from the spec, dark slate-950 theme, lucide icons, react-query data.

**Files:**
- Create/modify: `src/components/Layout.tsx` (collapsible sidebar: Dashboard, Assets, Tickets, CMDB, Audit Log; active-link highlight), `MetricCard.tsx`, `DataTable.tsx` (generic), `AssetSpecModal.tsx` (slide-over rendering `specs` JSON key/value), `TicketBadge.tsx` (priority/status colors)
- Pages:
  1. `Dashboard.tsx` — 4 MetricCards (Assets, Open Tickets, High Priority, In Stock) from `/dashboard/metrics`; "New Ticket" + "Add Asset" modals (POST then `invalidateQueries`); audit stream (last 10 events, auto-refetch 30s).
  2. `Assets.tsx` — DataTable with Category + Status `<select>` filters and search input (all via query params → GET); row click opens AssetSpecModal (specs + assigned user); "Assign" quick action.
  3. `Tickets.tsx` — toggle Table/Kanban (kanban columns by status); ticket detail pane shows description + requester's **asset badge** (asset_tag + name + category) + specs; status advance button (OPEN→IN_PROGRESS→RESOLVED); create-ticket modal.
  4. `CMDB.tsx` — left: node list grouped by category; right: impact panel — pick an asset → `getImpact` → dependency tree (depth-indented) + "N assets impacted" summary; visual edges list (nodes+edges from `/topology`).
  5. `AuditLog.tsx` — table of audit entries (actor, action, target, timestamp) with diff JSON expandable.

**Steps:** Build components against `client.ts`; run `npm run build` after each page to catch TS errors early.

**Verification:** `npm run build` passes (tsc -b + vite); `npm run dev` against running backend (Task 5–8 db up + seed) — Dashboard shows 8 assets / 5 tickets, CMDB impact for switch-01 lists 2 servers.
**Commit:** `feat(frontend): all views`

---

## Task 12: Frontend Dockerfile + nginx + build (20 min)

**Objective:** static image with `/api` reverse proxy to backend.

**Files:**
- Create: `/root/itms/frontend/Dockerfile`

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

- Create: `/root/itms/frontend/nginx.conf`

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location /api/ {
    proxy_pass http://backend:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

**Steps:** `docker build -t itms-frontend ./frontend`. Note: `proxy_pass http://backend:8080` resolves `backend` on the shared `itms-net` network (compose service name → Docker DNS).

**Verification:** image builds; `docker run --rm --network itms-net itms-frontend` + `docker exec` curl `http://frontend/api/...` after full stack up (Task 14).
**Commit:** `feat(frontend): docker image`

---

## Task 13: DNS record (2 min)

**Objective:** `itms` A record → VPS IP.

**Steps:**
1. `hapi dns records list ai-automation-hub.tech --format json` → copy an existing A record's shape (e.g. `ledgerly`).
2. Add: name `itms`, type `A`, TTL 300, value `187.127.163.128`, via:
   `hapi dns records update ai-automation-hub.tech --zone '<existing records json + new itms A record>'` (JSON array under `--zone`; `update` appends new records without overwrite).
3. `dig +short itms.ai-automation-hub.tech` → `187.127.163.128`.

**Verification:** `dig` returns the IP (TTL 300 ⇒ ≤5 min propagation; Hostinger usually faster).
**Commit:** n/a (infra change; note it in README)

---

## Task 14: Deploy stack (15 min)

**Objective:** full stack running with TLS.

**Steps:**
1. `cd /root/itms && docker compose up -d --build` (backend image build reuses Task 9 cache).
2. `docker compose ps` → all 3 healthy.
3. `docker compose logs -f backend | head -50` → "applied 1 migration", "listening on 0.0.0.0:8080".
4. `docker compose exec backend /usr/local/bin/seed` → row counts printed.
5. Wait for Let's Encrypt cert (first hit triggers issuance; 10–60 s).

**Verification:** `curl -s https://itms.ai-automation-hub.tech/api/v1/dashboard/metrics` → `{"asset_count":8,"open_tickets":3,"high_priority_count":2,"in_stock_count":2}` (values per seed data).
**Commit:** `docs: deployment notes` (README section)

---

## Task 15: End-to-end verification & screenshot (15 min)

**Objective:** prove the public URL works — API + UI.

**Steps:**
1. API through Traefik:
   - `curl -s https://itms.ai-automation-hub.tech/api/v1/assets?category=LAPTOP | head -c 400`
   - `curl -s https://itms.ai-automation-hub.tech/api/v1/cmdb/topology`
   - `curl -s https://itms.ai-automation-hub.tech/api/v1/cmdb/impact/<switch-01-uuid>` → 2 impacted servers
   - `curl -s -o /dev/null -w '%{http_code} %{time_total}s' https://itms.ai-automation-hub.tech` → `200`
2. UI: browser_navigate to `https://itms.ai-automation-hub.tech`, screenshot Dashboard (metric cards + audit stream), navigate Assets → open a laptop spec modal, Tickets → kanban + asset badge, CMDB → impact of switch-01. Save screenshots to `/root/itms/docs/screenshots/` and attach the dashboard screenshot in the final report.
3. `docker compose ps` all healthy; `docker events --filter container=itms --since 1h` clean (no restart loops).

**Verification:** zero console errors; all 5 views render with seeded data; screenshots saved.
**Commit:** `docs: verification screenshots`

---

## Task 16 (optional): Push to Gitea

**Objective:** version the prototype in the VPS's own Gitea (`gitea.ai-automation-hub.tech`).

**Steps:**
1. `cd /root/itms && git add -A && git commit -m "feat: ITMS prototype v0.1"`
2. Create repo via gitea API (`/root/.hermes/gitea-token.txt`): `POST /api/v1/user/repos {"name":"itms","private":true,"auto_init":false}`.
3. `git remote add origin https://<token>@gitea.ai-automation-hub.tech/<user>/itms.git && git push -u origin main` (or SSH if keys configured).

**Verification:** repo visible on Gitea; `git ls-remote origin` works.
**Commit:** push

---

## Files Likely to Change (full list)

All new (greenfield): tree in "Directory Layout" above. No existing files touched except:
- DNS zone for `ai-automation-hub.tech` (Task 13, via hapi)
- (optional) new Gitea repo `itms`

## Validation Matrix

| Check | Command | Pass criteria |
|---|---|---|
| Rust compiles | `cargo check` in backend | exit 0, zero errors |
| Frontend typecheck+bundle | `npm run build` in frontend | exit 0 |
| Compose valid | `docker compose config --quiet` | exit 0 |
| Migrations apply | backend container log | "applied 1 migration" |
| Seed data | `docker exec itms-db psql -U itms -d itms -c 'SELECT count(*) FROM assets;'` | 8 |
| Public API | `curl -s https://itms.ai-automation-hub.tech/api/v1/dashboard/metrics` | seeded counts |
| TLS | `curl -sv https://itms... 2>&1 \| grep subject` | LE cert, CN `itms.ai-automation-hub.tech` |
| UI | browser screenshot | all 5 views render, no console errors |
| No restarts | `docker compose ps` | 3× Up (healthy) |

## Risks, Tradeoffs & Open Questions

1. **Version drift (HIGH probability, low impact):** spec pins bleeding-edge versions (Vite ^8.2, lucide-react ^1.31, plugin-react ^4.3, sqlx 0.9, postgres:18). Task 0 resolves; fallback = latest stable of same major; record actuals. `@vitejs/plugin-react ^4.3` likely incompatible with Vite 8 → use plugin-react 5.x if so.
2. **Rust build time on VPS:** first `cargo check` 4–8 min, release image 5–12 min. Acceptable (16 GB RAM, 4 cores). Fallback if too slow: build on laptop (`cross` or native target) and `scp` binary + slim runtime image.
3. **Hostinger CPU policy:** VPS is stopped by provider on sustained CPU spikes → all services get `deploy.resources.limits`; no host-port binds (Traefik-only) keeps surface minimal.
4. **Traefik label collisions:** router names must be unique (`itms-web` etc.) — they are; `redirect-to-https@file` middleware already exists (Ledgerly uses it).
5. **postgres:18-alpine availability:** expected GA by now; if image missing, `postgres:17-alpine` with zero code change (all features used are ancient).
6. **Recursive CTE cycles:** guarded with `path` array anti-join; verified with seed.
7. **No auth (per spec):** public internet exposure of a prototype. Mitigation: it's demo data only; consider Traefik BasicAuth middleware later if long-lived.
8. **Open questions:** none blocking. Optional follow-ups: Gitea hosting (Task 16), Traefik basic-auth, README screenshots.

## Handoff

After Task 15 passes, final report = summary table (URL, endpoints verified, seed counts, screenshot) + this plan's deviations (actual versions, any fallbacks used).
