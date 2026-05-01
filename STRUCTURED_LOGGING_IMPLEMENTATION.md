# Structured Logging Implementation

## Summary

Enhanced structured logging using the `tracing` crate has been implemented across the worker, RPC client, and indexing logic. All critical operations now include detailed logging with structured fields for production diagnostics.

## Logging Enhancements

### 1. Worker Internal State Logging

**Location**: `backend/src/ledger_follower.rs` - `LedgerFollower::run()`

#### Worker Startup
```rust
info!("indexer worker started; entering main processing loop");
```

#### Cycle Start
```rust
trace!(
    worker_retry_attempt,
    "starting indexer cycle"
);
```

#### Successful Cycle Completion
```rust
info!(
    checkpoint = cycle.checkpoint,
    latest_network_ledger = cycle.latest_network_ledger,
    ledger_lag = lag,
    inserted_events = cycle.inserted_events,
    elapsed_ms,
    rate_per_second,
    "indexer cycle completed successfully"
);
```

**Fields logged**:
- `checkpoint`: Current checkpoint ledger
- `latest_network_ledger`: Latest network ledger height
- `ledger_lag`: How many ledgers behind
- `inserted_events`: Number of events processed
- `elapsed_ms`: Cycle duration in milliseconds
- `rate_per_second`: Processing throughput

#### Worker Retry on Failure
```rust
error!(
    attempt = worker_retry_attempt,
    max_attempts = self.config.worker_retry_policy.max_attempts,
    backoff_ms = backoff.as_millis() as u64,
    error = %err,
    error_debug = ?err,
    "indexer worker cycle failed",
);
```

**Fields logged**:
- `attempt`: Current retry attempt number
- `max_attempts`: Maximum retry attempts configured
- `backoff_ms`: Backoff delay before next retry
- `error`: Error message (display format)
- `error_debug`: Full error chain (debug format)

### 2. Checkpoint Operations Logging

**Location**: `backend/src/ledger_follower.rs` - `LedgerFollower::next_cycle()`

#### Reading Checkpoint
```rust
debug!("reading checkpoint from database");

debug!(
    last_processed_ledger,
    "checkpoint read from database"
);
```

#### Initializing Checkpoint (First Run)
```rust
info!("no checkpoint found; initializing from latest network ledger");

debug!(
    latest_network_ledger,
    "writing initial checkpoint to database"
);

info!(
    checkpoint = latest_network_ledger,
    "indexer initialized checkpoint from latest network ledger",
);
```

#### Updating Checkpoint
```rust
debug!(
    next_checkpoint,
    previous_checkpoint = last_processed_ledger,
    "updating checkpoint in database"
);
```

### 3. RPC Client Logging

**Location**: `backend/src/soroban_rpc.rs`

#### Fetching Latest Ledger
```rust
debug!("fetching latest ledger from RPC");

debug!(
    sequence,
    "received latest ledger from RPC"
);
```

#### Fetching Events
```rust
debug!(
    start_ledger,
    "fetching events from RPC"
);

debug!(
    start_ledger,
    latest_network_ledger,
    event_count = events.len(),
    "received events from RPC"
);
```

#### RPC Request Lifecycle
```rust
// Preparing request
trace!(
    method,
    params = ?params,
    "preparing RPC request"
);

// Sending request
trace!(
    method,
    attempt,
    url = %self.config.url,
    "sending RPC request"
);

// Received response
trace!(
    method,
    attempt,
    status = %status,
    latency_ms,
    body_len = body.len(),
    "received RPC response"
);

// Request failed
debug!(
    method,
    attempt,
    latency_ms,
    error = %err,
    "RPC request failed"
);

// Request successful
debug!(
    method,
    attempt,
    latency_ms,
    "RPC request successful"
);
```

#### Rate Limiting
```rust
trace!(
    sleep_ms = sleep_duration.as_millis() as u64,
    rate_limit_ms = self.config.rate_limit_interval.as_millis() as u64,
    "enforcing rate limit"
);
```

#### Retry Attempts
```rust
warn!(
    method,
    attempt = attempt + 1,
    max_attempts = self.config.retry_policy.max_attempts,
    backoff_ms = delay.as_millis() as u64,
    error = message,
    "retrying RPC request",
);
```

