# Runbook: Soroban Indexer & Worker Infrastructure

## Overview
The Soroban indexer is a core infrastructure component that monitors the Stellar blockchain for ledger events, processes them into the local PostgreSQL database, and ensures downstream services have high-performance access to on-chain data.

## Deployment

### Prerequisites
- Docker & Docker Compose
- PostgreSQL 15+
- Access to a Soroban RPC provider (e.g., Testnet/Mainnet)

### Environment Variables
Configure the following in the `backend/.env` or deployment environment:
- `DATABASE_URL`: Postgres connection string.
- `SOROBAN_RPC_URL`: URL of the Soroban RPC provider.
- `INDEXER_MAX_LEDGER_LAG`: (Default: 5) Max allowed lag before health checks report failure.

### Scaling
The indexer is designed to run as a single-instance worker per cluster to avoid race conditions in checkpointing, although the idempotent indexing logic allows for safe restarts. To scale:
1. Increase horizontal capacity of the *API* services.
2. The *Worker* should remain a singleton (Deployment with `replicas: 1`).

## Monitoring & Observability

### Health Checks
- **Liveness**: `GET /api/health/live` - Basic process check.
- **Readiness**: `GET /api/health/ready` - Checks DB connectivity.
- **Sync Status**: `GET /api/sync-status` - Detailed lag analysis against network ledger.

### Metrics
- **Prometheus**: Scrape `GET /api/metrics`.
  - `indexer_last_processed_ledger`: Current checkpoint.
  - `indexer_total_events_processed`: Throughput counter.
  - `indexer_total_errors`: Error rate tracking.

## Troubleshooting

### High Lag
If `ledger_lag` exceeds `max_allowed_lag`:
1. Check connectivity to `SOROBAN_RPC_URL`.
2. check backend logs: `docker logs lance-backend`.
3. Check DB performance and lock contention on `indexer_state`.

### Missing Events
If events are missing but the indexer is healthy:
1. Trigger a manual re-scan by updating `indexer_state` (see Manual Operations).
2. Verify contract filters in `indexer.rs` match the expected contracts.

## Manual Operations

### Reset/Re-scan Ledger Range
To re-process events from a specific ledger:
```sql
UPDATE indexer_state SET last_processed_ledger = <START_LEDGER> WHERE id = 1;
```

### Force Restart
If the worker hangs (rare), restart the container:
```bash
docker restart lance-backend-worker
```
