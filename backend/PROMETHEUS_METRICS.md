# Prometheus Metrics Documentation

## Overview

The ledger indexer exposes comprehensive Prometheus metrics for monitoring event processing, error tracking, latency analysis, and recovery operations. All metrics are accessible via the `/api/health/metrics` endpoint.

## Metrics Categories

### 1. Ledger Tracking Metrics

**`indexer_last_processed_ledger`** (Gauge)
- Description: The last ledger sequence number successfully processed and committed
- Use: Track indexer progress and identify processing gaps
- Example: `indexer_last_processed_ledger 12345`

**`indexer_last_network_ledger`** (Gauge)
- Description: The latest ledger sequence number reported by the Stellar network
- Use: Compare with `last_processed_ledger` to calculate lag
- Example: `indexer_last_network_ledger 12350`

**`indexer_ledger_lag`** (Gauge)
- Description: Number of ledgers the indexer is behind the network
- Calculation: `last_network_ledger - last_processed_ledger`
- Use: Monitor indexer health and detect falling behind
- Example: `indexer_ledger_lag 5`

### 2. Event Processing Metrics

**`indexer_total_events_processed`** (Counter)
- Description: Total number of events processed since indexer start
- Use: Track overall throughput and processing volume
- Example: `indexer_total_events_processed 45678`

**`indexer_last_batch_events_processed`** (Gauge)
- Description: Number of events processed in the most recent batch
- Use: Monitor batch sizes and processing patterns
- Example: `indexer_last_batch_events_processed 23`

**`indexer_last_batch_rate_per_second`** (Gauge)
- Description: Events processed per second in the last batch
- Calculation: `events_in_batch / batch_duration_seconds`
- Use: Monitor real-time processing throughput
- Example: `indexer_last_batch_rate_per_second 15.5`

**`indexer_events_processed_last_minute`** (Gauge)
- Description: Number of events processed in the last 60 seconds
- Use: Short-term throughput monitoring
- Example: `indexer_events_processed_last_minute 120`

**`indexer_events_processed_last_hour`** (Gauge)
- Description: Number of events processed in the last hour
- Use: Medium-term throughput analysis
- Example: `indexer_events_processed_last_hour 5400`

### 3. Error Metrics

**`indexer_total_errors`** (Counter)
- Description: Total number of errors encountered (all types)
- Use: Overall error rate monitoring
- Example: `indexer_total_errors 12`

**`indexer_rpc_errors`** (Counter)
- Description: Number of RPC-related errors (connection, timeout, rate limit)
- Use: Monitor RPC provider reliability
- Example: `indexer_rpc_errors 5`

**`indexer_database_errors`** (Counter)
- Description: Number of database-related errors (connection, query, commit)
- Use: Monitor database health and connectivity
- Example: `indexer_database_errors 2`

**`indexer_processing_errors`** (Counter)
- Description: Number of event processing errors (parsing, validation)
- Use: Monitor data quality and processing logic issues
- Example: `indexer_processing_errors 1`

**`indexer_total_rpc_retries`** (Counter)
- Description: Total number of RPC request retries attempted
- Use: Monitor RPC stability and retry frequency
- Example: `indexer_total_rpc_retries 15`

### 4. Latency Metrics (milliseconds)

**`indexer_last_loop_duration_ms`** (Gauge)
- Description: Duration of the most recent indexer cycle
- Use: Monitor real-time processing speed
- Target: < 5000ms for 5-second processing goal
- Example: `indexer_last_loop_duration_ms 3500`

**`indexer_last_rpc_latency_ms`** (Gauge)
- Description: Latency of the most recent RPC request
- Use: Monitor RPC provider response times
- Example: `indexer_last_rpc_latency_ms 250`

**`indexer_last_db_commit_latency_ms`** (Gauge)
- Description: Duration of the most recent database commit
- Use: Monitor database performance
- Example: `indexer_last_db_commit_latency_ms 150`

**`indexer_last_event_processing_latency_ms`** (Gauge)
- Description: Duration of the most recent event processing batch
- Use: Monitor event processing efficiency
- Example: `indexer_last_event_processing_latency_ms 100`

**`indexer_avg_loop_duration_ms`** (Gauge)
- Description: Average duration of all indexer cycles
- Calculation: `total_processing_time / cycles_completed`
- Use: Track long-term performance trends
- Example: `indexer_avg_loop_duration_ms 2800`

**`indexer_max_loop_duration_ms`** (Gauge)
- Description: Maximum duration observed for any indexer cycle
- Use: Identify performance outliers and bottlenecks
- Example: `indexer_max_loop_duration_ms 8500`

### 5. Cycle Metrics

**`indexer_cycles_completed`** (Counter)
- Description: Total number of successfully completed indexer cycles
- Use: Track overall indexer activity
- Example: `indexer_cycles_completed 1234`

**`indexer_cycles_failed`** (Counter)
- Description: Total number of failed indexer cycles
- Use: Monitor failure rate
- Example: `indexer_cycles_failed 5`

