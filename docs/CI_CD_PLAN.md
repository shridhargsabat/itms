# ITMS CI/CD Pipeline — Implementation Plan

**Status:** Proposed (awaiting approval)
**Date:** 2026-08-19
**Scope:** Add Gitea Actions CI/CD to `shridhar.sabat/itms` so the live environment
auto-builds, auto-tests, and auto-deploys on push — fixing the current fully-manual
deploy and the observed stale-backend problem.

---

## 1. Current state (verified)

| Item | Value |
|---|---|
| Repo | `shridhar.sabat/itms` (private, Gitea) |
| Remote | `https://gitea.ai-automation-hub.tech/shridhar.sabat/itms.git` |
| `main` branch | exists (`899aa5c`) |
| Live deploy branch | **`feat/ledgerly-dark-theme`** (NOT `main`) |
| `.gitea/workflows/` | **does not exist** — deploys are 100% manual |
| Compose | `docker compose -f /root/itms/docker-compose.yml -p itms …` (not Dokploy) |
| Compose images | `build: ./backend` and `build: ./frontend` — **locally built, no registry, no `pull_policy`** |
| Stack | Rust axum backend · Postgres 18 · React/Vite/Tailwind frontend · nginx (Traefik ingress) |
| Frontend build | `tsc -b && vite build` (typecheck + build combined; no lint, no test runner) |
| Backend build | `cargo build --release --bin server --bin seed` (no unit tests yet) |
| Gitea runner | `sapl-runner` — labels `ubuntu-latest` + `vps-deploy`; `fetch_interval: 20s`; docker socket mounted |
| Registry token | `/root/.hermes/registry-token.txt` (used by SAPL deploy bot) |

**Observed bug during inspection:** `itms-backend` was **`Up 14 hours`** while
`itms-frontend` was **`Up 3 minutes`**. Because compose uses `build:` with local
image tags (`itms-backend`), `docker compose up -d` only recreates containers whose
**image tag changed** — a manual rebuild that builds only the frontend leaves the
backend running stale code while reporting "deployed". This is the exact
"GREEN run ≠ DEPLOYED" trap documented for SAPL.

---

## 2. Design goals

1. **Push → auto-deploy** to the live ITMS environment (no manual `docker compose`).
2. **Quality gates before deploy:** frontend typecheck+build, backend `cargo check`.
3. **Both services always rebuild on deploy** — switch to **registry-tagged images +
   `pull_policy: always`** so a changed backend can NEVER silently stay stale.
4. **Immutable, inspectable releases:** each deploy tagged `itms-<short-sha>` +
   `itms-latest` in the Gitea container registry.
5. **Smoke test after deploy:** healthz + a metrics endpoint probe.
6. **Freshness probe:** non-blocking check that the backend container's image actually
   matches the deployed SHA (loud warning, not a hard fail) — mirrors SAPL's guard.
7. **Reuse the proven SAPL pattern** (same runner, same registry, same helper-container
   deploy via mounted docker socket) — minimal novel machinery.

---

## 3. Branch strategy (simplified single-environment flow)