**Fields logged**:
- `method`: RPC method name (getLatestLedger, getEvents)
- `attempt`: Current attempt number
- `max_attempts`: Maximum retry attempts
- `backoff_ms`: Exponential backoff delay
- `latency_ms`: Request latency
- `error`: Error message

### 4. Event Processing Logging

**Location**: `backend/src/ledger_follower.rs` - `next_cycle()`

#### Fetching Events
```rust
debug!(
    start_ledger,
    last_processed_ledger,
    "fetching events from RPC"
);

debug!(
    start_ledger,
    latest_network_ledger = events_response.latest_network_ledger,
    event_count = events_response.events.len(),
    "received events from RPC"
);
```

#### Network Behind Start Ledger
```rust
debug!(
    latest_network_ledger = events_response.latest_network_ledger,
    start_ledger,
    "network ledger behind start ledger; no events to process"
);
```

#### Transaction Lifecycle
```rust
debug!(
    event_count = events_response.events.len(),
    "beginning database transaction"
);

debug!(
    inserted_events,
    next_checkpoint,
    "committing transaction"
);
```

#### Individual Event Processing
```rust
trace!(
    event_id,
    ledger,
    contract_id,
    topic_hash,
    "processing event"
);

trace!(
    event_id,
    ledger,
    "processing side effects for event"
);
```

#### Skipping Events
```rust
// Empty event ID
warn!(ledger, "skipping event with empty id");

// Already indexed
debug!(event_id, ledger, "skipping already-indexed event");
```

### 5. Side Effect Processing Logging

**Location**: `backend/src/ledger_follower.rs` - `process_event_side_effects()`

#### Event Type Processing
```rust
trace!(
    event_type = first_topic,
    "processing event side effects"
);
```

#### Job Creation Events
```rust
info!(job_id, event_type = first_topic, "indexed job creation event");
```

#### Bid Events
```rust
info!(event_type = "bid", "indexed bid submission event");
info!(event_type = "accept", "indexed bid acceptance event");
```

#### Deposit Events
```rust
debug!(
    event_id,
    ledger,
    contract_id,
    sender,
    token,
    amount,
    "inserting deposit record"
);

info!(
    event_id,
    ledger, contract_id, sender, token, amount, "indexed deposit event"
);
```

#### Dispute Events
```rust
debug!(
    event_id,
    ledger,
    contract_id,
    job_id,
    opened_by,
    "inserting dispute record"
);

info!(
    event_id,
    ledger, contract_id, job_id, opened_by, "indexed DisputeOpened event"
);
```

#### Unknown Event Types
```rust
trace!(
    event_type = first_topic,
    "no side effects for event type"
);
```

#### Database Errors
```rust
// Deposit insert failure
.with_context(|| format!("failed to insert deposit record for event {event_id}"))?;

// Dispute insert failure
.with_context(|| format!("failed to insert dispute record for event {event_id}"))?;
```

## Log Levels

### TRACE
- RPC request/response details
- Individual event processing
- Rate limiting enforcement
- Side effect processing for unknown event types

**Use case**: Deep debugging, performance analysis

### DEBUG
- Checkpoint read/write operations
- RPC method calls and responses
- Transaction begin/commit
- Database operations
- Event batch details

**Use case**: Development, troubleshooting specific issues

### INFO
- Worker startup
- Cycle completion with metrics
- Checkpoint initialization
- Event indexing (deposits, disputes, jobs, bids)

**Use case**: Normal operation monitoring, audit trail

### WARN
- RPC retry attempts
- Skipping events with empty IDs

**Use case**: Potential issues that don't stop processing

### ERROR
- Worker cycle failures with full error context
- Retry attempts with backoff details

**Use case**: Failures requiring investigation

## Structured Fields

All logs use structured fields for easy parsing and filtering:

### Common Fields
- `checkpoint`: Current ledger checkpoint
- `ledger`: Ledger number
- `event_id`: Unique event identifier
- `contract_id`: Smart contract address
- `attempt`: Retry attempt number
- `error`: Error message

### Performance Fields
- `elapsed_ms`: Operation duration
- `latency_ms`: RPC request latency
- `rate_per_second`: Processing throughput
- `backoff_ms`: Retry backoff delay

