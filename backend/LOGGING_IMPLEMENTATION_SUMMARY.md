# Structured Logging Implementation Summary

## What Was Implemented

Comprehensive structured logging using the Tracing crate to provide detailed visibility into the worker's internal state, processing flow, and errors. Enhanced health check endpoints that accurately report the indexer's sync status including lag behind the current network ledger height.

## Key Enhancements

### 1. Structured Logging with Tracing Crate

**Files Modified:**
- `backend/src/ledger_follower.rs`
- `backend/src/soroban_rpc.rs`
- `backend/src/routes/health.rs`

**Added Features:**

#### Function Instrumentation
```rust
#[instrument(skip(self), fields(worker_version = WORKER_VERSION))]
pub async fn run(&mut self) { ... }

#[instrument(skip(self), fields(cycle_id = tracing::field::Empty))]
pub async fn next_cycle(&mut self) -> Result<LedgerCycle> { ... }

#[instrument(skip(self), fields(rpc_url = %self.config.url))]
pub async fn get_latest_ledger(&mut self) -> Result<i64> { ... }
```

**Benefits:**
- Automatic span creation with function context
- Hierarchical trace structure
- Parameter capture for debugging

#### Contextual Spans
```rust
let cycle_span = tracing::info_span!(
    "indexer_cycle",
    attempt = worker_retry_attempt
);
let _enter = cycle_span.enter();
```

**Benefits:**
- Groups related log entries
- Provides execution context
- Enables distributed tracing

#### Structured Fields in Logs

**Worker Startup:**
```rust
info!(
    worker_version = WORKER_VERSION,
    target_processing_time_ms = TARGET_PROCESSING_TIME_MS,
    idle_poll_ms = self.config.idle_poll_interval.as_millis() as u64,
    active_poll_ms = self.config.active_poll_interval.as_millis() as u64,
    "ledger follower worker started"
);
```

**Cycle Completion:**
```rust
info!(
    checkpoint = cycle.checkpoint,
    latest_network_ledger = cycle.latest_network_ledger,
    ledger_lag = cycle.latest_network_ledger - cycle.checkpoint,
    inserted_events = cycle.inserted_events,
    processing_time_ms = cycle.processing_time_ms,
    total_cycle_time_ms = elapsed_ms,
    events_per_second = rate_per_second,
    caught_up = cycle.caught_up(),
    is_lagging = cycle.is_lagging(),
    "indexer cycle completed successfully"
);
```

**Error Logging:**
```rust
error!(
    error = %err,
    error_debug = ?err,
    attempt = worker_retry_attempt,
    max_attempts = self.config.worker_retry_policy.max_attempts,
    "indexer worker cycle failed"
);
```

**RPC Operations:**
```rust
debug!(
    start_ledger,
    latest_network_ledger,
    events_count = events.len(),
    ledger_range = latest_network_ledger - start_ledger,
    "fetched events from RPC"
);
```

### 2. Enhanced Health Check Endpoints

#### Liveness Endpoint
**Endpoint:** `GET /api/health/liveness`

**Enhanced Response:**
```json
{
  "status": "alive",
  "timestamp": "2026-04-28T10:30:47Z"
}
```

**Added:**
- Timestamp for request tracking
- Structured logging of health checks

#### Readiness Endpoint
**Endpoint:** `GET /api/health/readiness`

**Enhanced Response:**
```json
{
  "status": "ready",
  "db": "connected",
  "timestamp": "2026-04-28T10:30:47Z"
}
```

**Added:**
- Timestamp
- Error logging for database failures
- Debug logging for successful checks

#### Sync Status Endpoint
**Endpoint:** `GET /api/health/sync`

**Enhanced Response:**
```json
{
  "status": "ok",
  "in_sync": true,
  "is_stale": false,
  "max_allowed_lag": 5,
  "last_processed_ledger": 12345,
  "latest_network_ledger": 12346,
  "ledger_lag": 1,
  "ledger_lag_percentage": 0.008,
  "last_updated_at": "2026-04-28T10:30:45Z",
  "seconds_since_update": 2,
  "error_count": 0,
  "total_events_processed": 50000,
  "last_batch_events_processed": 42,
  "last_batch_rate_per_second": 28,
  "last_loop_duration_ms": 1500,
  "last_rpc_latency_ms": 234,
  "rpc_retry_count": 0,
  "timestamp": "2026-04-28T10:30:47Z",
  "rpc": {
    "url": "https://soroban-testnet.stellar.org",
    "reachable": true
  }
}
```

**New Fields:**
- `is_stale`: Whether last update was >5 minutes ago
- `seconds_since_update`: Time since last checkpoint update
- `ledger_lag_percentage`: Lag as percentage of network height
- `timestamp`: Current server time

**Structured Logging:**
```rust
debug!(
    status,
    last_processed_ledger = source_last_processed,
    latest_network_ledger = ?latest_network,
    lag = ?lag,
    in_sync,
    is_stale,
    seconds_since_update,
    "sync status check completed"
);
```

#### Health Endpoint
**Endpoint:** `GET /api/health`

