# syntax: docker/dockerfile:1
# #90: base images pinned by DIGEST (no mutable tags); runtime runs as
# unprivileged user 10001 with a chown'd /app/uploads (volume-mounted).
FROM rust:1.97-slim@sha256:8e8cf8f7fd54a2d23d5a743b3a03f56e26b6c774276c33fa0595111704ebb15c AS builder
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
RUN --mount=type=cache,id=itms-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=itms-cargo-target,target=/app/target \
    cargo build --release --bin server --bin seed && \
    mkdir -p /app/dist && \
    cp /app/target/release/server /app/target/release/seed /app/dist/

FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget \
    && groupadd -g 10001 itms && useradd -u 10001 -g itms -d /app -s /usr/sbin/nologin itms \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/dist/server /usr/local/bin/server
COPY --from=builder /app/dist/seed /usr/local/bin/seed
# Uploads volume is mounted here; must be writable by the non-root user (#90).
RUN mkdir -p /app/uploads && chown -R itms:itms /app
USER 10001:10001
EXPOSE 8080
CMD ["server"]