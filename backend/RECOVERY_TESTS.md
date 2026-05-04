# Recovery Tests Documentation

## Overview

The recovery test suite (`backend/src/recovery_tests.rs`) validates the ledger indexer's ability to recover from various failure scenarios and resume processing from the last known checkpoint. These tests ensure data integrity, idempotent processing, and reliable recovery mechanisms.

## Test Suite

### 1. Recovery from RPC Connection Failure

**Test:** `test_recovery_from_rpc_connection_failure`

**Scenario:**
- Indexer checkpoint is at ledger 100
- First 2 RPC requests fail with HTTP 503 (Service Unavailable)
- Third request succeeds with events for ledger 101

**Validates:**
- Indexer retries failed RPC requests
- Checkpoint remains unchanged during failures
- Processing resumes successfully after recovery
- Checkpoint updates to 101 after successful processing
- Events are correctly indexed
- Recovery metrics are recorded

**Expected Behavior:**
```
Initial state: checkpoint = 100
Attempt 1: RPC fails (503) → checkpoint = 100 (unchanged)
Attempt 2: RPC succeeds → processes ledger 101 → checkpoint = 101
Final state: 1 event indexed, checkpoint = 101
```

### 2. Resume from Last Checkpoint After Restart

**Test:** `test_resume_from_last_checkpoint_after_restart`

**Scenario:**
- Previous run processed ledgers 45-50
- Indexer restarts and loads checkpoint (50)
- New run should start from ledger 51

**Validates:**
- Checkpoint persistence across restarts
- Indexer resumes from correct ledger
- No reprocessing of old ledgers
- New events are appended to existing data

**Expected Behavior:**
```
Previous run: processed ledgers 45-50 (6 events)
Restart: loads checkpoint = 50
New run: processes ledger 51 → checkpoint = 51
Final state: 7 total events (6 old + 1 new)
```

### 3. Idempotent Reprocessing After Failure

**Test:** `test_idempotent_reprocessing_after_failure`

**Scenario:**
- Process ledger 61 successfully (1 event inserted)
- Simulate failure by resetting checkpoint to 60
- Reprocess ledger 61 with same events

**Validates:**
- Duplicate events are not inserted (ON CONFLICT DO NOTHING)
- Idempotent processing prevents data corruption
- Event count remains correct after reprocessing
- Checkpoint updates correctly on second attempt

**Expected Behavior:**
```
First processing: ledger 61 → 1 event inserted
Reset checkpoint: checkpoint = 60
Second processing: ledger 61 → 0 events inserted (duplicate)
Final state: 1 event total (no duplicates)
```

### 4. Multiple Consecutive Failures Then Recovery

**Test:** `test_multiple_consecutive_failures_then_recovery`

**Scenario:**
- Checkpoint at ledger 70
- First 5 RPC requests fail with HTTP 500
- Sixth request succeeds

**Validates:**
- Indexer persists through multiple failures
- Checkpoint remains stable during failures
- Eventually recovers and processes successfully
- Error metrics track all failures
- Recovery metrics track successful recovery

**Expected Behavior:**
```
Initial: checkpoint = 70
Attempts 1-2: fail → checkpoint = 70
Attempt 3: succeeds → processes ledger 71 → checkpoint = 71
Metrics: total_errors >= 2, recovery recorded
```

### 5. Checkpoint Preserved on Database Error

**Test:** `test_checkpoint_preserved_on_database_error`

**Scenario:**
- Checkpoint at ledger 80
- RPC returns events for ledger 81
- Database connection is closed (simulating failure)
- Processing fails

**Validates:**
- Database errors are handled gracefully
- Checkpoint is not updated on database failure
- Transaction rollback prevents partial updates
- Indexer can retry after database recovery

**Expected Behavior:**
```
Initial: checkpoint = 80
RPC succeeds: fetches events for ledger 81
Database fails: cannot commit
Result: checkpoint = 80 (unchanged), no events inserted
```

### 6. Metrics Tracking During Recovery

**Test:** `test_metrics_tracking_during_recovery`

**Scenario:**
- First RPC request fails
- Second request succeeds
- Verify all metrics are correctly updated

**Validates:**
- Error metrics increment on failure
- Success metrics increment on recovery
- Cycle metrics track both failures and successes
- Checkpoint update metrics are recorded

**Expected Metrics:**
```
After failure:
  - total_errors: increased
  - cycles_failed: increased

After recovery:
  - cycles_completed: increased
  - checkpoint_updates: increased
  - successful_recoveries: increased
```

## Running the Tests

### Run All Recovery Tests

```bash
cd backend
cargo test recovery_tests
```

### Run Specific Test

```bash
cargo test test_recovery_from_rpc_connection_failure
```

### Run with Output

```bash
cargo test recovery_tests -- --nocapture
```

### Run with Database Logging

```bash
RUST_LOG=sqlx=debug cargo test recovery_tests -- --nocapture
```

## Test Infrastructure

### Mock RPC Server

Tests use `wiremock` to create mock RPC servers that simulate various failure scenarios:

