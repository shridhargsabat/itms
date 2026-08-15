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
# build isolated from other sessions' builds.
# CRITICAL: cache-mount contents are EPHEMERAL — they do NOT land in the image
# layer, so COPY --from=builder /app/target/... in the next stage finds
# nothing. Copy the built binaries to a NON-cache path inside this RUN.
RUN --mount=type=cache,id=itms-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=itms-cargo-target,target=/app/target \
    cargo build --release --bin server --bin seed && \
    mkdir -p /app/dist && \
    cp /app/target/release/server /app/target/release/seed /app/dist/
 
 FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/dist/server /usr/local/bin/server
COPY --from=builder /app/dist/seed /usr/local/bin/seed
EXPOSE 8080
CMD ["server"]