**Enhanced Response:**
```json
{
  "status": "healthy",
  "db": "connected",
  "timestamp": "2026-04-28T10:30:47Z",
  "indexer_sync_status": { ... },
  "indexer_health": { ... }
}
```

**Added:**
- Overall status calculation
- Timestamp
- Structured logging of health checks

#### Indexer Health Endpoint
**Endpoint:** `GET /api/health/indexer`

**Enhanced Response:**
```json
{
  "status": "healthy",
  "last_processed_ledger": 12345,
  "last_successful_cycle_at": "2026-04-28T10:30:45Z",
  "last_error_at": null,
  "last_error_message": null,
  "total_cycles_completed": 1000,
  "total_events_processed": 50000,
  "worker_version": "v1.2.0",
  "updated_at": "2026-04-28T10:30:45Z",
  "seconds_since_last_success": 2,
  "total_indexed_events": 50000,
  "failed_ledgers_count": 0,
  "timestamp": "2026-04-28T10:30:47Z"
}
```

**Added:**
- Timestamp
- Comprehensive structured logging

**Structured Logging:**
```rust
debug!(
    health_status = %health_row.health_status,
    last_processed_ledger = health_row.last_processed_ledger,
    total_cycles_completed = health_row.total_cycles_completed,
    total_events_processed = health_row.total_events_processed,
    seconds_since_last_success = ?health_row.seconds_since_last_success,
    failed_ledgers_count = health_row.failed_ledgers_count,
    worker_version = %health_row.worker_version,
    "indexer health check completed"
);
```

### 3. Detailed Event Processing Logging

**Added Logging:**
```rust
debug!(
    start_ledger,
    last_processed_ledger,
    "fetching events from RPC"
);

debug!(
    start_ledger,
    latest_network_ledger = events_response.latest_network_ledger,
    events_count = events_response.events.len(),
    ledger_lag = events_response.latest_network_ledger - last_processed_ledger,
    "received events from RPC"
);

debug!(
    log_id,
    start_ledger,
    events_count = events_response.events.len(),
    "created processing log entry"
);

warn!(
    ledger,
    contract_id,
    "skipping event with empty id"
);
```

### 4. Enhanced Error Logging

**Before:**
```rust
error!(
    attempt = worker_retry_attempt,
    backoff_ms = backoff.as_millis() as u64,
    error = %err,
    "indexer worker cycle failed",
);
```

**After:**
```rust
error!(
    error = %err,
    error_debug = ?err,
    attempt = worker_retry_attempt,
    max_attempts = self.config.worker_retry_policy.max_attempts,
    "indexer worker cycle failed"
);

warn!(
    attempt = worker_retry_attempt,
    backoff_ms = backoff.as_millis() as u64,
    next_retry_at = ?std::time::SystemTime::now() + backoff,
    "retrying indexer worker cycle after backoff",
);
```

**Benefits:**
- Both display and debug error formatting
- Retry context (current attempt, max attempts)
- Next retry timestamp
- Separate error and retry warning logs

## Log Output Examples

### JSON Format (Production)

```json
{
  "timestamp": "2026-04-28T10:30:45.123Z",
  "level": "INFO",
  "target": "backend::ledger_follower",
  "span": {
    "name": "indexer_cycle",
    "attempt": 0
  },
  "fields": {
    "checkpoint": 12345,
    "latest_network_ledger": 12346,
    "ledger_lag": 1,
    "inserted_events": 42,
    "processing_time_ms": 1234,
    "total_cycle_time_ms": 1500,
    "events_per_second": 28,
    "caught_up": false,
    "is_lagging": false,
    "message": "indexer cycle completed successfully"
  }
}
```

### Human-Readable Format (Development)

```
2026-04-28T10:30:45.123Z  INFO backend::ledger_follower: indexer cycle completed successfully
    in indexer_cycle{attempt=0}
    checkpoint: 12345
    latest_network_ledger: 12346
    ledger_lag: 1
    inserted_events: 42
    processing_time_ms: 1234
    total_cycle_time_ms: 1500
    events_per_second: 28
    caught_up: false
    is_lagging: false
```

## Configuration

### Environment Variables

```bash
# Log level
RUST_LOG=backend=info

# Module-specific logging
RUST_LOG=backend::ledger_follower=debug,backend::soroban_rpc=info

# Very verbose
RUST_LOG=backend=trace
```

### Log Filtering Examples

```bash
# Show only errors and warnings
RUST_LOG=backend=warn

# Show info and above
RUST_LOG=backend=info

# Show debug for specific modules
RUST_LOG=backend::ledger_follower=debug,backend::routes::health=debug
```

## Monitoring and Alerting

### Query Examples

**Find slow processing cycles:**
```bash
grep "exceeded target time" logs/backend.log
```

**Track lag over time:**
```bash
cat logs/backend.log | jq -r 'select(.fields.ledger_lag) | "\(.timestamp) \(.fields.ledger_lag)"'
```

**Find errors:**
```bash
grep "ERROR" logs/backend.log
```

