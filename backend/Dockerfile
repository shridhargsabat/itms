# syntax: docker/dockerfile:1
# #90: base images pinned by DIGEST (no mutable tags); runtime runs as
# unprivileged user 10001 with a chown'd /app/uploads (volume-mounted).
# invoice-parse feature: poppler-utils added for pdftoppm (scanned-PDF -> PNG
# rasterization before mimo-v2.5 OCR).
# CRITICAL (glibc match): the BUILDER must be a bookworm-based Rust image so the
# compiled `server` binary links against glibc 2.36 — the runtime stage is
# debian:bookworm-slim (glibc 2.36). A trixie-based builder (rust:1.97-slim
# default) compiles against glibc 2.41 and the binary then dies on the runtime
# with 'GLIBC_2.39 not found' (bit us 2026-08-20 when pdf-extract added a crate
# requiring a newer symbol).
FROM rust:1.97-slim-bookworm@sha256:39f68a3e8e3ff425f8945ffa91128e60ff930d53e17fbb5214e95824bdd46f1b AS builder
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
# BuildKit cache mounts persist the crate registry + target dir ACROSS builds.
# Without them every source change re-downloads ALL crates (~10 min); with
# them only changed crates recompile (seconds). Explicit cache IDs keep this
# build isolated from other sessions' builds.
# CRITICAL: cache-mount contents are EPHEMERAL — they do NOT land in the image
# layer, so COPY --from=builder /app/target/... in the next stage finds
# nothing. Copy the built binaries to a NON-cache path inside this RUN.
# sqlx::migrate! embeds ./migrations at COMPILE time, but cargo cannot see that
# dependency: with the persistent target cache below, a migrations-only change
# (no .rs edits) looks "fresh" (git checkout leaves src mtimes untouched),
# cargo skips the recompile, and the STALE binary — with the old migration
# set — ships under the new tag (#187: 0022 never applied). Touching the
# binary roots forces the final crates to relink whenever this layer reruns
# (deps stay cached: seconds, not minutes). The touch MUST live inside the
# cargo RUN: a separate RUN would cache-hit alongside COPY src.
RUN --mount=type=cache,id=itms-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=itms-cargo-target,target=/app/target \
    touch src/main.rs src/bin/seed.rs src/bin/hashpass.rs && \
    cargo build --release --bin server --bin seed && \
    mkdir -p /app/dist && \
    cp /app/target/release/server /app/target/release/seed /app/dist/

FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget poppler-utils \
    && groupadd -g 10001 itms && useradd -u 10001 -g itms -d /app -s /usr/sbin/nologin itms \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/dist/server /usr/local/bin/server
COPY --from=builder /app/dist/seed /usr/local/bin/seed
# Uploads volume is mounted here; must be writable by the non-root user (#90).
RUN mkdir -p /app/uploads && chown -R itms:itms /app
USER 10001:10001
EXPOSE 8080
CMD ["server"]