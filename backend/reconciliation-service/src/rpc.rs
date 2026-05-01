use reqwest::{StatusCode, Url};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct RetryConfig {
    pub max_attempts: u32,
    pub initial_backoff: Duration,
    pub max_backoff: Duration,
}

#[derive(Clone, Debug)]
pub struct StellarRpcClient {
    http: reqwest::Client,
    endpoint: Url,
    retry: RetryConfig,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    result: Option<Value>,
    error: Option<Value>,
}

impl StellarRpcClient {
    pub fn new(endpoint: String, retry: RetryConfig) -> anyhow::Result<Self> {
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()?,
            endpoint: endpoint.parse()?,
            retry,
        })
    }

    pub async fn latest_ledger(&self) -> anyhow::Result<i64> {
        let response = self.request("getLatestLedger", json!({})).await?;

        if let Some(sequence) = response.as_i64() {
            return Ok(sequence);
        }

        if let Some(sequence) = response.get("sequence").and_then(Value::as_i64) {
            return Ok(sequence);
        }

        if let Some(sequence) = response.get("latest_ledger").and_then(Value::as_i64) {
            return Ok(sequence);
        }

        Err(anyhow::anyhow!(
            "unexpected latest ledger response shape: {response}"
        ))
    }

    pub async fn fetch_ledger(&self, sequence: i64) -> anyhow::Result<Value> {
        self.request("getLedger", json!({ "sequence": sequence }))
            .await
    }

    async fn request(&self, method: &str, params: Value) -> anyhow::Result<Value> {
        let mut backoff = self.retry.initial_backoff;
        let mut attempt = 1;

        loop {
            let body = json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": method,
                "params": params.clone(),
            });

            let result = self
                .http
                .post(self.endpoint.clone())
                .json(&body)
                .send()
                .await;

            match result {
                Ok(response) if response.status().is_success() => {
                    let envelope: JsonRpcResponse = response.json().await?;

                    if let Some(error) = envelope.error {
                        return Err(anyhow::anyhow!("stellar rpc returned an error: {error}"));
                    }

                    return envelope
                        .result
                        .ok_or_else(|| anyhow::anyhow!("stellar rpc response missing result"));
                }
                Ok(response) if should_retry_status(response.status()) => {
                    if attempt >= self.retry.max_attempts {
                        return Err(anyhow::anyhow!(
                            "rpc request {method} failed after {attempt} attempts with status {}",
                            response.status()
                        ));
                    }
                }
                Ok(response) => {
                    return Err(anyhow::anyhow!(
                        "rpc request {method} failed with status {}",
                        response.status()
                    ));
                }
                Err(error) => {
                    if attempt >= self.retry.max_attempts {
                        return Err(error.into());
                    }
                }
            }

            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(self.retry.max_backoff);
            attempt += 1;
        }
    }
}

fn should_retry_status(status: StatusCode) -> bool {
    status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS
}
