# Metrics Quick Reference

## Quick Start

### View All Metrics
```bash
curl http://localhost:3001/api/health/metrics
```

### Run Recovery Tests
```bash
cd backend
cargo test recovery_tests
```

## Key Metrics at a Glance

| Metric | Type | Purpose | Alert Threshold |
|--------|------|---------|-----------------|
| `indexer_ledger_lag` | Gauge | Ledgers behind network | > 100 |
| `indexer_last_loop_duration_ms` | Gauge | Processing speed | > 5000ms |
| `indexer_total_errors` | Counter | Total errors | > 10/5min |
| `indexer_rpc_errors` | Counter | RPC failures | > 5/5min |
| `indexer_total_events_processed` | Counter | Total throughput | - |
| `indexer_last_batch_rate_per_second` | Gauge | Current rate | - |

## Common Prometheus Queries

```promql
# Events per second (5min average)
rate(indexer_total_events_processed[5m])

# Error rate percentage
rate(indexer_total_errors[5m]) / rate(indexer_cycles_completed[5m]) * 100

# Recovery success rate
indexer_successful_recoveries / indexer_recovery_attempts * 100

# Average processing time
indexer_avg_loop_duration_ms
```

## Recording Metrics in Code

```rust
use crate::indexer_metrics::metrics;

// Record successful cycle
metrics().record_cycle_success(duration_ms, events_count);

// Record failure
metrics().record_cycle_failure();

// Record specific error types
metrics().record_rpc_error();
metrics().record_database_error();
metrics().record_processing_error();

// Record recovery
metrics().record_recovery_attempt();
metrics().record_successful_recovery();

// Record checkpoint update
metrics().record_checkpoint_update();
```

## Test Commands

```bash
# All recovery tests
cargo test recovery_tests

# Specific test
cargo test test_recovery_from_rpc_connection_failure

# With output
cargo test recovery_tests -- --nocapture

# With database logs
RUST_LOG=sqlx=debug cargo test recovery_tests -- --nocapture
```

## Health Check Endpoints

```bash
# Basic health
curl http://localhost:3001/api/health

# Indexer status
curl http://localhost:3001/api/health/indexer

# Prometheus metrics
curl http://localhost:3001/api/health/metrics
```

## Troubleshooting

### High Lag
1. Check `indexer_last_loop_duration_ms`
2. Check `indexer_last_rpc_latency_ms`
3. Check `indexer_rpc_errors`

### Slow Processing
1. Check `indexer_last_db_commit_latency_ms`
2. Check `indexer_last_event_processing_latency_ms`
3. Review structured logs

### Frequent Errors
1. Check `indexer_rpc_errors` vs `indexer_database_errors`
2. Check `indexer_total_rpc_retries`
3. Review error logs with context

## Documentation Links

- [Full Metrics Reference](./PROMETHEUS_METRICS.md)
- [Recovery Tests Guide](./RECOVERY_TESTS.md)
- [Implementation Summary](./METRICS_AND_TESTING_SUMMARY.md)
- [Structured Logging](./STRUCTURED_LOGGING.md)
