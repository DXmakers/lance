FROM rust:1.78-slim AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache dependencies
COPY Cargo.toml Cargo.lock ./
COPY backend/Cargo.toml backend/Cargo.toml
COPY contracts/escrow/Cargo.toml contracts/escrow/Cargo.toml
COPY contracts/reputation/Cargo.toml contracts/reputation/Cargo.toml
COPY contracts/job_registry/Cargo.toml contracts/job_registry/Cargo.toml

# Dummy sources so cargo can resolve the workspace
RUN mkdir -p backend/src contracts/escrow/src contracts/reputation/src contracts/job_registry/src && \
    echo "fn main() {}" > backend/src/main.rs && \
    echo "" > backend/src/lib.rs && \
    echo "" > contracts/escrow/src/lib.rs && \
    echo "" > contracts/reputation/src/lib.rs && \
    echo "" > contracts/job_registry/src/lib.rs

RUN cargo build --release -p backend 2>/dev/null || true

# Real build
COPY backend backend
RUN touch backend/src/main.rs backend/src/lib.rs && \
    cargo build --release -p backend

# ── API server image ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS api
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/backend /usr/local/bin/backend
COPY backend/migrations /app/migrations
WORKDIR /app
CMD ["backend"]

# ── Worker image ──────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS worker
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/worker /usr/local/bin/worker
COPY backend/migrations /app/migrations
WORKDIR /app
CMD ["worker"]
