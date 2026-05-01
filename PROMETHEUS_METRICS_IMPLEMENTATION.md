# Prometheus Metrics Implementation

## Summary

Added comprehensive Prometheus metrics to the Rust backend using the `prometheus` crate (v0.13). The implementation includes counters for event processing rate and error counts, and histograms for processing latency.

## Changes Made

### 1. Dependencies Added (`backend/Cargo.toml`)
- `prometheus = { version = "0.13", features = ["process"] }`
- `lazy_static = "1.4"`

### 2. Metrics Module (`backend/src/indexer_metrics.rs`)

Added Prometheus metrics using lazy_static for thread-safe initialization:

#### Metrics Implemented:

1. **Counter: `indexer_events_processed_total`**
   - Tracks total number of blockchain events processed
   - Incremented each time an event is successfully indexed

2. **Counter: `indexer_errors_total`**
   - Tracks total number of indexer errors encountered
   - Incremented whenever the indexer cycle fails

3. **Histogram: `indexer_processing_latency_seconds`**
   - Measures time taken to process each indexer cycle
   - Buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0] seconds
   - Provides percentile calculations and latency distribution

4. **Gauge: `indexer_last_processed_ledger`**
   - Shows the last ledger successfully indexed
   - Updated after each successful cycle

5. **Gauge: `indexer_ledger_lag`**
   - Shows how many ledgers behind the network the indexer is
   - Calculated as: latest_network_ledger - last_processed_ledger

#### Registry:
- Created a dedicated `PROMETHEUS_REGISTRY` for all metrics
- Added `register_metrics()` function to register all metrics at startup

### 3. Main Application (`backend/src/main.rs`)

Added metrics registration during application startup:
```rust
indexer_metrics::register_metrics();
```

### 4. Ledger Follower (`backend/src/ledger_follower.rs`)

Integrated Prometheus metrics into the event processing loop:

- **Event Processing**: Increments `EVENT_PROCESSING_COUNTER` for each event processed
- **Error Tracking**: Increments `ERROR_COUNTER` when indexer cycle fails
- **Latency Tracking**: Records cycle duration in `PROCESSING_LATENCY_HISTOGRAM`
- **Ledger Tracking**: Updates `LAST_PROCESSED_LEDGER_GAUGE` and `LEDGER_LAG_GAUGE`

### 5. Metrics Endpoint (`backend/src/routes/health.rs`)

Updated the existing `/metrics` endpoint to use Prometheus text format:
```rust
pub async fn prometheus_metrics() -> String {
    use prometheus::Encoder;
    use crate::indexer_metrics::PROMETHEUS_REGISTRY;

    let encoder = prometheus::TextEncoder::new();
    let metric_families = PROMETHEUS_REGISTRY.gather();
    let mut buffer = Vec::new();
    encoder.encode(&metric_families, &mut buffer).unwrap();

    String::from_utf8(buffer).unwrap()
}
```

## Metrics Endpoint

The `/metrics` endpoint is already configured in the router at:
- **URL**: `http://localhost:3001/api/metrics`
- **Format**: Prometheus text format
- **Method**: GET

## Example Prometheus Output

```
# HELP indexer_events_processed_total Total number of blockchain events processed
# TYPE indexer_events_processed_total counter
indexer_events_processed_total 1234

# HELP indexer_errors_total Total number of indexer errors encountered
# TYPE indexer_errors_total counter
indexer_errors_total 5

# HELP indexer_processing_latency_seconds Time taken to process each indexer cycle
# TYPE indexer_processing_latency_seconds histogram
indexer_processing_latency_seconds_bucket{le="0.001"} 10
indexer_processing_latency_seconds_bucket{le="0.005"} 45
indexer_processing_latency_seconds_bucket{le="0.01"} 120
indexer_processing_latency_seconds_bucket{le="0.025"} 250
indexer_processing_latency_seconds_bucket{le="0.05"} 400
indexer_processing_latency_seconds_bucket{le="0.1"} 500
indexer_processing_latency_seconds_bucket{le="0.25"} 550
indexer_processing_latency_seconds_bucket{le="0.5"} 580
indexer_processing_latency_seconds_bucket{le="1.0"} 595
indexer_processing_latency_seconds_bucket{le="2.5"} 598
indexer_processing_latency_seconds_bucket{le="5.0"} 599
indexer_processing_latency_seconds_bucket{le="10.0"} 600
indexer_processing_latency_seconds_bucket{le="+Inf"} 600
indexer_processing_latency_seconds_sum 45.67
indexer_processing_latency_seconds_count 600

# HELP indexer_last_processed_ledger The last ledger successfully indexed
# TYPE indexer_last_processed_ledger gauge
indexer_last_processed_ledger 12345

# HELP indexer_ledger_lag Number of ledgers the indexer is behind the network
# TYPE indexer_ledger_lag gauge
indexer_ledger_lag 2
```

## Prometheus Configuration

To scrape these metrics, add this job to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'rust-backend'
    static_configs:
      - targets: ['localhost:3001']
    metrics_path: '/api/metrics'
    scrape_interval: 15s
```

## Key Features

1. **Thread-safe**: Uses `lazy_static` for safe concurrent access
2. **Standard Prometheus format**: Compatible with all Prometheus tooling
3. **Comprehensive coverage**: Tracks processing rate, errors, and latency
4. **Histogram buckets**: Optimized for sub-second to multi-second operations
5. **No code reformatting**: Only added necessary metrics code without changing existing structure

## Notes

- The existing atomic metrics in `IndexerMetrics` struct are preserved for backward compatibility
- The new Prometheus metrics run alongside the existing metrics system
- No changes were made to surrounding code or formatting
