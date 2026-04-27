use prometheus::{Counter, Gauge, Histogram, Registry};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::services::rpc::{GetLedgerResponse, MultiProviderRpc, RpcClient, TransactionMeta};

pub mod metrics {
    use prometheus::{Counter, Gauge, Histogram, Registry};
    use std::sync::Arc;

    pub struct IndexerMetrics {
        pub ledgers_processed: Counter,
        pub ledgers_failed: Counter,
        pub transactions_processed: Counter,
        pub events_processed: Counter,
        pub last_ledger_height: Gauge,
        pub indexer_lag_seconds: Gauge,
        pub processing_duration_seconds: Histogram,
        pub rpc_errors_total: Counter,
        pub db_write_duration_seconds: Histogram,
    }

    impl IndexerMetrics {
        pub fn new(registry: &Registry) -> Self {
            Self {
                ledgers_processed: registry
                    .counter("indexer_ledgers_processed_total", "Total ledgers processed")
                    .unwrap(),
                ledgers_failed: registry
                    .counter("indexer_ledgers_failed_total", "Total ledgers failed")
                    .unwrap(),
                transactions_processed: registry
                    .counter("indexer_transactions_processed_total", "Total transactions processed")
                    .unwrap(),
                events_processed: registry
                    .counter("indexer_events_processed_total", "Total events processed")
                    .unwrap(),
                last_ledger_height: registry
                    .gauge("indexer_last_ledger_height", "Last processed ledger height")
                    .unwrap(),
                indexer_lag_seconds: registry
                    .gauge("indexer_lag_seconds", "Seconds behind network")
                    .unwrap(),
                processing_duration_seconds: registry
                    .histogram(
                        "indexer_processing_duration_seconds",
                        "Time to process a ledger",
                        vec![0.1, 0.5, 1.0, 2.0, 5.0, 10.0],
                    )
                    .unwrap(),
                rpc_errors_total: registry
                    .counter("indexer_rpc_errors_total", "Total RPC errors")
                    .unwrap(),
                db_write_duration_seconds: registry
                    .histogram(
                        "indexer_db_write_duration_seconds",
                        "Time to write to database",
                        vec![0.01, 0.05, 0.1, 0.25, 0.5, 1.0],
                    )
                    .unwrap(),
            }
        }
    }
}

use metrics::IndexerMetrics;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexerState {
    pub last_ledger: u32,
    pub last_ledger_hash: String,
    pub status: String,
    pub error_message: Option<String>,
}

pub struct IndexerWorker {
    pool: PgPool,
    rpc: Arc<MultiProviderRpc>,
    metrics: Arc<IndexerMetrics>,
    state: Arc<RwLock<IndexerState>>,
    poll_interval: Duration,
    max_batch_size: u32,
}

impl IndexerWorker {
    pub fn new(
        pool: PgPool,
        rpc: MultiProviderRpc,
        metrics: IndexerMetrics,
    ) -> Self {
        Self {
            pool: pool.clone(),
            rpc: Arc::new(rpc),
            metrics: Arc::new(metrics),
            state: Arc::new(RwLock::new(IndexerState {
                last_ledger: 0,
                last_ledger_hash: String::new(),
                status: "idle".to_string(),
                error_message: None,
            })),
            poll_interval: Duration::from_secs(5),
            max_batch_size: 10,
        }
    }

    pub async fn run(&self) {
        tracing::info!("Starting indexer worker");
        
        self.load_checkpoint().await;
        
        loop {
            if let Err(e) = self.sync_once().await {
                tracing::error!("Indexer sync error: {}", e);
                self.metrics.ledgers_failed.inc();
                
                let mut state = self.state.write().await;
                state.status = "error".to_string();
                state.error_message = Some(e.to_string());
                
                self.update_indexer_status("error", Some(e.to_string().as_str())).await;
            }
            
            tokio::time::sleep(self.poll_interval).await;
        }
    }

    async fn load_checkpoint(&self) {
        let result: Option<(i64, String)> = sqlx::query_as(
            "SELECT last_ledger, COALESCE(last_ledger_hash, '') FROM indexer_checkpoints WHERE id = 'main'"
        )
        .fetch_optional(&self.pool)
        .await
        .ok()
        .flatten();
        
        if let Some((ledger, hash)) = result {
            let mut state = self.state.write().await;
            state.last_ledger = ledger as u32;
            state.last_ledger_hash = hash;
            tracing::info!("Loaded checkpoint at ledger {}", state.last_ledger);
        }
    }

    async fn update_indexer_status(&self, status: &str, error_msg: Option<&str>) {
        let _ = sqlx::query("SELECT update_indexer_status($1, $2)")
            .bind(status)
            .bind(error_msg)
            .execute(&self.pool)
            .await;
    }

