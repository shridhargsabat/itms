# syntax=docker/dockerfile:1
FROM rust:1.97-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
# Cache mounts persist the cargo registry (no re-download) and target/ (deps
# compiled once) across builds — source-only changes rebuild only our crates.
# NOTE: cache-mount content is invisible to COPY --from (not part of the stage
# snapshot), so the binaries are copied to /app/out (regular layer path) first.
RUN --mount=type=cache,target=/app/target \
    --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --release --bin server --bin seed \
    && mkdir -p /app/out \
    && cp /app/target/release/server /app/out/server \
    && cp /app/target/release/seed /app/out/seed

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/out/server /usr/local/bin/server
COPY --from=builder /app/out/seed /usr/local/bin/seed
EXPOSE 8080
CMD ["server"]
