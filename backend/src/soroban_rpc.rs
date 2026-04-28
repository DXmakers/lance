use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use reqwest::{Client, StatusCode};
use serde_json::{json, Value};
use tracing::{debug, info, instrument, warn};

use crate::indexer_metrics::metrics;

const DEFAULT_SOROBAN_RPC_URL: &str = "https://soroban-testnet.stellar.org";
const DEFAULT_RPC_RATE_LIMIT_MS: u64 = 100;
const DEFAULT_RPC_RETRY_ATTEMPTS: u32 = 5;
const DEFAULT_RPC_RETRY_INITIAL_BACKOFF_MS: u64 = 200;
const DEFAULT_RPC_RETRY_MAX_BACKOFF_MS: u64 = 3_000;
const DEFAULT_RPC_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_CIRCUIT_BREAKER_THRESHOLD: u32 = 5;
const DEFAULT_CIRCUIT_BREAKER_TIMEOUT_MS: u64 = 30_000;

#[derive(Clone, Debug)]
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub initial_backoff: Duration,
    pub max_backoff: Duration,
    pub jitter_enabled: bool,
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
            jitter_enabled: read_env_bool(&format!("{prefix}_JITTER_ENABLED"), true),
        }
    }

    pub fn delay_for_attempt(&self, attempt: u32) -> Duration {
        let factor = 2u128.saturating_pow(attempt);
        let raw_ms = self.initial_backoff.as_millis().saturating_mul(factor);
        let capped_ms = raw_ms.min(self.max_backoff.as_millis()) as u64;

        if self.jitter_enabled {
            // Add jitter: random value between 0% and 25% of the delay
            let jitter_range = capped_ms / 4;
            let jitter = (std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos() as u64)
                % jitter_range;
            Duration::from_millis(capped_ms + jitter)
        } else {
            Duration::from_millis(capped_ms)
        }
    }
}

#[derive(Clone, Debug)]
pub struct CircuitBreakerConfig {
    pub failure_threshold: u32,
    pub timeout: Duration,
    pub enabled: bool,
}

impl CircuitBreakerConfig {
    pub fn from_env() -> Self {
        Self {
            failure_threshold: read_env_u32(
                "INDEXER_CIRCUIT_BREAKER_THRESHOLD",
                DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
            ),
            timeout: Duration::from_millis(read_env_u64(
                "INDEXER_CIRCUIT_BREAKER_TIMEOUT_MS",
                DEFAULT_CIRCUIT_BREAKER_TIMEOUT_MS,
            )),
            enabled: read_env_bool("INDEXER_CIRCUIT_BREAKER_ENABLED", true),
        }
    }
}

#[derive(Debug)]
enum CircuitBreakerState {
    Closed,
    Open { opened_at: Instant },
    HalfOpen,
}

struct CircuitBreaker {
    state: CircuitBreakerState,
    consecutive_failures: u32,
    config: CircuitBreakerConfig,
}

impl CircuitBreaker {
    fn new(config: CircuitBreakerConfig) -> Self {
        Self {
            state: CircuitBreakerState::Closed,
            consecutive_failures: 0,
            config,
        }
    }

    fn record_success(&mut self) {
        self.consecutive_failures = 0;
        self.state = CircuitBreakerState::Closed;
    }

    fn record_failure(&mut self) {
        if !self.config.enabled {
            return;
        }

        self.consecutive_failures += 1;

        if self.consecutive_failures >= self.config.failure_threshold {
            self.state = CircuitBreakerState::Open {
                opened_at: Instant::now(),
            };
            warn!(
                consecutive_failures = self.consecutive_failures,
                threshold = self.config.failure_threshold,
                "circuit breaker opened due to consecutive failures"
            );
        }
    }

    fn can_attempt(&mut self) -> Result<()> {
        if !self.config.enabled {
            return Ok(());
        }

        match &self.state {
            CircuitBreakerState::Closed => Ok(()),
            CircuitBreakerState::Open { opened_at } => {
                if opened_at.elapsed() >= self.config.timeout {
                    info!("circuit breaker transitioning to half-open state");
                    self.state = CircuitBreakerState::HalfOpen;
                    Ok(())
                } else {
                    Err(anyhow!(
                        "circuit breaker is open, will retry in {} seconds",
                        (self.config.timeout - opened_at.elapsed()).as_secs()
                    ))
                }
            }
            CircuitBreakerState::HalfOpen => Ok(()),
        }
    }
}