```rust
Mock::given(method("POST"))
    .and(path("/"))
    .respond_with(ResponseTemplate::new(503))
    .mount(&mock_server)
    .await;
```

### Test Database

Tests use `sqlx::test` macro for automatic database setup:
- Creates isolated test database
- Runs migrations automatically
- Cleans up after test completion

### Test Configuration

Tests use minimal timeouts and intervals for fast execution:

```rust
fn test_rpc_config(rpc_url: String) -> RpcClientConfig {
    RpcClientConfig {
        rate_limit_interval: Duration::ZERO,
        retry_policy: RetryPolicy {
            max_attempts: 3,
            initial_backoff: Duration::from_millis(10),
            max_backoff: Duration::from_millis(50),
            jitter_enabled: false,
        },
        request_timeout: Duration::from_secs(5),
        circuit_breaker: CircuitBreakerConfig {
            failure_threshold: 10,
            timeout: Duration::from_secs(60),
            enabled: false,
        },
    }
}
```

## Test Dependencies

Required crates in `Cargo.toml`:

```toml
[dev-dependencies]
wiremock = "0.6"
sqlx = { version = "0.8", features = ["runtime-tokio-rustls", "postgres", "macros"] }
tokio = { version = "1", features = ["full"] }
```

## Continuous Integration

### GitHub Actions Example

```yaml
name: Recovery Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
      - name: Run recovery tests
        run: cargo test recovery_tests
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost/test
```

## Troubleshooting

### Test Failures

**Database Connection Issues:**
```bash
# Ensure PostgreSQL is running
docker-compose up -d postgres

# Check DATABASE_URL environment variable
echo $DATABASE_URL
```

**Timeout Issues:**
```rust
// Increase timeouts in test configuration if needed
request_timeout: Duration::from_secs(30),
```

**Mock Server Issues:**
```rust
// Verify mock server is properly mounted
mock_server.verify().await;
```

### Common Issues

1. **Port Conflicts:** Mock servers may conflict with running services
2. **Database State:** Ensure clean database state between tests
3. **Timing Issues:** Adjust retry intervals if tests are flaky

## Best Practices

### Writing New Recovery Tests

1. **Isolate Failures:** Test one failure type per test
2. **Verify State:** Check both database and metrics state
3. **Use Realistic Scenarios:** Model real-world failure patterns
4. **Clean Up:** Ensure tests don't leave side effects

### Example Test Structure

```rust
#[sqlx::test(migrations = "./migrations")]
async fn test_new_recovery_scenario(pool: PgPool) {
    // 1. Setup initial state
    sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1")
        .bind(100_i64)
        .execute(&pool)
        .await
        .unwrap();
    
    // 2. Configure mock RPC
    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(/* failure scenario */)
        .mount(&mock_server)
        .await;
    
    // 3. Create indexer and execute
    let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
    let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());
    
    // 4. Verify failure
    let result = follower.next_cycle().await;
    assert!(result.is_err());
    
    // 5. Verify state unchanged
    let checkpoint: i64 = sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(checkpoint, 100);
    
    // 6. Verify metrics
    let errors = metrics().total_errors.load(Ordering::Relaxed);
    assert!(errors > 0);
}
```

## Related Documentation

- [Prometheus Metrics](./PROMETHEUS_METRICS.md)
- [Structured Logging](./STRUCTURED_LOGGING.md)
- [RPC Client](./RPC_CLIENT.md)
- [Ledger Indexer](./LEDGER_INDEXER.md)

## Future Enhancements

### Planned Test Scenarios

1. **Circuit Breaker Tests:** Validate circuit breaker state transitions
2. **Rate Limiting Tests:** Verify rate limit handling
3. **Concurrent Processing Tests:** Test parallel indexer instances
4. **Long-Running Failure Tests:** Simulate extended outages
5. **Network Partition Tests:** Test split-brain scenarios
6. **Data Corruption Tests:** Validate data integrity checks

### Performance Tests

1. **Load Tests:** Process high-volume event streams
2. **Stress Tests:** Push indexer to resource limits
3. **Endurance Tests:** Run for extended periods
4. **Spike Tests:** Handle sudden traffic increases

## Metrics Validation

Each test validates relevant metrics:

```rust
// Verify error tracking
let total_errors = metrics().total_errors.load(Ordering::Relaxed);
let rpc_errors = metrics().rpc_errors.load(Ordering::Relaxed);
assert!(total_errors > 0);
assert!(rpc_errors > 0);

// Verify recovery tracking
let recovery_attempts = metrics().recovery_attempts.load(Ordering::Relaxed);
let successful_recoveries = metrics().successful_recoveries.load(Ordering::Relaxed);
assert!(recovery_attempts > 0);
assert!(successful_recoveries > 0);

// Verify checkpoint tracking
let checkpoint_updates = metrics().checkpoint_updates.load(Ordering::Relaxed);
assert!(checkpoint_updates > 0);
```

## Conclusion

The recovery test suite provides comprehensive validation of the indexer's resilience and reliability. Regular execution of these tests ensures the indexer can handle real-world failure scenarios and maintain data integrity under adverse conditions.
