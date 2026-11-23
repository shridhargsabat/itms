#!/bin/sh
# build-deploy.sh — ITMS CI/CD deploy script.
#
# Builds BOTH the backend (Rust) and frontend (React/Vite) images, pushes them
# to GHCR (shridhargsabat namespace), then brings the live stack up with
# --pull always so every service actually recreates with the freshly pushed
# image (fixes the stale-backend trap where a locally-built `itms-backend`
# image tag never changes and compose silently skips rebuilding).
#
# Runs EITHER directly on the VPS (/root/itms checkout, invoked over SSH by
# .github/workflows/ci-cd.yml) OR inside the legacy Gitea helper container
# (Alpine, /code mount). Expected inputs:
#   CODE_DIR (/code)           → deploy checkout (e.g. /root/itms)
#   /var/run/docker.sock       → host docker daemon (helper-container mode)
#   /run/secrets/registry-token → registry token file, if present (otherwise
#                                  REGISTRY_TOKEN env is used)
#
# Env overrides:
#   CODE_DIR (default /code)   deploy checkout directory
#   BRANCH (default main)      branch to deploy from
#   PROJECT (default itms)     compose project name
#   COMPOSE_FILE (default docker-compose.yml)
#   ENV_FILE (default .env)    compose env file
#   REGISTRY (default ghcr.io)
#   PUSH_USER (default shridhargsabat)  registry push identity
#   REGISTRY_TOKEN (or token file)      registry password (GHCR: GITHUB_TOKEN)
#   LATEST_TAG (default itms-latest)
#   IMAGE_PREFIX (default itms)  image name stem → itms-backend / itms-frontend
set -eu

# ── Config ──────────────────────────────────────────────────────────────
CODE_DIR="${CODE_DIR:-/code}"
BRANCH="${BRANCH:-main}"
PROJECT="${PROJECT:-itms}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"
REGISTRY="${REGISTRY:-ghcr.io}"
PUSH_USER="${PUSH_USER:-shridhargsabat}"
LATEST_TAG="${LATEST_TAG:-itms-latest}"
IMAGE_PREFIX="${IMAGE_PREFIX:-itms}"

cd "$CODE_DIR"

# ── 1. Reset checkout to the branch tip ─────────────────────────────────
# Retry: the VPS uplink is occasionally filtered/flaky — a single failed
# fetch must not fail the deploy, and failures must be VISIBLE (an early
# version silenced git stderr and died as a bare exit 128).
FETCH_OK=""
for i in 1 2 3; do
  if OUT=$(git fetch --force origin "$BRANCH:refs/remotes/origin/$BRANCH" 2>&1); then
    echo "$OUT" | tail -2
    FETCH_OK=1
    break
  fi
  echo "$OUT" | tail -3 >&2
  echo "!! fetch attempt $i failed — retrying in 10s" >&2
  sleep 10
done
[ -n "$FETCH_OK" ] || { echo "FATAL: git fetch origin $BRANCH failed 3 times" >&2; exit 1; }
git checkout -f --detach "refs/remotes/origin/$BRANCH"
git reset --hard "refs/remotes/origin/$BRANCH"
SHA="$(git rev-parse --short=8 HEAD)"
TAG="itms-${SHA}"
BACKEND_IMG="${REGISTRY}/${PUSH_USER}/${IMAGE_PREFIX}-backend"
FRONTEND_IMG="${REGISTRY}/${PUSH_USER}/${IMAGE_PREFIX}-frontend"
echo "==> Building ITMS for ${BRANCH} @ ${SHA}"

# ── 2. Registry login ───────────────────────────────────────────────────
REG_TOKEN="$(cat /run/secrets/registry-token 2>/dev/null || echo "${REGISTRY_TOKEN:-}")"
if [ -z "$REG_TOKEN" ]; then
  echo "FATAL: no registry token (/run/secrets/registry-token or REGISTRY_TOKEN)" >&2
  exit 1
fi
echo "$REG_TOKEN" | docker login "$REGISTRY" -u "$PUSH_USER" --password-stdin >/dev/null 2>&1
echo "==> Registry login OK (${PUSH_USER}@${REGISTRY})"