#[derive(Clone, Debug)]
pub struct RpcClientConfig {
    pub url: String,
    pub rate_limit_interval: Duration,
    pub retry_policy: RetryPolicy,
    pub request_timeout: Duration,
    pub circuit_breaker: CircuitBreakerConfig,
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
            request_timeout: Duration::from_millis(read_env_u64(
                "INDEXER_RPC_TIMEOUT_MS",
                DEFAULT_RPC_TIMEOUT_MS,
            )),
            circuit_breaker: CircuitBreakerConfig::from_env(),
        }
    }
}

pub struct EventsResponse {
    pub latest_network_ledger: i64,
    pub events: Vec<Value>,
}

#[derive(Clone)]
pub struct RpcMetrics {
    pub total_requests: Arc<AtomicU64>,
    pub successful_requests: Arc<AtomicU64>,
    pub failed_requests: Arc<AtomicU64>,
}

impl RpcMetrics {
    fn new() -> Self {
        Self {
            total_requests: Arc::new(AtomicU64::new(0)),
            successful_requests: Arc::new(AtomicU64::new(0)),
            failed_requests: Arc::new(AtomicU64::new(0)),
        }
    }

    fn record_request(&self) {
        self.total_requests.fetch_add(1, Ordering::Relaxed);
    }

    fn record_success(&self) {
        self.successful_requests.fetch_add(1, Ordering::Relaxed);
    }

    fn record_failure(&self) {
        self.failed_requests.fetch_add(1, Ordering::Relaxed);
    }
}

pub struct SorobanRpcClient {
    client: Client,
    pub config: RpcClientConfig,
    last_request_started_at: Option<Instant>,
    circuit_breaker: CircuitBreaker,
    metrics: RpcMetrics,
}

impl SorobanRpcClient {
    pub fn new(client: Client, config: RpcClientConfig) -> Self {
        let circuit_breaker = CircuitBreaker::new(config.circuit_breaker.clone());
        Self {
            client,
            config,
            last_request_started_at: None,
            circuit_breaker,
            metrics: RpcMetrics::new(),
        }
    }

    #[instrument(skip(self), fields(rpc_url = %self.config.url))]
    pub async fn get_latest_ledger(&mut self) -> Result<i64> {
        let result = self.rpc_request("getLatestLedger", json!({})).await?;
        let sequence = result
            .get("sequence")
            .and_then(parse_i64)
            .ok_or_else(|| anyhow!("missing sequence in getLatestLedger response"))?;

        metrics()
            .last_network_ledger
            .store(sequence, Ordering::Relaxed);

        debug!(sequence, "fetched latest ledger from network");

        Ok(sequence)
    }