ITMS has **one** live environment (unlike SAPL's dev/uat/prod), so the promotion
pipeline is a single hop, not a chain:

```
feat/*  ──PR──→  main  ──auto-deploy──→  itms.ai-automation-hub.tech
```

- **`main` becomes the deploy branch** — push/merge to `main` triggers deploy.
- Feature branches (`feat/*`, `fix/*`) PR into `main`.
- **Migration action:** the currently-live `feat/ledgerly-dark-theme` code must be
  merged into `main` (or `main` fast-forwarded to it) **before or as part of** wiring
  the deploy trigger, so CI doesn't deploy an older/different tree than what's live.
- Opt-in `workflow_dispatch` on any branch so we can deploy a specific feature branch
  manually when needed (matches SAPL's `workflow_dispatch` behavior).

> ⚠️ Decision to confirm with Shridhar: switch the canonical deploy branch to `main`
> (clean, standard), **or** keep deploying from a long-lived feature branch. Plan
> assumes `main` unless overridden.

---

## 4. Pipeline design

Two files under `.gitea/workflows/` (mirroring SAPL's `ci.yml` + deploy file split):

### 4a. `.gitea/workflows/ci.yml` — lint-and-test on PR + push

```yaml
name: CI
on:
  push:
    branches: [main]
    paths-ignore: ['*.md', '**/*.md', 'docs/**', '.env.example']
  pull_request:
    branches: [main]
    paths-ignore: ['*.md', '**/*.md', 'docs/**', '.env.example']
  workflow_dispatch:

jobs:
  lint-and-test:
    runs-on: ubuntu-latest   # node:20-bullseye job container
    steps:
      - uses: actions/checkout@v4

      # Frontend — typecheck + production build (combined in `npm run build`)
      - name: Frontend install
        run: cd frontend && npm ci
      - name: Frontend typecheck + build
        run: cd frontend && npm run build

      # Backend — Rust compile check (cargo check is cheaper than full release
      # build and catches type/lint errors; the release build happens in deploy)
      - name: Backend cargo check
        run: |
          apt-get update -qq && apt-get install -y -qq gcc libc6-dev pkg-config 2>&1 | tail -2
          cd backend && cargo check --release
```

- Both jobs use the runner's `ubuntu-latest` label (node:20-bullseye container).
- No frontend `lint` script or unit tests exist yet — note as follow-up, not a gate now.
- No `vite build` duplication concern: for ITMS the deploy build is the same `npm run
  build`, so unlike SAPL we DON'T skip the build in CI — ITMS has no laptop-first
  build complication, so one canonical build in CI is fine and the deploy job reuses
  the artifact path via registry.

### 4b. `.gitea/workflows/deploy.yml` — auto-deploy on push to `main`

```yaml
name: Deploy
on:
  push:
    branches: [main]
    paths-ignore: ['*.md', '**/*.md', 'docs/**', '.env.example']
  workflow_dispatch:

jobs:
  deploy:
    runs-on: vps-deploy
    needs: [lint-and-test]      # set when split into ci.yml; see note below
    steps:
      - name: Deploy to live
        run: |
          # helper container (docker:28-cli) with host docker socket +
          # deploy checkout + registry token, then run the repo's build script
          docker run --rm \
            -v /var/run/docker.sock:/var/run/docker.sock \
            -v /root/itms:/code \
            -v /root/.hermes/registry-token.txt:/run/secrets/registry-token:ro \
            -w /code docker:28-cli sh -c '
              apk add --no-cache git openssh-client
              git fetch origin main && git checkout -f main || git checkout -f FETCH_HEAD
              git reset --hard origin/main
              sh /code/scripts/build-deploy.sh
            '
      - name: Backend freshness probe (non-blocking)
        run: |   # warns if backend container image != deployed sha
          docker inspect itms-backend --format '{{.Image}}' || true
```

> **Note on `needs:`** — because both files are distinct workflows, `deploy.yml` cannot
> `needs: lint-and-test` from a different workflow file. Two options (decide in impl):
> (a) put both jobs in ONE file (`workflow.yml` with `lint-and-test` + `deploy` jobs,
> `deploy` does `needs: [lint-and-test]` + `if: github.ref=='refs/heads/main'`); or
> (b) keep two files and have `deploy.yml` re-run the checks itself. **Recommend (a) —
> single `workflow.yml`**, matching how SAPL's ci.yml holds both lint and deploy jobs.

---

## 5. Compose changes — the core fix

`docker-compose.yml` switches both app services from `build:` to **registry-tagged
images with `pull_policy: always`** so every deploy pulls fresh and a changed backend
can never stay stale:

```yaml
backend:
  image: gitea.ai-automation-hub.tech/<bot-ns>/itms-backend:${BACKEND_TAG:-itms-latest}
  pull_policy: always
  # ...rest unchanged (env, volumes, healthcheck, caps, limits)

frontend:
  image: gitea.ai-automation-hub.tech/<bot-ns>/itms-frontend:${FRONTEND_TAG:-itms-latest}
  pull_policy: always
  # ...rest unchanged (nginx, traefik labels)
```

- `db` service unchanged (postgres image, no build).
- The `build:` blocks are removed from `backend`/`frontend` (replaced by `image:`),
  so manual local builds move to `docker build` against the registry namespace.
- Default tags fall back to `itms-latest` so a plain manual `docker compose up -d`
  (no env) still works — matches SAPL's `dev-latest` pattern.
- **Registry namespace:** reuse the `sapl-deploy-bot` machine user + its
  `/root/.hermes/registry-token.txt` (verified push access), using `itms-backend` /
  `itms-frontend` image names under that namespace. (Confirm bot has itms push
  rights; else register the ITMS repo scope or a dedicated `itms-deploy-bot`.)

---

## 6. Build/deploy script: `scripts/build-deploy.sh` (committed to repo)

Mirrors SAPL's `build-frontend-dev.sh` but builds **both** services on the VPS
(no laptop-first path needed — ITMS builds are not resource-heavy and there's one
env). Lives in the repo so the checkout self-contains its own deploy logic
(SAPL pitfall: script must be fetched before invoking — commit it first).

Flow:
1. `git fetch origin main && git reset --hard origin/main`; `SHA=$(git rev-parse --short=8 HEAD)`.
2. `docker login gitea.ai-automation-hub.tech -u <bot> --password-stdin` (token from `/run/secrets/registry-token`).
3. Build + tag + push **backend**: `itms-backend:itms-<SHA>` and `:itms-latest` (`docker build -f backend/Dockerfile backend`).
4. Build + tag + push **frontend**: `itms-frontend:itms-<SHA>` (+ `--build-arg BUILD_SHA=<SHA>` for the version badge) and `:itms-latest`.
5. Deploy: `BACKEND_TAG=itms-<SHA> FRONTEND_TAG=itms-<SHA> docker compose -f docker-compose.yml -p itms up -d --pull always --remove-orphans`.
   - `--pull always` + `pull_policy: always` guarantees both services recreate on every deploy.
6. `docker logout`.
7. Smoke test (POST-deploy): wait for health (pg_isready + backend `/api/v1/healthz`), then curl `GET /api/v1/dashboard/metrics` and a gated sample endpoint.

> **Freshness guard** (built into the script, non-fatal): after `up -d`, compare
> `itms-backend .Image` from `docker inspect` against the expected registry image
> digest; if it differs, print a loud `⚠️ STALE BACKEND — check image tag` warning
> (mirrors SAPL's non-blocking guard). The script exits 0 on the warning so CI stays
> green but the human is alerted.

---

## 7. Smoke test step (in deploy job)

Reuse the compose healthchecks + a dedicated verify step:
- Wait until `itms-backend` healthy.
- `curl -sf http://localhost:.../api/v1/healthz` (or via the frontend proxy)
  → expect `{"status":"ok"}`.
- `curl -sf http://localhost:.../api/v1/dashboard/metrics` → expect 200 + JSON.
- Optionally a login/token smoke against a real endpoint (like SAPL's acceptance
  suite) — keep minimal for the prototype; note as follow-up.

---

## 8. Registry/bot prep steps

- Confirm/create push credentials for the ITMS images in the Gitea registry. Two
  clean options (decide in impl):
  - **Reuse `sapl-deploy-bot`** with registry-token (simplest; one shared deploy user).
  - **Create `itms-deploy-bot`** machine user with a scoped `write:packages` /
    `write:repository` token (cleaner isolation; matches the SAPL `sapl-deploy-bot`
    precedent).
- Store the token at `/root/.hermes/registry-token.txt` (already exists — verify it
  has push to the itms image names).
- **Egress-filter gotcha** (from memory): Gitea API requests carrying a known token
  get killed by the VPS egress filter (HTTP 000). If API access is needed during
  setup (repo settings, branch protection), mint a **fresh** token inside the Gitea
  container, use it, and revoke after.

---

## 9. Branch protection (set up in Gitea)

- Protect `main`: require PR for merges, disallow force-push. (Optional for the
  prototype but recommended — matches SAPL's protected `main`.)
- Set `main` as the repo default branch if it isn't already (currently live code is
  on `feat/ledgerly-dark-theme`).

---

## 10. Implementation steps (ordered)

1. **Confirm branch decision** — merge live `feat/ledgerly-dark-theme` → `main` (or
   adopt it as deploy branch). This is the one real migration; without it CI deploys
   a different tree than what's live.
2. **Repo prep (isolated worktree per convengit hygiene):** create a
   `feat/ci-cd-pipeline` branch off the code that will be live.
3. Add `scripts/build-deploy.sh` (committed).
4. Modify `docker-compose.yml` → registry images + `pull_policy: always`.
5. Add `.gitea/workflows/workflow.yml` (lint-and-test + deploy + smoke, single file).
6. Registry/bot prep (token push scope for `itms-*` images).
7. Set branch protection + default branch.
8. Push branch → PR → merge to `main` → watch first CI run.
9. **Verify (not just trust the green badge):**
   - `docker ps` shows backend AND frontend `Up just now` (fresh, not stale).
   - `docker inspect itms-backend` image tag == `itms-<sha>`.
   - `curl` healthz + metrics return 200.
   - Gitea registry lists the pushed images.
10. Document in the ITMS skill (add a CI/CD section + pitfalls).

---

## 11. Out of scope / follow-ups

- **Harden the smoke test** into a fuller contract suite (login → CRUD → audit) like
  SAPL's acceptance_test.py.
- **Add unit tests** (frontend vitest, backend cargo test) and wire as CI gates.
- **Add frontend `lint` script** (eslint) and make it a gate.
- **Multi-env promotion** (dev/uat/prod) — only worth adding if ITMS outgrows one env.
- **Laptop-first frontend build** — not needed for a single lightweight env (can be
  layered in later if VPS CPU pressure becomes a problem).
- **`docs/`-only and `.md` commits skip CI** (paths-ignore) — already in the workflow.
