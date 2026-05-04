use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use reqwest::{Client, StatusCode};
use serde_json::{json, Value};
use tracing::warn;

use crate::indexer_metrics::metrics;

const DEFAULT_SOROBAN_RPC_URL: &str = "https://soroban-testnet.stellar.org";
const DEFAULT_RPC_RATE_LIMIT_MS: u64 = 250;
const DEFAULT_RPC_RETRY_ATTEMPTS: u32 = 4;
const DEFAULT_RPC_RETRY_INITIAL_BACKOFF_MS: u64 = 500;
const DEFAULT_RPC_RETRY_MAX_BACKOFF_MS: u64 = 5_000;

#[derive(Clone, Debug)]
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub initial_backoff: Duration,
    pub max_backoff: Duration,
}

impl RetryPolicy {
    pub fn from_env(
        prefix: &str,
        default_attempts: u32,
        default_initial_ms: u64,
        default_max_ms: u64,
    ) -> Self {
        Self {
            max_attempts: read_env_u32(&format!("{prefix}_MAX_ATTEMPTS"), default_attempts).max(1),
            initial_backoff: Duration::from_millis(read_env_u64(
                &format!("{prefix}_INITIAL_BACKOFF_MS"),
                default_initial_ms,
            )),
            max_backoff: Duration::from_millis(read_env_u64(
                &format!("{prefix}_MAX_BACKOFF_MS"),
                default_max_ms.max(default_initial_ms),
            )),
        }
    }

    pub fn delay_for_attempt(&self, attempt: u32) -> Duration {
        let factor = 2u128.saturating_pow(attempt);
        let raw_ms = self.initial_backoff.as_millis().saturating_mul(factor);
        Duration::from_millis(raw_ms.min(self.max_backoff.as_millis()) as u64)
    }
}

#[derive(Clone, Debug)]
pub struct RpcClientConfig {
    pub url: String,
    pub rate_limit_interval: Duration,
    pub retry_policy: RetryPolicy,
}

impl RpcClientConfig {
    pub fn from_env() -> Self {
        Self {
            url: std::env::var("SOROBAN_RPC_URL")
                .or_else(|_| std::env::var("STELLAR_RPC_URL"))
                .unwrap_or_else(|_| DEFAULT_SOROBAN_RPC_URL.to_string()),
            rate_limit_interval: Duration::from_millis(read_env_u64(
                "INDEXER_RPC_RATE_LIMIT_MS",
                DEFAULT_RPC_RATE_LIMIT_MS,
            )),
            retry_policy: RetryPolicy::from_env(
                "INDEXER_RPC_RETRY",
                DEFAULT_RPC_RETRY_ATTEMPTS,
                DEFAULT_RPC_RETRY_INITIAL_BACKOFF_MS,
                DEFAULT_RPC_RETRY_MAX_BACKOFF_MS,
            ),
        }
    }
}

pub struct EventsResponse {
    pub latest_network_ledger: i64,
    pub events: Vec<Value>,
}

pub struct SorobanRpcClient {
    client: Client,
    pub config: RpcClientConfig,
    last_request_started_at: Option<Instant>,
}

impl SorobanRpcClient {
    pub fn new(client: Client, config: RpcClientConfig) -> Self {
        Self {
            client,
            config,
            last_request_started_at: None,
        }
    }

    pub async fn get_latest_ledger(&mut self) -> Result<i64> {
        let result = self.rpc_request("getLatestLedger", json!({})).await?;
        let sequence = result
            .get("sequence")
            .and_then(parse_i64)
            .ok_or_else(|| anyhow!("missing sequence in getLatestLedger response"))?;

        metrics()
            .last_network_ledger
            .store(sequence, Ordering::Relaxed);

        Ok(sequence)
    }

    pub async fn get_events(&mut self, start_ledger: i64) -> Result<EventsResponse> {
        let result = self
            .rpc_request(
                "getEvents",
                json!({
                    "startLedger": start_ledger,
                    "filters": []
                }),
            )
            .await?;

        let latest_network_ledger = result
            .get("latestLedger")
            .and_then(parse_i64)
            .unwrap_or(start_ledger.saturating_sub(1));

        metrics()
            .last_network_ledger
            .store(latest_network_ledger, Ordering::Relaxed);

        let events = result
            .get("events")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        Ok(EventsResponse {
            latest_network_ledger,
            events,
        })
    }

