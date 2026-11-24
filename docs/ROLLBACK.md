# ITMS Rollback Runbook

Every deploy pushes immutable per-commit image tags (`itms-<sha8>`) for BOTH
services, so a rollback is just re-pointing the stack at the previous good tag.
No rebuild needed; the whole procedure takes ~2 minutes.

## What you need

- The previous good short SHA (`git log --oneline -5` on `main`, or the
  previous deploy's `==> Building ITMS for main @ <sha>` line in CI logs).
- SSH access to the VPS deploy checkout (`/root/itms`) with a valid `.env`.

## Rollback steps

1. **SSH to the VPS** and go to the deploy checkout:
   ```sh
   ssh root@<VPS_HOST>
   cd /root/itms
   ```

2. **Confirm the target tags exist in GHCR** (replace `<prev-sha>` with the
   previous good 8-char SHA):
   ```sh
   docker manifest inspect ghcr.io/shridhargsabat/itms-backend:itms-<prev-sha>
   docker manifest inspect ghcr.io/shridhargsabat/itms-frontend:itms-<prev-sha>
   ```
   Both must return a manifest. If either is missing, pick an older SHA that
   has both tags — never roll back to a half-available pair.

3. **Re-point the stack at the previous tags** (same `.env`, same compose
   file — only the image pins change):
   ```sh
   BACKEND_TAG=itms-<prev-sha> FRONTEND_TAG=itms-<prev-sha> \
     docker compose --env-file .env -f docker-compose.yml -p itms \
     up -d --pull always --remove-orphans
   ```

4. **Wait for readiness** (backend healthcheck gates on `/readyz`, which
   requires a live DB connection):
   ```sh
   for i in $(seq 1 30); do
     if [ "$(docker exec itms-backend wget -qO- http://localhost:8080/api/v1/readyz 2>/dev/null)" = "ready" ]; then
       echo "ready (attempt $i)"; break
     fi
     sleep 2
   done
   ```

## Verify

- **Freshness:** the backend must report the rollback tag, not the bad one:
  ```sh
  docker inspect itms-backend --format '{{index .Config.Image}}'
  # expect: ghcr.io/shridhargsabat/itms-backend:itms-<prev-sha>
  ```
- **Liveness:** `docker exec itms-backend wget -qO- http://localhost:8080/api/v1/healthz`
  must print `ok`.
- **Readiness:** `docker exec itms-backend wget -qO- http://localhost:8080/api/v1/readyz`
  must print `ready` (proves the DB pool is live).
- **Public:** `curl -s https://itms.ai-automation-hub.tech/api/v1/dashboard/metrics`
  must answer HTTP 200 (with a token) or 401 (without) — never 502/503.
- **Compose health:** `docker compose -p itms ps` shows both `backend` and
  `frontend` as `healthy`/`running`.

## Notes

- **Forward-fix afterwards:** rollback buys time; the bad commit is still on
  `main`. Fix forward with a new commit (which deploys a new `itms-<sha>` tag
  pair), or revert the bad commit — do not leave the stack pinned behind
  `main` indefinitely.
- **Migrations only go forward:** the backend applies pending SQLx migrations
  at boot and never downgrades. If the bad deploy shipped a migration that the
  rollback target cannot run against, the backend will fail to boot — in that
  case you need a forward-fix migration, not a tag rollback. Check
  `docker logs itms-backend` if `/readyz` never becomes `ready` after rollback.
- **Do not touch `itms-latest`:** it always tracks the newest build (including
  the bad one) — pin the exact `itms-<sha>` tags for rollback.
