# Structured Logging Quick Reference

## Log Levels

```bash
# Production (minimal)
RUST_LOG=backend=info

# Development (detailed)
RUST_LOG=backend=debug

# Troubleshooting (very detailed)
RUST_LOG=backend=trace

# Errors only
RUST_LOG=backend=error
```

## Module-Specific Logging

```bash
# Ledger follower only
RUST_LOG=backend::ledger_follower=debug

# RPC client only
RUST_LOG=backend::soroban_rpc=debug

# Health checks only
RUST_LOG=backend::routes::health=debug

# Multiple modules
RUST_LOG=backend::ledger_follower=debug,backend::soroban_rpc=info
```

## Common Log Queries

### Find Errors
```bash
grep "ERROR" logs/backend.log
grep "level.*ERROR" logs/backend.log | jq
```

### Find Slow Processing
```bash
grep "exceeded target time" logs/backend.log
cat logs/backend.log | jq 'select(.fields.processing_time_ms > 5000)'
```

### Track Lag
```bash
grep "ledger_lag" logs/backend.log
cat logs/backend.log | jq 'select(.fields.ledger_lag) | .fields.ledger_lag'
```

### Find Retries
```bash
grep "retrying" logs/backend.log
cat logs/backend.log | jq 'select(.fields.attempt > 1)'
```

### Calculate Averages
```bash
# Average processing time
cat logs/backend.log | \
  jq -s '[.[] | select(.fields.processing_time_ms) | .fields.processing_time_ms] | add/length'

# Average events per second
cat logs/backend.log | \
  jq -s '[.[] | select(.fields.events_per_second) | .fields.events_per_second] | add/length'
```

## Health Check Endpoints

### Quick Status Check
```bash
curl http://localhost:3001/api/health | jq '.status'
```

### Check Lag
```bash
curl http://localhost:3001/api/health/sync | jq '{lag: .ledger_lag, percentage: .ledger_lag_percentage}'
```

### Check if Stale
```bash
curl http://localhost:3001/api/health/sync | jq '.is_stale'
```

### Full Sync Status
```bash
curl http://localhost:3001/api/health/sync | jq
```

### Indexer Health
```bash
curl http://localhost:3001/api/health/indexer | jq
```

## Monitoring Commands

### Watch Lag in Real-Time
```bash
watch -n 5 'curl -s http://localhost:3001/api/health/sync | jq "{lag: .ledger_lag, stale: .is_stale}"'
```

### Watch Processing Rate
```bash
watch -n 5 'curl -s http://localhost:3001/api/health/sync | jq .last_batch_rate_per_second'
```

### Watch Error Count
```bash
watch -n 10 'curl -s http://localhost:3001/api/health/sync | jq .error_count'
```

### Tail Logs with Filtering
```bash
# All logs
tail -f logs/backend.log

# Errors only
tail -f logs/backend.log | grep ERROR

# Cycle completions
tail -f logs/backend.log | grep "cycle completed"

# Warnings and errors
tail -f logs/backend.log | grep -E "WARN|ERROR"
```

## Key Log Messages

### Normal Operation
```
"ledger follower worker started"
"indexer cycle completed successfully"
"fetched events from RPC"
"indexer caught up; idling"
```

### Warnings
```
"ledger processing exceeded target time"
"indexer lagging; using active poll interval"
"retrying indexer worker cycle after backoff"
"skipping event with empty id"
```

### Errors
```
"indexer worker cycle failed"
"failed to record indexer error in database"
"circuit breaker is open"
"RPC request timed out"
```

## Important Fields

### Performance
- `processing_time_ms`: Time to process events
- `total_cycle_time_ms`: Total cycle time
- `events_per_second`: Processing throughput
- `last_rpc_latency_ms`: RPC response time

### State
- `checkpoint`: Last processed ledger
- `latest_network_ledger`: Network head
- `ledger_lag`: Ledgers behind
- `caught_up`: Whether caught up
- `is_lagging`: Whether significantly behind

### Errors
- `error`: Error message
- `error_debug`: Full error details
- `attempt`: Retry attempt number
- `max_attempts`: Maximum retries

## Alert Conditions

### Critical
```bash
# Indexer stalled (no activity for 10 minutes)
curl -s http://localhost:3001/api/health/sync | jq '.seconds_since_update > 600'

# Very high lag (>1000 ledgers)
curl -s http://localhost:3001/api/health/sync | jq '.ledger_lag > 1000'

# Many errors
curl -s http://localhost:3001/api/health/sync | jq '.error_count > 100'
```

### Warning
```bash
# Stale (no activity for 5 minutes)
curl -s http://localhost:3001/api/health/sync | jq '.is_stale'

# High lag (>100 ledgers)
curl -s http://localhost:3001/api/health/sync | jq '.ledger_lag > 100'

# Slow processing
curl -s http://localhost:3001/api/health/sync | jq '.last_loop_duration_ms > 5000'
```

## Troubleshooting

### No Logs Appearing
1. Check `RUST_LOG` is set: `echo $RUST_LOG`
2. Verify log level: `RUST_LOG=backend=debug`
3. Check log file exists: `ls -la logs/`

### Too Many Logs
1. Increase log level: `RUST_LOG=backend=info`
2. Filter by module: `RUST_LOG=backend::ledger_follower=info`
3. Use log rotation

### High Lag
1. Check logs: `grep "ledger_lag" logs/backend.log | tail -20`
2. Check RPC: `curl -s http://localhost:3001/api/health/sync | jq '.rpc'`
3. Check processing time: `grep "processing_time_ms" logs/backend.log | tail -20`

### Errors
1. View recent errors: `grep "ERROR" logs/backend.log | tail -20`
2. Check error context: `cat logs/backend.log | jq 'select(.level == "ERROR")'`
3. Check retry attempts: `grep "attempt" logs/backend.log | tail -20`

## Log Rotation

### Using logrotate
```
/var/log/backend/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 backend backend
}
```

### Manual Rotation
```bash
# Rotate logs
mv logs/backend.log logs/backend.log.1
touch logs/backend.log

# Compress old logs
gzip logs/backend.log.1
```

## Integration Examples

### Prometheus Alerting
```yaml
- alert: IndexerHighLag
  expr: indexer_ledger_lag > 100
  for: 5m
  annotations:
    summary: "Indexer lag is {{ $value }} ledgers"
```

### Loki Query
```
{job="backend"} | json | ledger_lag > 100
```

### Elasticsearch Query
```json
{
  "query": {
    "bool": {
      "must": [
        {"term": {"level": "ERROR"}},
        {"range": {"timestamp": {"gte": "now-1h"}}}
      ]
    }
  }
}
```

## Quick Diagnostics

### One-Liner Health Check
```bash
curl -s http://localhost:3001/api/health | jq '{status, lag: .indexer_sync_status.ledger_lag, stale: .indexer_sync_status.is_stale, errors: .indexer_sync_status.error_count}'
```

### One-Liner Performance Check
```bash
curl -s http://localhost:3001/api/health/sync | jq '{processing_ms: .last_loop_duration_ms, events_per_sec: .last_batch_rate_per_second, rpc_latency_ms: .last_rpc_latency_ms}'
```

### One-Liner Error Summary
```bash
grep "ERROR" logs/backend.log | tail -10 | jq -r '"\(.timestamp) \(.fields.message)"'
```
