# Structured Logging Implementation

## Overview

The ledger indexer implements comprehensive structured logging using the Tracing crate to provide detailed visibility into the worker's internal state, processing flow, and errors. All logs include contextual fields that enable efficient filtering, searching, and analysis.

## Key Features

### 1. **Structured Fields**
All log entries include structured fields instead of plain text:
- Numeric values (ledger numbers, counts, durations)
- Boolean flags (caught_up, is_lagging, in_sync)
- Timestamps and durations
- Error details with both display and debug formatting

### 2. **Instrumentation**
Key functions are instrumented with `#[instrument]` macro:
- Automatic span creation with function context
- Parameter capture for debugging
- Hierarchical trace structure

### 3. **Log Levels**
- **ERROR**: Critical failures requiring immediate attention
- **WARN**: Issues that may require investigation
- **INFO**: Important state changes and milestones
- **DEBUG**: Detailed operational information
- **TRACE**: Very detailed debugging information

### 4. **Contextual Spans**
Logs are organized in hierarchical spans:
- Worker lifecycle span
- Indexer cycle span
- RPC request span
- Event processing span

## Logging Structure

### Worker Startup

```rust
info!(
    worker_version = "v1.2.0",
    target_processing_time_ms = 5000,
    idle_poll_ms = 1000,
    active_poll_ms = 500,
    "ledger follower worker started"
);
```

**Fields:**
- `worker_version`: Version of the worker code
- `target_processing_time_ms`: Target time for processing ledgers
- `idle_poll_ms`: Polling interval when caught up
- `active_poll_ms`: Polling interval when lagging

### Indexer Cycle Completion

```rust
info!(
    checkpoint = 12345,
    latest_network_ledger = 12346,
    ledger_lag = 1,
    inserted_events = 42,
    processing_time_ms = 1234,
    total_cycle_time_ms = 1500,
    events_per_second = 28,
    caught_up = false,
    is_lagging = false,
    "indexer cycle completed successfully"
);
```

**Fields:**
- `checkpoint`: Last processed ledger
- `latest_network_ledger`: Current network head
- `ledger_lag`: Number of ledgers behind
- `inserted_events`: Events processed in this cycle
- `processing_time_ms`: Time spent processing events
- `total_cycle_time_ms`: Total cycle time including RPC
- `events_per_second`: Processing throughput
- `caught_up`: Whether indexer is caught up
- `is_lagging`: Whether indexer is significantly behind

### Processing Time Warning

```rust
warn!(
    processing_time_ms = 6234,
    target_ms = 5000,
    checkpoint = 12345,
    events = 1000,
    overage_ms = 1234,
    "ledger processing exceeded target time"
);
```

**Fields:**
- `processing_time_ms`: Actual processing time
- `target_ms`: Target processing time
- `checkpoint`: Ledger that was slow
- `events`: Number of events processed
- `overage_ms`: How much over target

### Error Logging

```rust
error!(
    error = %err,
    error_debug = ?err,
    attempt = 3,
    max_attempts = 5,
    "indexer worker cycle failed"
);
```

**Fields:**
- `error`: Error message (display format)
- `error_debug`: Error with full debug info
- `attempt`: Current retry attempt
- `max_attempts`: Maximum retry attempts

### RPC Operations

```rust
debug!(
    start_ledger = 12345,
    latest_network_ledger = 12346,
    events_count = 42,
    ledger_lag = 1,
    "received events from RPC"
);
```

**Fields:**
- `start_ledger`: Starting ledger for query
- `latest_network_ledger`: Network head
- `events_count`: Number of events returned
- `ledger_lag`: Current lag

### Event Processing

```rust
warn!(
    ledger = 12345,
    contract_id = "CDUMMY...",
    "skipping event with empty id"
);
```

**Fields:**
- `ledger`: Ledger number
- `contract_id`: Contract that emitted event

## Log Filtering

### By Level

```bash
# Show only errors and warnings
RUST_LOG=backend=warn

# Show info and above
RUST_LOG=backend=info

# Show everything including debug
RUST_LOG=backend=debug

# Show trace level (very verbose)
RUST_LOG=backend=trace
```

### By Module

```bash
# Only ledger follower logs
RUST_LOG=backend::ledger_follower=debug

# Only RPC client logs
RUST_LOG=backend::soroban_rpc=debug

# Only health check logs
RUST_LOG=backend::routes::health=debug

# Multiple modules
RUST_LOG=backend::ledger_follower=debug,backend::soroban_rpc=info
```

### By Field

Using log aggregation tools (e.g., Loki, Elasticsearch):

```
# Find slow processing cycles
processing_time_ms > 5000

# Find high lag situations
ledger_lag > 100

# Find errors with specific patterns
error =~ "timeout"

# Find specific ledgers
checkpoint = 12345
```

## Log Output Formats

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

# JSON output (for production)
RUST_LOG_FORMAT=json

# Pretty output (for development)
RUST_LOG_FORMAT=pretty

# Compact output
RUST_LOG_FORMAT=compact
```

### Programmatic Configuration

In `main.rs`:

```rust
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

tracing_subscriber::registry()
    .with(
        tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "backend=debug,tower_http=debug".into()),
    )
    .with(tracing_subscriber::fmt::layer())
    .init();