    async fn sync_once(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let start = Instant::now();
        
        let (network_ledger, network_hash) = self.rpc.get_latest_ledger().await
            .map_err(|e| {
                self.metrics.rpc_errors_total.inc();
                e
            })?;
        
        let mut state = self.state.write().await;
        let start_ledger = state.last_ledger + 1;
        
        if start_ledger > network_ledger {
            tracing::debug!("Already at network height, sleeping");
            drop(state);
            
            let lag = (std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs() as i64)
                .saturating_sub(self.estimate_ledger_timestamp(network_ledger));
            
            self.metrics.indexer_lag_seconds.set(lag as f64);
            self.metrics.last_ledger_height.set(network_ledger as f64);
            
            tokio::time::sleep(Duration::from_secs(2)).await;
            return Ok(());
        }
        
        let ledgers_to_process = std::cmp::min(
            network_ledger - start_ledger + 1,
            self.max_batch_size
        );
        
        tracing::info!(
            "Processing ledgers {}-{} (out of {})",
            start_ledger,
            start_ledger + ledgers_to_process - 1,
            network_ledger
        );
        
        drop(state);
        
        for seq in start_ledger..=(start_ledger + ledgers_to_process - 1) {
            self.process_ledger(seq).await?;
        }
        
        state = self.state.write().await;
        state.last_ledger = start_ledger + ledgers_to_process - 1;
        state.last_ledger_hash = network_hash.clone();
        state.status = "syncing".to_string();
        state.error_message = None;
        drop(state);
        
        let _ = sqlx::query("SELECT record_ledger_progress($1, $2)")
            .bind((start_ledger + ledgers_to_process - 1) as i64)
            .bind(&network_hash)
            .execute(&self.pool)
            .await;
        
        self.metrics.ledgers_processed.inc();
        self.metrics.last_ledger_height.set((start_ledger + ledgers_to_process - 1) as f64);
        
        let elapsed = start.elapsed();
        self.metrics.processing_duration_seconds.observe(elapsed.as_secs_f64());
        
        tracing::info!(
            "Synced {} ledgers in {}ms",
            ledgers_to_process,
            elapsed.as_millis()
        );
        
        self.update_indexer_status("syncing", None).await;
        
        Ok(())
    }

    async fn process_ledger(&self, sequence: u32) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let ledger = self.rpc.get_ledger(sequence).await?;
        let transactions = self.rpc.get_ledger_transactions(sequence).await?;
        
        self.store_ledger_data(&ledger, &transactions).await?;
        
        Ok(())
    }

    async fn store_ledger_data(
        &self,
        ledger: &GetLedgerResponse,
        transactions: &[TransactionMeta],
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let start = Instant::now();
        
        for tx in transactions {
            let event_type = if tx.success { "transaction_success" } else { "transaction_failed" };
            
            sqlx::query(
                "INSERT INTO ledger_events (ledger_seq, ledger_hash, tx_hash, event_type, contract_id, topic, payload)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (ledger_seq, tx_hash, event_type, topic) DO NOTHING"
            )
            .bind(ledger.sequence as i64)
            .bind(&ledger.hash)
            .bind(&tx.hash)
            .bind(event_type)
            .bind("")
            .bind("")
            .bind(serde_json::json!({
                "success": tx.success,
                "application_order": tx.application_order,
                "ledger": tx.ledger,
            }))
            .execute(&self.pool)
            .await?;
            
            self.metrics.events_processed.inc();
        }
        
        self.metrics.transactions_processed.inc_by(transactions.len() as u64);
        
        let elapsed = start.elapsed();
        self.metrics.db_write_duration_seconds.observe(elapsed.as_secs_f64());
        
        Ok(())
    }

    fn estimate_ledger_timestamp(&self, _sequence: u32) -> i64 {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        now.saturating_sub(5)
    }

    pub async fn get_state(&self) -> IndexerState {
        self.state.read().await.clone()
    }

    pub async fn trigger_rescan(&self, from_ledger: u32) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        tracing::info!("Triggering rescan from ledger {}", from_ledger);
        
        let mut state = self.state.write().await;
        state.last_ledger = from_ledger.saturating_sub(1);
        state.status = "rescanning".to_string();
        
        sqlx::query("DELETE FROM ledger_events WHERE ledger_seq >= $1")
            .bind(from_ledger as i64)
            .execute(&self.pool)
            .await?;
        
        Ok(())
    }
}

pub async fn run_indexer_worker(
    pool: PgPool,
    registry: Registry,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let metrics = IndexerMetrics::new(&registry);
    let rpc = MultiProviderRpc::new(vec![
        ("stellar".to_string(), std::env::var("HORIZON_URL")
            .unwrap_or_else(|_| "https://horizon-testnet.stellar.org".to_string())),
    ]);
    
    let worker = IndexerWorker::new(pool, rpc, metrics);
    worker.run().await;
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_worker_state_initialization() {
        let state = IndexerState {
            last_ledger: 0,
            last_ledger_hash: String::new(),
            status: "idle".to_string(),
            error_message: None,
        };
        
        assert_eq!(state.last_ledger, 0);
        assert_eq!(state.status, "idle");
    }

    #[tokio::test]
    async fn test_state_transitions() {
        let state = IndexerState {
            last_ledger: 100,
            last_ledger_hash: "abc123".to_string(),
            status: "syncing".to_string(),
            error_message: None,
        };
        
        assert_eq!(state.status, "syncing");
        assert_eq!(state.last_ledger, 100);
        
        let failed_state = IndexerState {
            last_ledger: state.last_ledger,
            last_ledger_hash: state.last_ledger_hash,
            status: "error".to_string(),
            error_message: Some("connection lost".to_string()),
        };
        
        assert_eq!(failed_state.status, "error");
        assert!(failed_state.error_message.is_some());
    }

    #[tokio::test]
    async fn test_idempotent_ledger_checkpoint() {
        let pool = sqlx::PgPool::connect(&std::env::var("DATABASE_URL").unwrap_or_default()).await.unwrap_or_else(|_| {
            sqlx::PgPool::connect("postgres://localhost/test").await.unwrap()
        });
        
        let test_ledger = 200i64;
        
        for _ in 0..5 {
            let _ = sqlx::query("SELECT record_ledger_progress($1, $2)")
                .bind(test_ledger)
                .bind("test_hash")
                .execute(&pool)
                .await;
        }
        
        let result: (i64,) = sqlx::query_as(
            "SELECT last_ledger FROM indexer_checkpoints WHERE id = 'main'"
        )
        .fetch_one(&pool)
        .await.unwrap();
        
        assert_eq!(result.0, test_ledger);
    }
}