    async fn rpc_request(&mut self, method: &str, params: Value) -> Result<Value> {
        let request_body = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        });

        for attempt in 0..self.config.retry_policy.max_attempts {
            self.enforce_rate_limit().await;
            let started_at = Instant::now();

            let response = self
                .client
                .post(&self.config.url)
                .json(&request_body)
                .send()
                .await;

            metrics()
                .last_rpc_latency_ms
                .store(started_at.elapsed().as_millis() as u64, Ordering::Relaxed);

            match response {
                Ok(response) => {
                    let status = response.status();
                    let body = response.text().await.unwrap_or_default();

                    if !status.is_success() {
                        let message = format!("RPC {method} HTTP {status}: {body}");
                        if should_retry_http_status(status)
                            && attempt + 1 < self.config.retry_policy.max_attempts
                        {
                            self.sleep_before_retry(method, attempt, &message).await;
                            continue;
                        }
                        return Err(anyhow!(message));
                    }

                    let payload: Value = serde_json::from_str(&body).with_context(|| {
                        format!("failed to decode RPC {method} response body: {body}")
                    })?;

                    if let Some(rpc_error) = payload.get("error") {
                        let message = rpc_error.to_string();
                        if should_retry_rpc_error(rpc_error)
                            && attempt + 1 < self.config.retry_policy.max_attempts
                        {
                            self.sleep_before_retry(method, attempt, &message).await;
                            continue;
                        }
                        return Err(anyhow!("RPC {method} error: {message}"));
                    }

                    return payload
                        .get("result")
                        .cloned()
                        .ok_or_else(|| anyhow!("missing result field in RPC {method} response"));
                }
                Err(err) => {
                    if attempt + 1 < self.config.retry_policy.max_attempts {
                        self.sleep_before_retry(method, attempt, &err.to_string())
                            .await;
                        continue;
                    }
                    return Err(anyhow!(err).context(format!("RPC request failed for {method}")));
                }
            }
        }

        Err(anyhow!("RPC request exhausted retries for method {method}"))
    }

    async fn enforce_rate_limit(&mut self) {
        if self.config.rate_limit_interval.is_zero() {
            self.last_request_started_at = Some(Instant::now());
            return;
        }

        if let Some(last_request_started_at) = self.last_request_started_at {
            let elapsed = last_request_started_at.elapsed();
            if elapsed < self.config.rate_limit_interval {
                tokio::time::sleep(self.config.rate_limit_interval - elapsed).await;
            }
        }

        self.last_request_started_at = Some(Instant::now());
    }

    async fn sleep_before_retry(&self, method: &str, attempt: u32, message: &str) {
        let delay = self.config.retry_policy.delay_for_attempt(attempt);
        metrics().total_rpc_retries.fetch_add(1, Ordering::Relaxed);

        warn!(
            method,
            attempt = attempt + 1,
            backoff_ms = delay.as_millis() as u64,
            error = message,
            "retrying RPC request",
        );

        tokio::time::sleep(delay).await;
    }
}

pub fn parse_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|v| i64::try_from(v).ok()))
        .or_else(|| value.as_str().and_then(|v| v.parse::<i64>().ok()))
}

fn read_env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(default)
}

fn read_env_u32(key: &str, default: u32) -> u32 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(default)
}

fn should_retry_http_status(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

fn should_retry_rpc_error(error: &Value) -> bool {
    let message = error.to_string().to_lowercase();
    message.contains("rate limit")
        || message.contains("too many requests")
        || message.contains("temporar")
        || message.contains("timeout")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::State, http::StatusCode as AxumStatus, routing::post, Json, Router};
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
    use std::sync::Arc;

    fn test_config(rpc_url: String) -> RpcClientConfig {
        RpcClientConfig {
            url: rpc_url,
            rate_limit_interval: Duration::ZERO,
            retry_policy: RetryPolicy {
                max_attempts: 2,
                initial_backoff: Duration::from_millis(1),
                max_backoff: Duration::from_millis(2),
            },
        }
    }

    #[test]
    fn retry_policy_caps_exponential_backoff() {
        let policy = RetryPolicy {
            max_attempts: 4,
            initial_backoff: Duration::from_millis(100),
            max_backoff: Duration::from_millis(350),
        };

        assert_eq!(policy.delay_for_attempt(0), Duration::from_millis(100));
        assert_eq!(policy.delay_for_attempt(1), Duration::from_millis(200));
        assert_eq!(policy.delay_for_attempt(2), Duration::from_millis(350));
        assert_eq!(policy.delay_for_attempt(6), Duration::from_millis(350));
    }

    #[tokio::test]
    async fn rpc_client_retries_rate_limited_requests() {
        let request_count = Arc::new(AtomicUsize::new(0));

        async fn rpc_handler(
            State(request_count): State<Arc<AtomicUsize>>,
        ) -> Result<Json<serde_json::Value>, (AxumStatus, String)> {
            let seen = request_count.fetch_add(1, AtomicOrdering::SeqCst);
            if seen == 0 {
                return Err((
                    AxumStatus::TOO_MANY_REQUESTS,
                    "too many requests".to_string(),
                ));
            }
            Ok(Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": { "sequence": 12345 }
            })))
        }

        let app = Router::new()
            .route("/", post(rpc_handler))
            .with_state(request_count.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let mut rpc =
            SorobanRpcClient::new(Client::new(), test_config(format!("http://{address}")));
        let latest_ledger = rpc.get_latest_ledger().await.unwrap();

        assert_eq!(latest_ledger, 12345);
        assert_eq!(request_count.load(AtomicOrdering::SeqCst), 2);
    }

    #[tokio::test]
    async fn rpc_client_retries_server_error_requests() {
        let request_count = Arc::new(AtomicUsize::new(0));

        async fn rpc_handler(
            State(request_count): State<Arc<AtomicUsize>>,
        ) -> Result<Json<serde_json::Value>, (AxumStatus, String)> {
            let seen = request_count.fetch_add(1, AtomicOrdering::SeqCst);
            if seen == 0 {
                return Err((
                    AxumStatus::INTERNAL_SERVER_ERROR,
                    "internal server error".to_string(),
                ));
            }
            Ok(Json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": { "sequence": 54321 }
            })))
        }

        let app = Router::new()
            .route("/", post(rpc_handler))
            .with_state(request_count.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let mut rpc =
            SorobanRpcClient::new(Client::new(), test_config(format!("http://{address}")));
        let latest_ledger = rpc.get_latest_ledger().await.unwrap();

        assert_eq!(latest_ledger, 54321);
        assert_eq!(request_count.load(AtomicOrdering::SeqCst), 2);
    }
}
