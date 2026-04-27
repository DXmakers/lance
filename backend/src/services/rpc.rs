use async_trait::async_trait;
use backoff::{future::retry, ExponentialBackoff};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

const DEFAULT_MAX_RETRIES: u32 = 5;
const DEFAULT_INITIAL_INTERVAL_MS: u64 = 100;
const DEFAULT_MAX_INTERVAL_MS: u64 = 30000;
const DEFAULT_MULTIPLIER: f64 = 2.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcProvider {
    pub id: i32,
    pub name: String,
    pub url: String,
    pub priority: i32,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerCloseEvent {
    pub sequence: u32,
    pub hash: String,
    pub timestamp: i64,
    pub total_coins: String,
    pub fee_pool: String,
    pub base_fee: i32,
    pub base_reserve: i32,
    pub max_tx_set_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionMeta {
    pub hash: String,
    pub ledger: u32,
    pub success: bool,
    pub application_order: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetLedgerResponse {
    pub id: String,
    pub paging_token: String,
    pub hash: String,
    pub sequence: u32,
    pub successful_transaction_count: u32,
    pub failed_transaction_count: u32,
    pub operation_count: u32,
    pub closed_at: String,
    pub total_coins: String,
    pub fee_pool: String,
    pub base_fee_in_stroops: i32,
    pub base_reserve_in_stroops: i32,
    pub max_tx_set_size: u32,
    pub transactions: Vec<TransactionMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetTransactionsResponse {
    pub _links: serde_json::Value,
    pub _embedded: serde_json::Value,
}

pub type RpcResult<T> = Result<T, RpcError>;

#[derive(Debug, Clone, thiserror::Error)]
pub enum RpcError {
    #[error("RPC error: {0}")]
    Provider(String),
    #[error("All providers failed")]
    NoProvidersAvailable,
    #[error("Request failed: {0}")]
    RequestFailed(#[from] reqwest::Error),
    #[error("Parse error: {0}")]
    ParseError(String),
    #[error("Rate limited, retry after {0:?}")]
    RateLimited(Duration),
}

#[async_trait]
pub trait RpcClient: Send + Sync {
    async fn get_latest_ledger(&self) -> RpcResult<(u32, String)>;
    async fn get_ledger(&self, sequence: u32) -> RpcResult<GetLedgerResponse>;
    async fn get_ledger_transactions(&self, sequence: u32) -> RpcResult<Vec<TransactionMeta>>;
}

pub struct MultiProviderRpc {
    providers: Arc<RwLock<Vec<RpcProvider>>>,
    client: Client,
    max_retries: u32,
    current_provider_idx: Arc<RwLock<usize>>,
}

impl MultiProviderRpc {
    pub fn new(provider_urls: Vec<(String, String)>) -> Self {
        let providers: Vec<RpcProvider> = provider_urls
            .into_iter()
            .enumerate()
            .map(|(i, (name, url))| RpcProvider {
                id: i as i32,
                name,
                url,
                priority: 0,
                is_active: true,
            })
            .collect();

        Self {
            providers: Arc::new(RwLock::new(providers)),
            client: Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .expect("Failed to create HTTP client"),
            max_retries: DEFAULT_MAX_RETRIES,
            current_provider_idx: Arc::new(RwLock::new(0)),
        }
    }

    pub async fn with_providers_from_db(pool: &sqlx::PgPool) -> Self {
        let providers = Self::load_providers(pool).await.unwrap_or_else(|e| {
            tracing::warn!("Failed to load providers from DB, using defaults: {e}");
            vec![
                RpcProvider {
                    id: 1,
                    name: "stellar".to_string(),
                    url: std::env::var("HORIZON_URL")
                        .unwrap_or_else(|_| "https://horizon-testnet.stellar.org".to_string()),
                    priority: 0,
                    is_active: true,
                },
                RpcProvider {
                    id: 2,
                    name: "stellarfuturenet".to_string(),
                    url: "https://horizon-futurenet.stellar.org".to_string(),
                    priority: 1,
                    is_active: true,
                },
            ]
        });

        Self {
            providers: Arc::new(RwLock::new(providers)),
            client: Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .expect("Failed to create HTTP client"),
            max_retries: DEFAULT_MAX_RETRIES,
            current_provider_idx: Arc::new(RwLock::new(0)),
        }
    }

    async fn load_providers(pool: &sqlx::PgPool) -> sqlx::Result<Vec<RpcProvider>> {
        let rows: Vec<(i32, String, String, i32, bool)> = sqlx::query_as(
            "SELECT id, name, url, priority, is_active FROM rpc_providers ORDER BY priority"
        )
        .fetch_all(pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|(id, name, url, priority, is_active)| RpcProvider {
                id,
                name,
                url,
                priority,
                is_active,
            })
            .collect())
    }

    async fn get_active_provider(&self) -> RpcResult<RpcProvider> {
        let providers = self.providers.read().await;
        
        let mut idx = *self.current_provider_idx.read().await;
        
        for _ in 0..providers.len() {
            if idx >= providers.len() {
                idx = 0;
            }
            
            let provider = &providers[idx];
            if provider.is_active {
                return Ok(provider.clone());
            }
            idx += 1;
        }
        
        Err(RpcError::NoProvidersAvailable)
    }

    async fn next_provider(&self) {
        let mut idx = self.current_provider_idx.write().await;
        *idx = (*idx + 1) % self.providers.read().await.len().max(1);
    }

    fn create_backoff() -> ExponentialBackoff {
        ExponentialBackoff {
            initial_interval: Duration::from_millis(DEFAULT_INITIAL_INTERVAL_MS),
            max_interval: Duration::from_millis(DEFAULT_MAX_INTERVAL_MS),
            max_elapsed_time: Some(Duration::from_secs(300)),
            multiplier: DEFAULT_MULTIPLIER,
            ..Default::default()
        }
    }

    pub async fn health_check(&self, provider: &RpcProvider) -> bool {
        let url = format!("{}/health", provider.url);
        
        match self.client.get(&url).send().await {
            Ok(resp) => resp.status().is_success(),
            Err(e) => {
                tracing::warn!("Health check failed for {}: {}", provider.name, e);
                false
            }
        }
    }

    pub async fn record_failure(&self, provider_id: i32, pool: &sqlx::PgPool) {
        let _ = sqlx::query(
            "UPDATE rpc_providers SET consecutive_failures = consecutive_failures + 1, 
             health_status = CASE WHEN consecutive_failures >= 3 THEN 'unhealthy' ELSE health_status END,
             updated_at = NOW() WHERE id = $1"
        )
        .bind(provider_id)
        .execute(pool)
        .await;

        tracing::warn!("Provider {} recorded failure", provider_id);
    }

    pub async fn record_success(&self, provider_id: i32, pool: &sqlx::PgPool) {
        let _ = sqlx::query(
            "UPDATE rpc_providers SET consecutive_failures = 0, health_status = 'healthy', 
             last_health_check = NOW(), updated_at = NOW() WHERE id = $1"
        )
        .bind(provider_id)
        .execute(pool)
        .await;
    }

    async fn execute_with_provider<F, T, R>(&self, operation: F) -> RpcResult<T>
    where
        F: Fn(&str) -> R,
        R: std::future::Future<Output = RpcResult<T>>,
    {
        let provider = self.get_active_provider().await?;
        let url = provider.url.clone();
        
        let backoff = Self::create_backoff();
        
        let result = retry(backoff, || {
            let url = url.clone();
            async move {
                match operation(&url).await {
                    Ok(v) => Ok(v),
                    Err(e) => {
                        match &e {
                            RpcError::RateLimited(_) => {},
                            _ => {
                                tracing::warn!("RPC operation failed, retrying: {}", e);
                            }
                        }
                        Err(e)
                    }
                }
            }
        }).await;
        
        result
    }
}

#[async_trait]
impl RpcClient for MultiProviderRpc {
    async fn get_latest_ledger(&self) -> RpcResult<(u32, String)> {
        let providers = self.providers.read().await;
        
        for provider in providers.iter().filter(|p| p.is_active) {
            let url = format!("{}/ledgers?limit=1&order=desc", provider.url);
            
            let backoff = Self::create_backoff();
            
            let result = retry(backoff, || {
                let url = url.clone();
                async move {
                    let resp = self.client
                        .get(&url)
                        .send()
                        .await
                        .map_err(RpcError::RequestFailed)?;
                    
                    if resp.status() == 429 {
                        return Err(RpcError::RateLimited(Duration::from_secs(60)));
                    }
                    
                    if !resp.status().is_success() {
                        return Err(RpcError::Provider(format!(
                            "HTTP error: {}", resp.status()
                        )));
                    }
                    
                    #[derive(Deserialize)]
                    struct LedgersResponse {
                        _embedded: EmbeddedLedgers,
                    }
                    
                    #[derive(Deserialize)]
                    struct EmbeddedLedgers {
                        records: Vec<LedgerRecord>,
                    }
                    
                    #[derive(Deserialize)]
                    struct LedgerRecord {
                        id: String,
                        sequence: u32,
                        hash: String,
                    }
                    
                    let ledgers: LedgersResponse = resp.json()
                        .await
                        .map_err(|e| RpcError::ParseError(e.to_string()))?;
                    
                    let record = ledgers._embedded.records.into_iter().next()
                        .ok_or_else(|| RpcError::Provider("No ledger records found".to_string()))?;
                    
                    Ok((record.sequence, record.hash))
                }
            }).await;
            
            match result {
                Ok(ledger) => return Ok(ledger),
                Err(e) => {
                    tracing::warn!("Provider {} failed: {}", provider.name, e);
                    continue;
                }
            }
        }
        
        Err(RpcError::NoProvidersAvailable)
    }

    async fn get_ledger(&self, sequence: u32) -> RpcResult<GetLedgerResponse> {
        let providers = self.providers.read().await;
        
        for provider in providers.iter().filter(|p| p.is_active) {
            let url = format!("{}/ledgers/{}", provider.url, sequence);
            
            let backoff = Self::create_backoff();
            
            let result = retry(backoff, || {
                let url = url.clone();
                async move {
                    let resp = self.client
                        .get(&url)
                        .send()
                        .await
                        .map_err(RpcError::RequestFailed)?;
                    
                    if !resp.status().is_success() {
                        return Err(RpcError::Provider(format!(
                            "HTTP error: {}", resp.status()
                        )));
                    }
                    
                    resp.json()
                        .await
                        .map_err(|e| RpcError::ParseError(e.to_string()))
                }
            }).await;
            
            match result {
                Ok(ledger) => return Ok(ledger),
                Err(e) => {
                    tracing::warn!("Provider {} failed for ledger {}: {}", provider.name, sequence, e);
                    continue;
                }
            }
        }
        
        Err(RpcError::NoProvidersAvailable)
    }

    async fn get_ledger_transactions(&self, sequence: u32) -> RpcResult<Vec<TransactionMeta>> {
        let providers = self.providers.read().await;
        
        for provider in providers.iter().filter(|p| p.is_active) {
            let url = format!("{}/ledgers/{}/transactions", provider.url, sequence);
            
            let backoff = Self::create_backoff();
            
            let result = retry(backoff, || {
                let url = url.clone();
                async move {
                    let resp = self.client
                        .get(&url)
                        .send()
                        .await
                        .map_err(RpcError::RequestFailed)?;
                    
                    if !resp.status().is_success() {
                        return Err(RpcError::Provider(format!(
                            "HTTP error: {}", resp.status()
                        )));
                    }
                    
                    #[derive(Deserialize)]
                    struct TxResponse {
                        _embedded: Embedded,
                    }
                    
                    #[derive(Deserialize)]
                    struct Embedded {
                        records: Vec<TxRecord>,
                    }
                    
                    #[derive(Deserialize)]
                    struct TxRecord {
                        hash: String,
                        ledger: u32,
                        successful: bool,
                        application_order: Option<u32>,
                    }
                    
                    let tx_resp: TxResponse = resp.json()
                        .await
                        .map_err(|e| RpcError::ParseError(e.to_string()))?;
                    
                    let transactions: Vec<TransactionMeta> = tx_resp._embedded.records
                        .into_iter()
                        .map(|r| TransactionMeta {
                            hash: r.hash,
                            ledger: r.ledger,
                            success: r.successful,
                            application_order: r.application_order.unwrap_or(0),
                        })
                        .collect();
                    
                    Ok(transactions)
                }
            }).await;
            
            match result {
                Ok(txs) => return Ok(txs),
                Err(e) => {
                    tracing::warn!("Provider {} failed for transactions: {}", provider.name, e);
                    continue;
                }
            }
        }
        
        Err(RpcError::NoProvidersAvailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::sync::RwLock;

    #[test]
    fn test_backoff_config() {
        let backoff = MultiProviderRpc::create_backoff();
        assert_eq!(backoff.initial_interval, Duration::from_millis(100));
    }

    #[tokio::test]
    async fn test_empty_providers() {
        let rpc = MultiProviderRpc::new(vec![]);
        let result = rpc.get_active_provider().await;
        assert!(matches!(result, Err(RpcError::NoProvidersAvailable)));
    }

    #[tokio::test]
    async fn test_provider_rotation() {
        let rpc = MultiProviderRpc::new(vec![
            ("provider1".to_string(), "http://localhost:8001".to_string()),
            ("provider2".to_string(), "http://localhost:8002".to_string()),
        ]);
        
        let provider1 = rpc.get_active_provider().await.unwrap();
        assert_eq!(provider1.name, "provider1");
        
        rpc.next_provider().await;
        
        let provider2 = rpc.get_active_provider().await.unwrap();
        assert_eq!(provider2.name, "provider2");
    }

    #[tokio::test]
    async fn test_inactive_provider_skipped() {
        let rpc = MultiProviderRpc::new(vec![
            ("provider1".to_string(), "http://localhost:8001".to_string()),
            ("provider2".to_string(), "http://localhost:8002".to_string()),
        ]);
        
        {
            let mut providers = rpc.providers.write().await;
            providers[0].is_active = false;
        }
        
        let provider = rpc.get_active_provider().await.unwrap();
        assert_eq!(provider.name, "provider2");
    }

    #[tokio::test]
    async fn test_all_providers_fail_returns_no_available() {
        let rpc = MultiProviderRpc::new(vec![
            ("bad1".to_string(), "http://localhost:9991".to_string()),
            ("bad2".to_string(), "http://localhost:9992".to_string()),
        ]);
        
        let result = rpc.get_latest_ledger().await;
        assert!(matches!(result, Err(RpcError::NoProvidersAvailable)));
    }

    #[tokio::test]
    async fn test_idempotent_ledger_processing() {
        #[derive(sqlx::FromRow)]
        struct EventRow {
            ledger_seq: i64,
            tx_hash: String,
            event_type: String,
        }
        
        let pool = sqlx::PgPool::connect(&std::env::var("DATABASE_URL").unwrap_or_default()).await.unwrap_or_else(|_| {
            sqlx::PgPool::connect("postgres://localhost/test").await.unwrap()
        });
        
        let test_ledger = 100i64;
        let test_hash = "abc123".to_string();
        
        for _ in 0..3 {
            let _ = sqlx::query(
                "INSERT INTO ledger_events (ledger_seq, ledger_hash, tx_hash, event_type, contract_id, topic, payload)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (ledger_seq, tx_hash, event_type, topic) DO NOTHING"
            )
            .bind(test_ledger)
            .bind(&test_hash)
            .bind("test_tx")
            .bind("test_event")
            .bind("contract")
            .bind("topic")
            .bind(serde_json::json!({}))
            .execute(&pool)
            .await;
        }
        
        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM ledger_events WHERE ledger_seq = $1"
        )
        .bind(test_ledger)
        .fetch_one(&pool)
        .await.unwrap();
        
        assert_eq!(count.0, 1);
    }
}