use std::sync::atomic::{AtomicI64, AtomicU64};
use std::sync::OnceLock;

#[derive(Default)]
pub struct IndexerMetrics {
    // Ledger tracking
    pub last_processed_ledger: AtomicI64,
    pub last_network_ledger: AtomicI64,
    
    // Event processing metrics
    pub total_events_processed: AtomicU64,
    pub last_batch_events_processed: AtomicU64,
    pub last_batch_rate_per_second: AtomicU64,
    pub events_processed_last_minute: AtomicU64,
    pub events_processed_last_hour: AtomicU64,
    
    // Error metrics
    pub total_errors: AtomicU64,
    pub rpc_errors: AtomicU64,
    pub database_errors: AtomicU64,
    pub processing_errors: AtomicU64,
    pub total_rpc_retries: AtomicU64,
    
    // Latency metrics (in milliseconds)
    pub last_loop_duration_ms: AtomicU64,
    pub last_rpc_latency_ms: AtomicU64,
    pub last_db_commit_latency_ms: AtomicU64,
    pub last_event_processing_latency_ms: AtomicU64,
    pub avg_loop_duration_ms: AtomicU64,
    pub max_loop_duration_ms: AtomicU64,
    
    // Processing rate metrics
    pub cycles_completed: AtomicU64,
    pub cycles_failed: AtomicU64,
    pub total_processing_time_ms: AtomicU64,
    
    // Recovery metrics
    pub recovery_attempts: AtomicU64,
    pub successful_recoveries: AtomicU64,
    pub checkpoint_updates: AtomicU64,
}

pub static INDEXER_METRICS: OnceLock<IndexerMetrics> = OnceLock::new();

pub fn metrics() -> &'static IndexerMetrics {
    INDEXER_METRICS.get_or_init(IndexerMetrics::default)
}

impl IndexerMetrics {
    /// Record a successful cycle completion
    pub fn record_cycle_success(&self, duration_ms: u64, events: u64) {
        self.cycles_completed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.total_processing_time_ms.fetch_add(duration_ms, std::sync::atomic::Ordering::Relaxed);
        self.total_events_processed.fetch_add(events, std::sync::atomic::Ordering::Relaxed);
        
        // Update average
        let total_cycles = self.cycles_completed.load(std::sync::atomic::Ordering::Relaxed);
        if total_cycles > 0 {
            let total_time = self.total_processing_time_ms.load(std::sync::atomic::Ordering::Relaxed);
            let avg = total_time / total_cycles;
            self.avg_loop_duration_ms.store(avg, std::sync::atomic::Ordering::Relaxed);
        }
        
        // Update max
        let current_max = self.max_loop_duration_ms.load(std::sync::atomic::Ordering::Relaxed);
        if duration_ms > current_max {
            self.max_loop_duration_ms.store(duration_ms, std::sync::atomic::Ordering::Relaxed);
        }
    }
    
    /// Record a failed cycle
    pub fn record_cycle_failure(&self) {
        self.cycles_failed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.total_errors.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
    
    /// Record an RPC error
    pub fn record_rpc_error(&self) {
        self.rpc_errors.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
    
    /// Record a database error
    pub fn record_database_error(&self) {
        self.database_errors.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
    
    /// Record a processing error
    pub fn record_processing_error(&self) {
        self.processing_errors.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
    
    /// Record a recovery attempt
    pub fn record_recovery_attempt(&self) {
        self.recovery_attempts.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
    
    /// Record a successful recovery
    pub fn record_successful_recovery(&self) {
        self.successful_recoveries.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
    
    /// Record a checkpoint update
    pub fn record_checkpoint_update(&self) {
        self.checkpoint_updates.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
}
