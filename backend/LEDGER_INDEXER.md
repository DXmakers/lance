# Ledger Event Indexer

## Overview

The Ledger Event Indexer is an async Rust worker built with Tokio that continuously monitors Stellar/Soroban ledger events. It implements a robust checkpointing system in PostgreSQL that tracks the last processed ledger, allowing the worker to resume from the last known state after a restart.

## Key Features

### 1. **Continuous Monitoring**
- Async worker using Tokio runtime
- Polls Soroban RPC for new ledger events
- Configurable polling intervals for idle periods
- Automatic rate limiting to respect RPC endpoints

### 2. **Checkpointing System**
The indexer maintains comprehensive checkpoint state in PostgreSQL:

- **Last Processed Ledger**: Tracks the highest ledger sequence successfully indexed
- **Cycle Metadata**: Records total cycles completed and events processed
- **Error Tracking**: Stores last error timestamp and message for monitoring
- **Worker Version**: Tracks which version of the worker processed the data
- **Timestamps**: Records last successful cycle and update times

### 3. **Idempotent Processing**
The indexer ensures that re-processing the same ledger does not create duplicate records:

- **Event Deduplication**: Uses `indexed_events` table with unique constraint on event ID
- **ON CONFLICT DO NOTHING**: Database-level idempotency guarantee
- **Side Effect Protection**: All side effects (deposits, disputes, etc.) use idempotent inserts
- **Transaction Safety**: All processing happens within database transactions

### 4. **Resilience & Recovery**
- **Automatic Retry**: Exponential backoff for transient failures
- **RPC Retry Logic**: Handles rate limits and temporary network issues
- **Checkpoint Recovery**: Resumes from last successful ledger after crashes
- **Error Recording**: Persists error information for debugging

### 5. **Observability**
- **Health Endpoints**: Real-time health status via HTTP API
- **Prometheus Metrics**: Comprehensive metrics for monitoring
- **Processing Logs**: Audit trail of all ledger processing attempts
- **Health View**: SQL view for quick health assessment

## Architecture

