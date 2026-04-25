use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::time::Duration;

use anyhow::{anyhow, Result};
use reqwest::Client;
use serde_json::json;
use sqlx::PgPool;
use tracing::{error, info};

use std::sync::OnceLock;

/// Global indexer metrics
#[derive(Default)]
pub struct IndexerMetrics {
    pub last_processed_ledger: AtomicI64,
    pub total_events_processed: AtomicU64,
    pub total_errors: AtomicU64,
}

pub static INDEXER_METRICS: OnceLock<IndexerMetrics> = OnceLock::new();

pub fn metrics() -> &'static IndexerMetrics {
    INDEXER_METRICS.get_or_init(IndexerMetrics::default)
}

pub async fn run_indexer_worker(pool: PgPool) {
    let rpc_url = std::env::var("SOROBAN_RPC_URL")
        .unwrap_or_else(|_| "https://soroban-testnet.stellar.org".to_string());
    let client = Client::new();

    let mut backoff = Duration::from_secs(1);
    let max_backoff = Duration::from_secs(60);

    info!("Starting Soroban indexer worker with RPC: {}", rpc_url);

    loop {
        match index_next_ledgers(&pool, &client, &rpc_url).await {
            Ok(processed_something) => {
                backoff = Duration::from_secs(1); // reset backoff
                if !processed_something {
                    // Sleep if caught up
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            }
            Err(e) => {
                metrics().total_errors.fetch_add(1, Ordering::Relaxed);
                error!("Indexer error: {:?}. Retrying in {:?}", e, backoff);
                tokio::time::sleep(backoff).await;
                backoff = std::cmp::min(backoff * 2, max_backoff);
            }
        }
    }
}

async fn index_next_ledgers(pool: &PgPool, client: &Client, rpc_url: &str) -> Result<bool> {
    // 1. Get last processed ledger
    let mut last_ledger: i64 =
        sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state WHERE id = 1")
            .fetch_optional(pool)
            .await?
            .unwrap_or(0);

    // If starting fresh, we might want to get the latest network ledger
    if last_ledger == 0 {
        last_ledger = get_latest_ledger(client, rpc_url).await?;
        sqlx::query("INSERT INTO indexer_state (id, last_processed_ledger) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET last_processed_ledger = $1")
            .bind(last_ledger)
            .execute(pool)
            .await?;
        return Ok(true);
    }

    let start_ledger = last_ledger + 1;

    // 2. Fetch events from Soroban RPC
    let events_req = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getEvents",
        "params": {
            "startLedger": start_ledger,
            "filters": []
        }
    });

    let resp_val: serde_json::Value = client
        .post(rpc_url)
        .json(&events_req)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    if let Some(error) = resp_val.get("error") {
        return Err(anyhow!("RPC error: {error}"));
    }

    let result = resp_val
        .get("result")
        .ok_or_else(|| anyhow!("No result in RPC response"))?;

    // Check if network is behind start_ledger
    if let Some(latest_ledger) = result.get("latestLedger").and_then(|v| v.as_i64()) {
        if latest_ledger < start_ledger {
            return Ok(false);
        }
    }

    let events = result.get("events").and_then(|v| v.as_array());

    let mut processed_any = false;
    let mut tx_pool = pool.begin().await?;

    if let Some(events_list) = events {
        for event in events_list {
            let ledger = event
                .get("ledger")
                .and_then(|v| v.as_str())
                .and_then(|v| v.parse::<i64>().ok())
                .unwrap_or(start_ledger);
            let evt_id = event.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let contract_id = event
                .get("contractId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let topic_hash = event
                .get("topic")
                .and_then(|arr| arr.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .unwrap_or("");

            // 3. Idempotent insert
            let inserted = sqlx::query(
                "INSERT INTO indexed_events (id, ledger_amount, contract_id, topic_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING"
            )
            .bind(evt_id)
            .bind(ledger)
            .bind(contract_id)
            .bind(topic_hash)
            .execute(&mut *tx_pool)
            .await?;

            if inserted.rows_affected() > 0 {
                metrics()
                    .total_events_processed
                    .fetch_add(1, Ordering::Relaxed);
                processed_any = true;
            }
        }
    }

    // 4. Update checkpoint
    let latest_ledger = result
        .get("latestLedger")
        .and_then(|v| v.as_i64())
        .unwrap_or(start_ledger);
    let next_checkpoint = std::cmp::max(start_ledger, latest_ledger);

    sqlx::query(
        "UPDATE indexer_state SET last_processed_ledger = $1, updated_at = NOW() WHERE id = 1",
    )
    .bind(next_checkpoint)
    .execute(&mut *tx_pool)
    .await?;

    tx_pool.commit().await?;

    metrics()
        .last_processed_ledger
        .store(next_checkpoint, Ordering::Relaxed);
    info!("Processed up to ledger {}", next_checkpoint);

    Ok(processed_any)
}

async fn get_latest_ledger(client: &Client, rpc_url: &str) -> Result<i64> {
    let req = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getLatestLedger",
        "params": {}
    });

    let resp_val: serde_json::Value = client
        .post(rpc_url)
        .json(&req)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    if let Some(error) = resp_val.get("error") {
        return Err(anyhow!("RPC error: {error}"));
    }

    let sequence = resp_val
        .get("result")
        .and_then(|r| r.get("sequence"))
        .and_then(|s| s.as_i64())
        .ok_or_else(|| anyhow!("Missing sequence in getLatestLedger result"))?;

    Ok(sequence)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backoff_logic_simulate() {
        let mut backoff = Duration::from_secs(1);
        let max_backoff = Duration::from_secs(60);

        backoff = std::cmp::min(backoff * 2, max_backoff);
        assert_eq!(backoff, Duration::from_secs(2));

        for _ in 0..10 {
            backoff = std::cmp::min(backoff * 2, max_backoff);
        }
        assert_eq!(backoff, max_backoff);
    }
}