**`indexer_total_processing_time_ms`** (Counter)
- Description: Cumulative processing time across all cycles
- Use: Calculate average cycle duration
- Example: `indexer_total_processing_time_ms 3456789`

### 6. Recovery Metrics

**`indexer_recovery_attempts`** (Counter)
- Description: Number of recovery attempts after failures
- Use: Monitor recovery frequency
- Example: `indexer_recovery_attempts 8`

**`indexer_successful_recoveries`** (Counter)
- Description: Number of successful recoveries from failures
- Use: Track recovery success rate
- Example: `indexer_successful_recoveries 7`

**`indexer_checkpoint_updates`** (Counter)
- Description: Number of checkpoint updates to the database
- Use: Track checkpoint persistence frequency
- Example: `indexer_checkpoint_updates 1234`

## Accessing Metrics

### Prometheus Endpoint

```bash
curl http://localhost:3001/api/health/metrics
```

### Example Response

```
# HELP indexer_last_processed_ledger Last ledger sequence processed
# TYPE indexer_last_processed_ledger gauge
indexer_last_processed_ledger 12345

# HELP indexer_last_network_ledger Latest network ledger sequence
# TYPE indexer_last_network_ledger gauge
indexer_last_network_ledger 12350

# HELP indexer_ledger_lag Ledgers behind network
# TYPE indexer_ledger_lag gauge
indexer_ledger_lag 5

# HELP indexer_total_events_processed Total events processed
# TYPE indexer_total_events_processed counter
indexer_total_events_processed 45678

# HELP indexer_rpc_errors Total RPC errors
# TYPE indexer_rpc_errors counter
indexer_rpc_errors 5

# HELP indexer_last_loop_duration_ms Last cycle duration in milliseconds
# TYPE indexer_last_loop_duration_ms gauge
indexer_last_loop_duration_ms 3500
```

## Monitoring Recommendations

### Critical Alerts

1. **High Lag Alert**
   - Metric: `indexer_ledger_lag`
   - Threshold: > 100 ledgers
   - Action: Investigate RPC performance or processing bottlenecks

2. **Processing Time Alert**
   - Metric: `indexer_last_loop_duration_ms`
   - Threshold: > 5000ms (exceeds 5-second target)
   - Action: Check RPC latency and database performance

3. **Error Rate Alert**
   - Metric: `rate(indexer_total_errors[5m])`
   - Threshold: > 10 errors per 5 minutes
   - Action: Check logs for error details

4. **RPC Error Alert**
   - Metric: `rate(indexer_rpc_errors[5m])`
   - Threshold: > 5 errors per 5 minutes
   - Action: Check RPC provider status

### Performance Monitoring

1. **Throughput Dashboard**
   - `indexer_events_processed_last_minute`
   - `indexer_last_batch_rate_per_second`
   - `indexer_total_events_processed`

2. **Latency Dashboard**
   - `indexer_last_loop_duration_ms`
   - `indexer_last_rpc_latency_ms`
   - `indexer_last_db_commit_latency_ms`
   - `indexer_avg_loop_duration_ms`

3. **Reliability Dashboard**
   - `indexer_cycles_completed`
   - `indexer_cycles_failed`
   - `indexer_recovery_attempts`
   - `indexer_successful_recoveries`

### Example Prometheus Queries

**Average processing rate over 5 minutes:**
```promql
rate(indexer_total_events_processed[5m])
```

**Error rate percentage:**
```promql
rate(indexer_total_errors[5m]) / rate(indexer_cycles_completed[5m]) * 100
```

**95th percentile loop duration (requires histogram):**
```promql
histogram_quantile(0.95, rate(indexer_loop_duration_ms_bucket[5m]))
```

**Recovery success rate:**
```promql
indexer_successful_recoveries / indexer_recovery_attempts * 100
```

## Integration with Prometheus

### Prometheus Configuration

Add to `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'ledger_indexer'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3001']
    metrics_path: '/api/health/metrics'
```

### Grafana Dashboard

Import the provided Grafana dashboard JSON or create custom panels using the metrics above.

## Troubleshooting

### High Latency

1. Check `indexer_last_rpc_latency_ms` - if high, RPC provider may be slow
2. Check `indexer_last_db_commit_latency_ms` - if high, database may be overloaded
3. Check `indexer_last_event_processing_latency_ms` - if high, processing logic may need optimization

### Increasing Lag

1. Compare `indexer_last_loop_duration_ms` with ledger close time (5 seconds)
2. If loop duration > 5s, indexer cannot keep up with network
3. Check error metrics to identify bottlenecks

### Frequent Errors

1. Check `indexer_rpc_errors` vs `indexer_database_errors` to identify source
2. Review structured logs for detailed error messages
3. Monitor `indexer_total_rpc_retries` to assess retry effectiveness

## Related Documentation

- [Structured Logging](./STRUCTURED_LOGGING.md)
- [RPC Client](./RPC_CLIENT.md)
- [Ledger Indexer](./LEDGER_INDEXER.md)
- [Recovery Tests](./RECOVERY_TESTS.md)