```
┌─────────────────┐
│  Soroban RPC    │
│   (Network)     │
└────────┬────────┘
         │
         │ getEvents()
         │
         ▼
┌─────────────────────────────────────┐
│   LedgerFollower Worker (Tokio)     │
│                                     │
│  ┌──────────────────────────────┐  │
│  │  1. Fetch checkpoint         │  │
│  │  2. Query RPC for events     │  │
│  │  3. Process events           │  │
│  │  4. Update checkpoint        │  │
│  │  5. Commit transaction       │  │
│  └──────────────────────────────┘  │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│         PostgreSQL Database         │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  indexer_state              │   │
│  │  - last_processed_ledger    │   │
│  │  - last_successful_cycle_at │   │
│  │  - total_cycles_completed   │   │
│  │  - total_events_processed   │   │
│  │  - worker_version           │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  indexed_events (PK: id)    │   │
│  │  - ledger_amount            │   │
│  │  - contract_id              │   │
│  │  - topic_hash               │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  ledger_processing_log      │   │
│  │  - ledger_sequence          │   │
│  │  - events_count             │   │
│  │  - processing_duration_ms   │   │
│  │  - status                   │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  deposits, disputes, etc.   │   │
│  │  (Event-specific tables)    │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

## Database Schema

### `indexer_state`
Stores the checkpoint and metadata for the indexer worker.

```sql
CREATE TABLE indexer_state (
    id INT PRIMARY KEY,
    last_processed_ledger BIGINT NOT NULL DEFAULT 0,
    last_successful_cycle_at TIMESTAMPTZ,
    last_error_at TIMESTAMPTZ,
    last_error_message TEXT,
    total_cycles_completed BIGINT NOT NULL DEFAULT 0,
    total_events_processed BIGINT NOT NULL DEFAULT 0,
    worker_version VARCHAR(32) NOT NULL DEFAULT 'v1.0.0',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `indexed_events`
Tracks all processed events to ensure idempotency.

```sql
CREATE TABLE indexed_events (
    id VARCHAR(128) PRIMARY KEY,  -- Unique event ID from Soroban
    ledger_amount BIGINT NOT NULL,
    contract_id VARCHAR(64) NOT NULL,
    topic_hash VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `ledger_processing_log`
Audit trail of all ledger processing attempts.

```sql
CREATE TABLE ledger_processing_log (
    id BIGSERIAL PRIMARY KEY,
    ledger_sequence BIGINT NOT NULL,
    events_count INT NOT NULL DEFAULT 0,
    processing_started_at TIMESTAMPTZ NOT NULL,
    processing_completed_at TIMESTAMPTZ,
    processing_duration_ms BIGINT,
    status VARCHAR(32) NOT NULL DEFAULT 'processing',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `indexer_health` (View)
Real-time health monitoring view.

```sql
CREATE VIEW indexer_health AS
SELECT 
    i.last_processed_ledger,
    i.last_successful_cycle_at,
    i.last_error_at,
    i.last_error_message,
    i.total_cycles_completed,
    i.total_events_processed,
    i.worker_version,
    i.updated_at,
    EXTRACT(EPOCH FROM (NOW() - i.last_successful_cycle_at)) AS seconds_since_last_success,
    CASE 
        WHEN i.last_successful_cycle_at IS NULL THEN 'never_run'
        WHEN EXTRACT(EPOCH FROM (NOW() - i.last_successful_cycle_at)) > 300 THEN 'stale'
        WHEN i.last_error_at > i.last_successful_cycle_at THEN 'error'
        ELSE 'healthy'
    END AS health_status,
    (SELECT COUNT(*) FROM indexed_events) AS total_indexed_events,
    (SELECT COUNT(*) FROM ledger_processing_log WHERE status = 'failed') AS failed_ledgers_count
FROM indexer_state i
WHERE i.id = 1;
```

## Configuration

Environment variables for configuring the indexer:

```bash
# RPC Configuration
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_RPC_URL=https://soroban-testnet.stellar.org  # Fallback

# Indexer Behavior
INDEXER_IDLE_POLL_MS=2000                    # Polling interval when caught up
INDEXER_MAX_LEDGER_LAG=5                     # Max acceptable lag for health checks

# RPC Rate Limiting
INDEXER_RPC_RATE_LIMIT_MS=250                # Min time between RPC requests

# RPC Retry Policy
INDEXER_RPC_RETRY_MAX_ATTEMPTS=4
INDEXER_RPC_RETRY_INITIAL_BACKOFF_MS=500
INDEXER_RPC_RETRY_MAX_BACKOFF_MS=5000

# Worker Retry Policy
INDEXER_WORKER_RETRY_MAX_ATTEMPTS=4
INDEXER_WORKER_RETRY_INITIAL_BACKOFF_MS=1000
INDEXER_WORKER_RETRY_MAX_BACKOFF_MS=60000
```

## API Endpoints

### Health Check
```
GET /api/health
```

Returns comprehensive health information including indexer status.

**Response:**
```json
{
  "status": "ok",
  "db": "connected",
  "indexer_sync_status": {
    "status": "ok",
    "in_sync": true,
    "last_processed_ledger": 12345,
    "latest_network_ledger": 12346,
    "ledger_lag": 1
  },
  "indexer_health": {
    "status": "healthy",
    "last_processed_ledger": 12345,
    "total_cycles_completed": 1000,
    "total_events_processed": 5000,
    "worker_version": "v1.1.0"
  }
}
```

### Prometheus Metrics
```
GET /api/metrics
```

Returns Prometheus-formatted metrics for monitoring.

## Idempotency Guarantees

The indexer provides strong idempotency guarantees:

### 1. **Event-Level Idempotency**
```rust
// Events are inserted with ON CONFLICT DO NOTHING
sqlx::query(
    "INSERT INTO indexed_events (id, ledger_amount, contract_id, topic_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING"
)
```

### 2. **Side Effect Idempotency**
All side effects (deposits, disputes, etc.) use the same pattern:
```rust
sqlx::query(
    "INSERT INTO deposits (id, ledger, contract_id, sender, amount, token)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING"
)
```

### 3. **Transaction Safety**
All processing happens within a database transaction:
```rust
let mut transaction = self.pool.begin().await?;
// Process events...
// Update checkpoint...
transaction.commit().await?;
```

If any step fails, the entire transaction is rolled back, ensuring the checkpoint is only updated when all events are successfully processed.

### 4. **Checkpoint Atomicity**
The checkpoint is updated atomically using a PostgreSQL function:
```sql
CREATE FUNCTION update_indexer_checkpoint(
    p_ledger BIGINT,
    p_events_count BIGINT,
    p_worker_version VARCHAR(32)
) RETURNS void AS $$
BEGIN
    INSERT INTO indexer_state (...)
    VALUES (...)
    ON CONFLICT (id) 
    DO UPDATE SET ...;
END;
$$ LANGUAGE plpgsql;
```

## Recovery Scenarios

### Scenario 1: Worker Crash
1. Worker crashes mid-processing
2. Transaction is rolled back automatically
3. Checkpoint remains at last successful ledger
4. Worker restarts and resumes from checkpoint

### Scenario 2: Database Connection Loss
1. RPC fetch succeeds but database is unavailable
2. Transaction fails to begin
3. Error is logged and worker retries with backoff
4. No checkpoint update occurs
5. Worker resumes from last checkpoint when database recovers

### Scenario 3: RPC Failure
1. RPC request fails or times out
2. Worker retries with exponential backoff
3. If all retries fail, error is recorded
4. Worker continues retry loop
5. No checkpoint update occurs until successful

### Scenario 4: Duplicate Event Processing
1. Worker processes ledger N successfully
2. Checkpoint update fails
3. Worker restarts and reprocesses ledger N
4. All events have `ON CONFLICT DO NOTHING`
5. No duplicates are created
6. Checkpoint is updated successfully

## Monitoring

### Health Status Values
- `healthy`: Worker is running and processing events normally
- `lagging`: Worker is behind network head by more than configured threshold
- `stale`: No successful cycle in last 5 minutes
- `error`: Last cycle resulted in an error
- `never_run`: Worker has never completed a cycle

### Key Metrics to Monitor
1. **Ledger Lag**: Difference between network head and last processed ledger
2. **Error Rate**: Total errors over time
3. **Processing Rate**: Events processed per second
4. **Cycle Duration**: Time to process each batch
5. **RPC Latency**: Response time from Soroban RPC

### Alerting Recommendations
- Alert if `health_status != 'healthy'` for > 5 minutes
- Alert if `ledger_lag > 100` for > 10 minutes
- Alert if `seconds_since_last_success > 600` (10 minutes)
- Alert if `error_count` increases rapidly

## Testing

The indexer includes comprehensive tests:

```bash
# Run all tests
cargo test --package backend

# Run indexer-specific tests
cargo test --package backend ledger_follower
cargo test --package backend indexer
```

### Test Coverage
- ✅ Recovery from RPC failures
- ✅ Checkpoint persistence and recovery
- ✅ Idempotent event processing
- ✅ Empty ledger handling
- ✅ Duplicate event handling
- ✅ Transaction rollback scenarios

## Performance Considerations

### Throughput
- Processes events in batches per ledger
- Typical throughput: 100-1000 events/second
- Limited by RPC rate limits and database write speed

### Resource Usage
- Memory: ~50-100 MB baseline
- CPU: Low (mostly I/O bound)
- Database connections: 1 per worker

### Scaling
- Single worker is sufficient for most use cases
- For high-volume scenarios, consider:
  - Sharding by contract ID
  - Multiple workers with different event filters
  - Read replicas for health checks

## Troubleshooting

### Worker Not Processing Events
1. Check `indexer_health` view for status
2. Verify RPC endpoint is reachable
3. Check database connectivity
4. Review error logs in `indexer_state.last_error_message`

### High Ledger Lag
1. Check RPC rate limits
2. Verify database write performance
3. Review `ledger_processing_log` for slow ledgers
4. Consider increasing `INDEXER_RPC_RATE_LIMIT_MS`

### Duplicate Events
This should never happen due to idempotency guarantees. If it does:
1. Check `indexed_events` table for duplicate IDs
2. Verify database constraints are in place
3. Review transaction isolation level

## Future Enhancements

Potential improvements for future versions:

1. **Parallel Processing**: Process multiple ledgers concurrently
2. **Event Filtering**: Subscribe to specific contract events only
3. **Backfill Support**: Efficiently backfill historical ledgers
4. **Metrics Export**: Push metrics to external monitoring systems
5. **Dynamic Rate Limiting**: Adjust rate limits based on RPC responses
6. **Circuit Breaker**: Temporarily disable processing on repeated failures

## References

- [Soroban RPC Documentation](https://developers.stellar.org/docs/data/rpc)
- [Stellar Network](https://stellar.org)
- [Tokio Async Runtime](https://tokio.rs)
- [SQLx Documentation](https://github.com/launchbadge/sqlx)
