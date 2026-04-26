# Runbook: Indexing Worker Deployment & Scaling

## Overview
The Soroban Indexing Worker is a critical backend component that synchronizes on-chain events (primarily `Deposit`) with the Lance application database. It ensures real-time data availability for the frontend with minimal latency.

## Architecture
- **Runtime**: Rust (Tokio)
- **Database**: PostgreSQL (Checkpointing & Event Storage)
- **RPC**: Soroban Remote Procedure Call via HTTP
- **Logging**: Tracing (Structured)
- **Scale**: Horizontal (though typically one instance per network is sufficient due to idempotency)

---

## Deployment Configuration

### Environment Variables
| Variable | Description | Recommended Value |
|----------|-------------|-------------------|
| `SOROBAN_RPC_URL` | URL of the Soroban network node | `https://soroban-testnet.stellar.org` |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://user:pass@db:5432/lance` |
| `INDEXER_MAX_LEDGER_LAG` | Max allowed lag before health check fails | `5` |
| `RUST_LOG` | Log verbosity level | `info,backend::indexer=debug` |

### Docker Deployment
```yaml
services:
  indexer:
    image: lance-backend:latest
    command: ["./backend"] # Assuming binary is at root
    environment:
      - SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
      - DATABASE_URL=postgres://postgres:postgres@db:5432/lance
    deploy:
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 10
        window: 120s
```

---

## Scaling Strategies

### Horizontal Scaling
The indexer is **idempotent**. Multiple instances can safely run against the same database:
1. They will compete for the `indexer_state` update.
2. The `ON CONFLICT DO NOTHING` in `indexed_events` and `deposits` ensures no data duplication.
3. **Recommendation**: For production, run 2 instances across different availability zones for high availability, not necessarily for throughput (one instance typically handles testnet/mainnet volume easily).

### Database Partitioning
As the `deposits` table grows, consider partitioning by `ledger` number (range partitioning) to keep query performance high.

---

## Troubleshooting & Maintenance

### 1. Indexer is Lagging
**Symptoms**: `Sync_Lag > 5` in dashboard.
**Checks**:
- Verify RPC endpoint connectivity (`curl -X POST $SOROBAN_RPC_URL ...`).
- Check database CPU usage.
- Look for `Indexer error` in logs (indicates retry backoff).

### 2. Manual Re-scan
If an event was missed or the contract was updated:
1. Update `last_processed_ledger` in `indexer_state` to a lower value.
2. The worker will automatically restart from that checkpoint.
```sql
UPDATE indexer_state SET last_processed_ledger = 45000 WHERE id = 1;
```

### 3. Database Corruption/Duplication
The system uses the Soroban Event ID (`0000000123-0001`) as a primary key. It is physically impossible to have duplicates if the primary key constraint is active.

---

## Monitoring
- **Dashboard**: `/admin/monitoring/deposit-indexing`
- **Prometheus Metrics**: `GET /metrics`
- **Health Check**: `GET /health` (Reports 503 if lagging)