**Calculate average processing time:**
```bash
cat logs/backend.log | \
  jq -s '[.[] | select(.fields.processing_time_ms) | .fields.processing_time_ms] | add/length'
```

### Health Check Monitoring

**Check sync status:**
```bash
curl http://localhost:3001/api/health/sync | jq '.ledger_lag'
```

**Check if stale:**
```bash
curl http://localhost:3001/api/health/sync | jq '.is_stale'
```

**Get lag percentage:**
```bash
curl http://localhost:3001/api/health/sync | jq '.ledger_lag_percentage'
```

**Check overall health:**
```bash
curl http://localhost:3001/api/health | jq '.status'
```

## Benefits

### 1. Observability
- **Structured Fields**: Easy to query and filter
- **Contextual Spans**: Understand execution flow
- **Detailed Metrics**: Track performance and errors

### 2. Debugging
- **Error Context**: Full error details with context
- **Execution Traces**: Follow request flow
- **State Visibility**: See internal worker state

### 3. Monitoring
- **Health Endpoints**: Accurate sync status
- **Lag Tracking**: Know exactly how far behind
- **Performance Metrics**: Processing time, throughput

### 4. Alerting
- **Structured Data**: Easy to create alerts
- **Detailed Context**: Understand what went wrong
- **Trend Analysis**: Track metrics over time

## Files Modified

1. **backend/src/ledger_follower.rs**
   - Added `#[instrument]` to `run()` and `next_cycle()`
   - Enhanced logging with structured fields
   - Added contextual spans for cycles
   - Improved error logging with debug formatting

2. **backend/src/soroban_rpc.rs**
   - Added `#[instrument]` to RPC methods
   - Enhanced logging with structured fields
   - Added detailed RPC operation logging

3. **backend/src/routes/health.rs**
   - Added `#[instrument]` to all health endpoints
   - Enhanced responses with timestamps
   - Added `is_stale` and `seconds_since_update` fields
   - Added `ledger_lag_percentage` calculation
   - Comprehensive structured logging for all checks

## Documentation Created

1. **STRUCTURED_LOGGING.md**
   - Comprehensive logging guide
   - Log structure and formats
   - Filtering and querying examples
   - Integration with log aggregation tools
   - Best practices and troubleshooting

2. **LOGGING_IMPLEMENTATION_SUMMARY.md**
   - This file - implementation overview

## Usage Examples

### View Logs in Development

```bash
# Start with debug logging
RUST_LOG=backend=debug cargo run --bin backend

# Watch logs in real-time
tail -f logs/backend.log

# Filter for specific events
tail -f logs/backend.log | grep "indexer cycle completed"
```

### Query Logs in Production

```bash
# Using jq for JSON logs
cat logs/backend.log | jq 'select(.level == "ERROR")'

# Find high lag
cat logs/backend.log | jq 'select(.fields.ledger_lag > 100)'

# Find slow processing
cat logs/backend.log | jq 'select(.fields.processing_time_ms > 5000)'
```

### Monitor Health

```bash
# Check sync status
watch -n 5 'curl -s http://localhost:3001/api/health/sync | jq "{status, lag: .ledger_lag, stale: .is_stale}"'

# Check overall health
watch -n 10 'curl -s http://localhost:3001/api/health | jq .status'
```

## Verification

To verify the implementation:

1. **Start the backend:**
   ```bash
   RUST_LOG=backend=debug cargo run --bin backend
   ```

2. **Check logs appear:**
   ```bash
   tail -f logs/backend.log
   ```

3. **Verify structured fields:**
   ```bash
   cat logs/backend.log | jq '.fields'
   ```

4. **Test health endpoints:**
   ```bash
   curl http://localhost:3001/api/health | jq
   curl http://localhost:3001/api/health/sync | jq
   ```

5. **Verify lag reporting:**
   ```bash
   curl http://localhost:3001/api/health/sync | jq '{lag: .ledger_lag, percentage: .ledger_lag_percentage, stale: .is_stale}'
   ```

## Next Steps

### Recommended Enhancements

1. **Log Aggregation**
   - Set up Loki or Elasticsearch
   - Configure log shipping
   - Create dashboards

2. **Alerting**
   - Set up Prometheus alerts
   - Configure log-based alerts
   - Set up notification channels

3. **Tracing**
   - Add distributed tracing
   - Integrate with Jaeger or Zipkin
   - Trace cross-service requests

4. **Metrics**
   - Export custom metrics
   - Create Grafana dashboards
   - Set up SLO monitoring

## Conclusion

The structured logging implementation provides:
- ✅ Detailed visibility into worker internal state
- ✅ Comprehensive error context and debugging information
- ✅ Accurate sync status reporting with lag metrics
- ✅ Enhanced health check endpoints
- ✅ Structured fields for easy querying and filtering
- ✅ Hierarchical spans for execution flow tracking
- ✅ Production-ready JSON logging
- ✅ Development-friendly human-readable logs

The implementation is production-ready and provides all necessary observability for monitoring, debugging, and alerting on the ledger indexer worker.