# ── 3. Build + push backend ─────────────────────────────────────────────
echo "==> Building backend..."
docker build --build-arg BUILD_SHA="$TAG" \
  -t "${BACKEND_IMG}:${TAG}" -t "${BACKEND_IMG}:${LATEST_TAG}" \
  -f backend/Dockerfile backend
docker push "${BACKEND_IMG}:${TAG}" >/dev/null
docker push "${BACKEND_IMG}:${LATEST_TAG}" >/dev/null
echo "==> Pushed ${BACKEND_IMG}:${TAG} + ${LATEST_TAG}"

# ── 4. Build + push frontend ────────────────────────────────────────────
echo "==> Building frontend..."
# BUILD_SHA is baked into the runtime so the in-app version badge + PWA show
# the exact deploy commit (frontend Dockerfile ARG BUILD_SHA).
docker build --build-arg BUILD_SHA="$TAG" \
  -t "${FRONTEND_IMG}:${TAG}" -t "${FRONTEND_IMG}:${LATEST_TAG}" \
  -f frontend/Dockerfile frontend
docker push "${FRONTEND_IMG}:${TAG}" >/dev/null
docker push "${FRONTEND_IMG}:${LATEST_TAG}" >/dev/null
echo "==> Pushed ${FRONTEND_IMG}:${TAG} + ${LATEST_TAG}"

# ── 5. Deploy — pull freshly pushed images, recreate BOTH services ──────
BACKEND_TAG="$TAG" FRONTEND_TAG="$TAG" \
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -p "$PROJECT" \
  up -d --pull always --remove-orphans
echo "==> Deployed ${PROJECT} with backend+frontend ${TAG}"

# ── 6. Smoke test ───────────────────────────────────────────────────────
echo "==> Waiting for backend health..."
# /healthz answers HTTP 200 with a PLAIN 'ok' body (text/plain, not JSON).
for i in $(seq 1 30); do
  if [ "$(docker exec "$PROJECT-backend" wget -qO- http://localhost:8080/api/v1/healthz 2>/dev/null)" = "ok" ]; then
    echo "==> Healthz OK (attempt $i)"
    break
  fi
  [ "$i" = 30 ] && { echo "!! healthz never became ready — backend may be unhealthy" >&2; }
  sleep 2
done

echo "==> Smoke: /api/v1/dashboard/metrics ..."
# No host port is exposed, so probe from inside the backend container. HTTP 200
# or 401 both prove the API stack answers (/metrics is auth-gated by design).
METRICS_CODE="$(docker exec "$PROJECT-backend" wget -S -O /dev/null http://localhost:8080/api/v1/dashboard/metrics 2>&1 | grep -oE 'HTTP/[0-9.]+ [0-9]{3}' | tail -1 | awk '{print $2}')"
if [ "$METRICS_CODE" = "200" ] || [ "$METRICS_CODE" = "401" ]; then
  echo "==> metrics endpoint OK (HTTP ${METRICS_CODE})"
else
  echo "!! metrics endpoint smoke failed (HTTP ${METRICS_CODE:-none})" >&2
fi

# ── 7. Freshness guard (non-blocking, loud warning) ─────────────────────
# Compose --pull always should recreate both containers; if the backend came
# up with an OLD digest anyway, warn loudly rather than fail the run.
BACKEND_IMAGE="$(docker inspect "${PROJECT}-backend" --format '{{.Image}}' 2>/dev/null || true)"
BACKEND_TAG_LABEL=""
# Best-effort: check the running container's image ref via docker inspect
RUNNING_IMG="$(docker inspect "${PROJECT}-backend" --format '{{index .Config.Image}}' 2>/dev/null || true)"
case "$RUNNING_IMG" in
  *"${TAG}"*) echo "==> freshness OK: backend running ${RUNNING_IMG}" ;;
  "")
    echo "!! WARN: could not read backend container image — check itms-backend" >&2
    ;;
  *)
    echo "!! WARN: backend NOT running expected ${BACKEND_IMG}:${TAG} — got ${RUNNING_IMG}. Check for stale container (compose --pull always should have recreated it)." >&2
    ;;
esac

docker logout "$REGISTRY" >/dev/null 2>&1 || true
echo "==> Done"
