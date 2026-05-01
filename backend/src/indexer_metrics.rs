use std::sync::atomic::{AtomicI64, AtomicU64};
use std::sync::OnceLock;

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
