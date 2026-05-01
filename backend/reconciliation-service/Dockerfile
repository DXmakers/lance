FROM rust:1.88-bookworm AS builder

WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN cargo build --release --manifest-path backend/reconciliation-service/Cargo.toml

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 reconciliation

WORKDIR /app

COPY --from=builder /workspace/target/release/reconciliation-service /usr/local/bin/reconciliation-service

EXPOSE 3000

USER reconciliation

CMD ["reconciliation-service"]