```

## Health Check Endpoints

### Enhanced Sync Status

**Endpoint:** `GET /api/health/sync`

**Response:**
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

### Enhanced Health Check

**Endpoint:** `GET /api/health`

**Response:**
```json
{
  "status": "healthy",
  "db": "connected",
  "timestamp": "2026-04-28T10:30:47Z",
  "indexer_sync_status": { ... },
  "indexer_health": {
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
}
```

**Status Values:**
- `healthy`: All systems operational
- `degraded`: Some issues detected
- `lagging`: Behind network head
- `stale`: No recent updates

## Monitoring Queries

### Find Slow Cycles

```bash
# Using grep
grep "exceeded target time" logs/backend.log

# Using jq (JSON logs)
cat logs/backend.log | jq 'select(.fields.processing_time_ms > 5000)'
```

### Track Lag Over Time

```bash
# Extract lag values
cat logs/backend.log | jq -r 'select(.fields.ledger_lag) | "\(.timestamp) \(.fields.ledger_lag)"'
```

### Find Errors

```bash
# All errors
grep "ERROR" logs/backend.log

# Specific error patterns
grep "circuit breaker" logs/backend.log
grep "timeout" logs/backend.log
grep "rate limit" logs/backend.log
```

### Calculate Average Processing Time

```bash
# Using jq
cat logs/backend.log | \
  jq -s '[.[] | select(.fields.processing_time_ms) | .fields.processing_time_ms] | add/length'
```

## Integration with Log Aggregation

### Loki

```yaml
# promtail config
scrape_configs:
  - job_name: backend
    static_configs:
      - targets:
          - localhost
        labels:
          job: backend
          __path__: /var/log/backend/*.log
    pipeline_stages:
      - json:
          expressions:
            level: level
            timestamp: timestamp
            message: fields.message
            checkpoint: fields.checkpoint
            lag: fields.ledger_lag
```

**Query Examples:**
```
# High lag
{job="backend"} | json | lag > 100

# Slow processing
{job="backend"} | json | processing_time_ms > 5000

# Errors
{job="backend"} | json | level="ERROR"
```

### Elasticsearch

```json
{
  "mappings": {
    "properties": {
      "timestamp": { "type": "date" },
      "level": { "type": "keyword" },
      "target": { "type": "keyword" },
      "fields": {
        "properties": {
          "checkpoint": { "type": "long" },
          "ledger_lag": { "type": "long" },
          "processing_time_ms": { "type": "long" },
          "events_per_second": { "type": "long" }
        }
      }
    }
  }
}
```

**Query Examples:**
```json
{
  "query": {
    "bool": {
      "must": [
        { "term": { "level": "ERROR" } },
        { "range": { "timestamp": { "gte": "now-1h" } } }
      ]
    }
  }
}
```

## Alerting Rules

### Prometheus Alerts

```yaml
groups:
  - name: indexer
    rules:
      - alert: IndexerHighLag
        expr: indexer_ledger_lag > 100
        for: 5m
        annotations:
          summary: "Indexer is lagging behind network"
          
      - alert: IndexerSlowProcessing
        expr: indexer_last_loop_duration_ms > 5000
        for: 5m
        annotations:
          summary: "Indexer processing is slow"
          
      - alert: IndexerErrors
        expr: rate(indexer_total_errors[5m]) > 0.1
        annotations:
          summary: "Indexer error rate is high"
```

### Log-Based Alerts

```bash
# Alert on high lag
if grep -q "ledger_lag.*[0-9]\{3,\}" logs/backend.log; then
  echo "ALERT: High ledger lag detected"
fi

# Alert on processing time
if grep -q "exceeded target time" logs/backend.log; then
  echo "ALERT: Slow processing detected"
fi

# Alert on errors
if grep -q "ERROR" logs/backend.log; then
  echo "ALERT: Errors detected in indexer"
fi
```

## Best Practices

### 1. Use Structured Fields

**Good:**
```rust
info!(
    checkpoint = 12345,
    events = 42,
    "processed ledger"
);
```

**Bad:**
```rust
info!("processed ledger 12345 with 42 events");
```

### 2. Include Context

**Good:**
```rust
error!(
    error = %err,
    checkpoint = 12345,
    attempt = 3,
    "failed to process ledger"
);
```

**Bad:**
```rust
error!("error: {}", err);
```

### 3. Use Appropriate Levels

- **ERROR**: System cannot continue, requires intervention
- **WARN**: Unexpected but recoverable situation
- **INFO**: Important state changes
- **DEBUG**: Detailed operational info
- **TRACE**: Very detailed debugging

### 4. Instrument Key Functions

```rust
#[instrument(skip(self), fields(checkpoint = tracing::field::Empty))]
pub async fn process_ledger(&mut self, checkpoint: i64) -> Result<()> {
    Span::current().record("checkpoint", checkpoint);
    // ... function body
}
```

### 5. Create Meaningful Spans

```rust
let span = tracing::info_span!(
    "indexer_cycle",
    attempt = retry_attempt,
    checkpoint = tracing::field::Empty
);
let _enter = span.enter();
```

## Troubleshooting

### No Logs Appearing

1. Check `RUST_LOG` environment variable
2. Verify log level is appropriate
3. Check log output destination

### Too Many Logs

1. Increase log level: `RUST_LOG=backend=info`
2. Filter by module: `RUST_LOG=backend::ledger_follower=info`
3. Use log rotation

### Missing Fields

1. Ensure structured logging is used
2. Check field names match queries
3. Verify JSON parsing in aggregation tools

### Performance Impact

1. Use appropriate log levels in production
2. Avoid logging in tight loops
3. Use async logging if available
4. Consider sampling for high-volume logs

## References

- [Tracing Documentation](https://docs.rs/tracing/)
- [Tracing Subscriber](https://docs.rs/tracing-subscriber/)
- [Structured Logging Best Practices](https://www.honeycomb.io/blog/structured-logging-and-your-team)
