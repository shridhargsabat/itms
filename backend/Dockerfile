FROM rust:1.97-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
# BuildKit cache mounts persist the crate registry + target dir ACROSS builds.
# Without them every source change re-downloads ALL crates (~10 min); with
# them only changed crates recompile (seconds). Explicit cache IDs keep this
# build isolated from other sessions' builds — a shared mount path (default
# cache key = target path) gets corrupted when two builds write it
# concurrently (cargo sees fresh fingerprints but the final binaries are
# missing → "COPY .../release/server: not found"). Requires DOCKER_BUILDKIT=1
# (compose default) — classic builder silently ignores the mounts.
RUN --mount=type=cache,id=itms-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=itms-cargo-target,target=/app/target \
    cargo build --release --bin server --bin seed

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/server /usr/local/bin/server
COPY --from=builder /app/target/release/seed /usr/local/bin/seed
EXPOSE 8080
CMD ["server"]