    #[instrument(skip(self), fields(rpc_url = %self.config.url, start_ledger))]
    pub async fn get_events(&mut self, start_ledger: i64) -> Result<EventsResponse> {
        let result = self
            .rpc_request(
                "getEvents",
                json!({
                    "startLedger": start_ledger,
                    "filters": [],
                    "pagination": {
                        "limit": 10000
                    }
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

        debug!(
            start_ledger,
            latest_network_ledger,
            events_count = events.len(),
            ledger_range = latest_network_ledger - start_ledger,
            "fetched events from RPC"
        );

        Ok(EventsResponse {
            latest_network_ledger,
            events,
        })
    }

    async fn rpc_request(&mut self, method: &str, params: Value) -> Result<Value> {
        // Check circuit breaker before attempting request
        self.circuit_breaker.can_attempt()?;

        let request_body = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        });

        let mut last_error: Option<anyhow::Error> = None;

        for attempt in 0..self.config.retry_policy.max_attempts {
            self.metrics.record_request();
            self.enforce_rate_limit().await;
            let started_at = Instant::now();

            let response = tokio::time::timeout(
                self.config.request_timeout,
                self.client
                    .post(&self.config.url)
                    .json(&request_body)
                    .send(),
            )
            .await;

            let latency_ms = started_at.elapsed().as_millis() as u64;
            metrics()
                .last_rpc_latency_ms
                .store(latency_ms, Ordering::Relaxed);

            match response {
                Ok(Ok(response)) => {
                    let status = response.status();
                    let body = response.text().await.unwrap_or_default();

                    if !status.is_success() {
                        let message = format!("RPC {method} HTTP {status}: {body}");
                        last_error = Some(anyhow!(message.clone()));

                        if should_retry_http_status(status)
                            && attempt + 1 < self.config.retry_policy.max_attempts
                        {
                            self.sleep_before_retry(method, attempt, &message).await;
                            continue;
                        }

                        self.metrics.record_failure();
                        self.circuit_breaker.record_failure();
                        crate::indexer_metrics::metrics().record_rpc_error();
                        return Err(anyhow!(message));
                    }

                    let payload: Value = match serde_json::from_str(&body) {
                        Ok(p) => p,
                        Err(e) => {
                            let message = format!("failed to decode RPC {method} response: {e}");
                            last_error = Some(anyhow!(message.clone()));

                            if attempt + 1 < self.config.retry_policy.max_attempts {
                                self.sleep_before_retry(method, attempt, &message).await;
                                continue;
                            }

                            self.metrics.record_failure();
                            self.circuit_breaker.record_failure();
                            crate::indexer_metrics::metrics().record_rpc_error();
                            return Err(anyhow!(message));
                        }
                    };

                    if let Some(rpc_error) = payload.get("error") {
                        let message = rpc_error.to_string();
                        last_error = Some(anyhow!(message.clone()));

                        if should_retry_rpc_error(rpc_error)
                            && attempt + 1 < self.config.retry_policy.max_attempts
                        {
                            self.sleep_before_retry(method, attempt, &message).await;
                            continue;
                        }

                        self.metrics.record_failure();
                        self.circuit_breaker.record_failure();
                        crate::indexer_metrics::metrics().record_rpc_error();
                        return Err(anyhow!("RPC {method} error: {message}"));
                    }

                    let result = payload
                        .get("result")
                        .cloned()
                        .ok_or_else(|| anyhow!("missing result field in RPC {method} response"))?;

                    self.metrics.record_success();
                    self.circuit_breaker.record_success();

                    debug!(
                        method,
                        attempt = attempt + 1,
                        latency_ms,
                        "RPC request succeeded"
                    );

                    return Ok(result);
                }
                Ok(Err(err)) => {
                    let message = err.to_string();
                    last_error = Some(anyhow!(message.clone()));

                    if attempt + 1 < self.config.retry_policy.max_attempts {
                        self.sleep_before_retry(method, attempt, &message).await;
                        continue;
                    }

                    self.metrics.record_failure();
                    self.circuit_breaker.record_failure();
                    crate::indexer_metrics::metrics().record_rpc_error();
                    return Err(anyhow!(err).context(format!("RPC request failed for {method}")));
                }
                Err(_timeout) => {
                    let message = format!(
                        "RPC {method} request timed out after {}ms",
                        self.config.request_timeout.as_millis()
                    );
                    last_error = Some(anyhow!(message.clone()));

                    if attempt + 1 < self.config.retry_policy.max_attempts {
                        self.sleep_before_retry(method, attempt, &message).await;
                        continue;
                    }

                    self.metrics.record_failure();
                    self.circuit_breaker.record_failure();
                    crate::indexer_metrics::metrics().record_rpc_error();
                    return Err(anyhow!(message));
                }
            }
        }

        self.metrics.record_failure();
        self.circuit_breaker.record_failure();
        crate::indexer_metrics::metrics().record_rpc_error();

        Err(last_error
            .unwrap_or_else(|| anyhow!("RPC request exhausted retries for method {method}")))
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

fn read_env_bool(key: &str, default: bool) -> bool {
    std::env::var(key)
        .ok()
        .and_then(|v| match v.to_lowercase().as_str() {
            "true" | "1" | "yes" | "on" => Some(true),
            "false" | "0" | "no" | "off" => Some(false),
            _ => None,
        })
        .unwrap_or(default)
}

fn should_retry_http_status(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS
        || status == StatusCode::REQUEST_TIMEOUT
        || status == StatusCode::SERVICE_UNAVAILABLE
        || status == StatusCode::GATEWAY_TIMEOUT
        || status == StatusCode::BAD_GATEWAY
        || status.is_server_error()
}

fn should_retry_rpc_error(error: &Value) -> bool {
    let message = error.to_string().to_lowercase();
    message.contains("rate limit")
        || message.contains("too many requests")
        || message.contains("temporar")
        || message.contains("timeout")
        || message.contains("unavailable")
        || message.contains("overload")
        || message.contains("busy")
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
                jitter_enabled: false,
            },
            request_timeout: Duration::from_secs(30),
            circuit_breaker: CircuitBreakerConfig {
                failure_threshold: 10,
                timeout: Duration::from_secs(60),
                enabled: false,
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
}
