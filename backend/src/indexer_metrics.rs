use std::sync::atomic::{AtomicI64, AtomicU64};
use std::sync::OnceLock;

use lazy_static::lazy_static;
use prometheus::{Counter, Histogram, IntGauge, Registry};

#[derive(Default)]
pub struct IndexerMetrics {
    pub last_processed_ledger: AtomicI64,
    pub last_network_ledger: AtomicI64,
    pub total_events_processed: AtomicU64,
    pub total_errors: AtomicU64,
    pub total_rpc_retries: AtomicU64,
    pub last_loop_duration_ms: AtomicU64,
    pub last_rpc_latency_ms: AtomicU64,
    pub last_batch_events_processed: AtomicU64,
    pub last_batch_rate_per_second: AtomicU64,
}

pub static INDEXER_METRICS: OnceLock<IndexerMetrics> = OnceLock::new();

pub fn metrics() -> &'static IndexerMetrics {
    INDEXER_METRICS.get_or_init(IndexerMetrics::default)
}

lazy_static! {
    pub static ref PROMETHEUS_REGISTRY: Registry = Registry::new();
    pub static ref EVENT_PROCESSING_COUNTER: Counter = Counter::new(
        "indexer_events_processed_total",
        "Total number of blockchain events processed"
    )
    .expect("metric can be created");
    pub static ref ERROR_COUNTER: Counter = Counter::new(
        "indexer_errors_total",
        "Total number of indexer errors encountered"
    )
    .expect("metric can be created");
    pub static ref PROCESSING_LATENCY_HISTOGRAM: Histogram = Histogram::with_opts(
        prometheus::HistogramOpts::new(
            "indexer_processing_latency_seconds",
            "Time taken to process each indexer cycle"
        )
        .buckets(vec![
            0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0
        ])
    )
    .expect("metric can be created");
    pub static ref LAST_PROCESSED_LEDGER_GAUGE: IntGauge = IntGauge::new(
        "indexer_last_processed_ledger",
        "The last ledger successfully indexed"
    )
    .expect("metric can be created");
    pub static ref LEDGER_LAG_GAUGE: IntGauge = IntGauge::new(
        "indexer_ledger_lag",
        "Number of ledgers the indexer is behind the network"
    )
    .expect("metric can be created");
}

pub fn register_metrics() {
    PROMETHEUS_REGISTRY
        .register(Box::new(EVENT_PROCESSING_COUNTER.clone()))
        .expect("event processing counter can be registered");
    PROMETHEUS_REGISTRY
        .register(Box::new(ERROR_COUNTER.clone()))
        .expect("error counter can be registered");
    PROMETHEUS_REGISTRY
        .register(Box::new(PROCESSING_LATENCY_HISTOGRAM.clone()))
        .expect("processing latency histogram can be registered");
    PROMETHEUS_REGISTRY
        .register(Box::new(LAST_PROCESSED_LEDGER_GAUGE.clone()))
        .expect("last processed ledger gauge can be registered");
    PROMETHEUS_REGISTRY
        .register(Box::new(LEDGER_LAG_GAUGE.clone()))
        .expect("ledger lag gauge can be registered");
}