### State Fields
- `last_processed_ledger`: Last successfully processed ledger
- `latest_network_ledger`: Current network height
- `ledger_lag`: Ledgers behind network
- `inserted_events`: Events processed in cycle
- `event_count`: Total events in batch

### RPC Fields
- `method`: RPC method name
- `url`: RPC endpoint URL
- `status`: HTTP status code
- `body_len`: Response body length

## Configuration

Logging verbosity is controlled via the `RUST_LOG` environment variable:

```bash
# Production (INFO and above)
RUST_LOG=backend=info

# Development (DEBUG and above)
RUST_LOG=backend=debug

# Deep debugging (TRACE and above)
RUST_LOG=backend=trace

# Module-specific logging
RUST_LOG=backend::ledger_follower=debug,backend::soroban_rpc=trace
```

## Production Diagnostics

### Diagnosing Slow Processing
Look for:
```
checkpoint=X latest_network_ledger=Y ledger_lag=Z elapsed_ms=W
```
- High `ledger_lag`: Worker falling behind
- High `elapsed_ms`: Slow cycle processing
- Low `rate_per_second`: Throughput issues

### Diagnosing RPC Issues
Look for:
```
method=getEvents attempt=N backoff_ms=X error="..."
```
- Multiple retry attempts: RPC instability
- High `latency_ms`: Network or provider issues
- Specific error patterns: Rate limiting, timeouts

### Diagnosing Database Issues
Look for:
```
error="..." error_debug="..."
```
- Transaction failures
- Connection pool exhaustion
- Query timeouts

### Diagnosing Checkpoint Issues
Look for:
```
checkpoint=X previous_checkpoint=Y
```
- Checkpoint not advancing: Processing stuck
- Large checkpoint jumps: Missed ledgers (shouldn't happen)

## Example Log Output

### Normal Operation
```
INFO indexer worker started; entering main processing loop
DEBUG reading checkpoint from database
DEBUG checkpoint read from database last_processed_ledger=12345
DEBUG fetching events from RPC start_ledger=12346
DEBUG received events from RPC event_count=5 latest_network_ledger=12350
DEBUG beginning database transaction event_count=5
TRACE processing event event_id="evt-1" ledger=12346
INFO indexed deposit event event_id="evt-1" ledger=12346 sender="GABC..." amount=1000
DEBUG committing transaction inserted_events=5 next_checkpoint=12350
INFO indexer cycle completed successfully checkpoint=12350 ledger_lag=0 elapsed_ms=120 rate_per_second=41
```

### RPC Retry Scenario
```
DEBUG sending RPC request method="getEvents" attempt=0
DEBUG RPC request failed method="getEvents" latency_ms=5000 error="connection timeout"
WARN retrying RPC request method="getEvents" attempt=1 backoff_ms=500
DEBUG sending RPC request method="getEvents" attempt=1
DEBUG RPC request successful method="getEvents" latency_ms=250
```

### Worker Failure and Recovery
```
ERROR indexer worker cycle failed attempt=1 max_attempts=4 backoff_ms=1000 error="database connection lost"
ERROR indexer worker cycle failed attempt=2 max_attempts=4 backoff_ms=2000 error="database connection lost"
INFO indexer cycle completed successfully checkpoint=12351 ledger_lag=5 elapsed_ms=150
```

## Benefits

1. **Production Debugging**: Structured fields enable precise filtering and correlation
2. **Performance Analysis**: Timing metrics in every log
3. **Error Context**: Full error chains with `error_debug`
4. **Audit Trail**: Complete record of checkpoint updates and event processing
5. **Alerting**: Easy to build alerts on specific patterns (high lag, retry counts)
6. **Observability**: Integrates with log aggregation tools (ELK, Datadog, etc.)

## Conclusion

All requested logging enhancements have been implemented:

✅ Worker internal state logging  
✅ Checkpoint update logging  
✅ Retry attempt logging with full context  
✅ Processing error logging with error chains  
✅ RPC client request/response logging  
✅ Event processing lifecycle logging  
✅ Database transaction logging  
✅ Structured fields for production diagnostics  

The logging provides complete visibility into the indexer's operation with enough detail to diagnose any production failure.
