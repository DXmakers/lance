use axum::{extract::State, http::StatusCode, Json};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::telemetry::metrics;
use chrono::{DateTime, Utc};
use sqlx::Row;
use std::sync::atomic::Ordering;

const DEFAULT_SOROBAN_RPC_URL: &str = "https://soroban-testnet.stellar.org";
const DEFAULT_MAX_LEDGER_LAG: i64 = 5;

fn soroban_rpc_url() -> String {
    std::env::var("SOROBAN_RPC_URL")
        .or_else(|_| std::env::var("STELLAR_RPC_URL"))
        .unwrap_or_else(|_| DEFAULT_SOROBAN_RPC_URL.to_string())
}

fn max_ledger_lag() -> i64 {
    std::env::var("INDEXER_MAX_LEDGER_LAG")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(DEFAULT_MAX_LEDGER_LAG)
}

pub async fn liveness() -> (StatusCode, Json<Value>) {
    (
        StatusCode::OK,
        Json(json!({
            "status": "alive"
        })),
    )
}

pub async fn readiness(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({
                "status": "ready",
                "db": "connected"
            })),
        ),
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "status": "not_ready",
                "db": e.to_string()
            })),
        ),
    }
}

pub async fn health(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => {
            let (code, Json(sync_status_payload)) = sync_status(State(state.clone())).await;
            (
                code,
                Json(json!({
                    "status": sync_status_payload["status"].clone(),
                    "db": "connected",
                    "indexer_sync_status": sync_status_payload
                })),
            )
        }
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "status": "degraded", "db": e.to_string() })),
        ),
    }
}

pub async fn sync_status(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    let row = match sqlx::query(
        "SELECT last_processed_ledger, updated_at FROM indexer_state WHERE id = 1",
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "status": "degraded",
                    "reason": "indexer_state row missing"
                })),
            )
        }
        Err(e) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "status": "degraded",
                    "reason": "db_query_failed",
                    "error": e.to_string()
                })),
            )
        }
    };

    let db_last_processed: i64 = row.get("last_processed_ledger");
    let updated_at: DateTime<Utc> = row.get("updated_at");
    let metric_last_processed = metrics().last_processed_ledger.load(Ordering::Relaxed);
    let metric_latest_network = metrics().last_network_ledger.load(Ordering::Relaxed);
    let errors = metrics().total_errors.load(Ordering::Relaxed);
    let total_events = metrics().total_events_processed.load(Ordering::Relaxed);
    let rpc_retries = metrics().total_rpc_retries.load(Ordering::Relaxed);
    let last_duration = metrics().last_loop_duration_ms.load(Ordering::Relaxed);
    let last_rpc_latency = metrics().last_rpc_latency_ms.load(Ordering::Relaxed);
    let last_batch_events = metrics()
        .last_batch_events_processed
        .load(Ordering::Relaxed);
    let last_batch_rate = metrics().last_batch_rate_per_second.load(Ordering::Relaxed);

    let source_last_processed = if metric_last_processed > 0 {
        std::cmp::max(metric_last_processed, db_last_processed)
    } else {
        db_last_processed
    };

    let rpc_url = soroban_rpc_url();
    let latest_network = if metric_latest_network > 0 {
        Ok(metric_latest_network)
    } else {
        fetch_latest_network_ledger(&rpc_url).await
    };
    let lag = latest_network
        .as_ref()
        .ok()
        .map(|latest| std::cmp::max(*latest - source_last_processed, 0));

    let max_lag = max_ledger_lag();
    let in_sync = lag.map(|value| value <= max_lag).unwrap_or(false);
    let status = if in_sync { "ok" } else { "lagging" };
    let code = if in_sync {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    let mut payload = json!({
        "status": status,
        "in_sync": in_sync,
        "max_allowed_lag": max_lag,
        "last_processed_ledger": source_last_processed,
        "last_updated_at": updated_at.to_rfc3339(),
        "error_count": errors,
        "total_events_processed": total_events,
        "last_batch_events_processed": last_batch_events,
        "last_batch_rate_per_second": last_batch_rate,
        "last_loop_duration_ms": last_duration,
        "last_rpc_latency_ms": last_rpc_latency,
        "rpc_retry_count": rpc_retries,
        "rpc": {
            "url": rpc_url
        }
    });

    match latest_network {
        Ok(latest) => {
            payload["latest_network_ledger"] = json!(latest);
            payload["ledger_lag"] = json!(std::cmp::max(latest - source_last_processed, 0));
            payload["rpc"]["reachable"] = json!(true);
        }
        Err(e) => {
            payload["latest_network_ledger"] = Value::Null;
            payload["ledger_lag"] = Value::Null;
            payload["rpc"]["reachable"] = json!(false);
            payload["rpc"]["error"] = json!(e);
        }
    }

    (code, Json(payload))
}

async fn fetch_latest_network_ledger(rpc_url: &str) -> Result<i64, String> {
    let client = reqwest::Client::new();
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getLatestLedger",
        "params": {}
    });

    let response = client
        .post(rpc_url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let response = response.error_for_status().map_err(|e| e.to_string())?;
    let payload: Value = response.json().await.map_err(|e| e.to_string())?;

    if let Some(err) = payload.get("error") {
        return Err(err.to_string());
    }

    payload
        .get("result")
        .and_then(|r| r.get("sequence"))
        .and_then(|s| s.as_i64())
        .ok_or_else(|| "missing sequence in getLatestLedger response".to_string())
}

pub async fn prometheus_metrics() -> String {
    metrics().to_prometheus_text()
}

pub async fn sync_health(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    let row = match sqlx::query(
        "SELECT last_processed_ledger, updated_at FROM indexer_state WHERE id = 1",
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "status": "degraded",
                    "current_ledger": null,
                    "processed_ledger": null,
                    "lag": null,
                    "reason": "indexer_state row missing"
                })),
            )
        }
        Err(e) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "status": "degraded",
                    "current_ledger": null,
                    "processed_ledger": null,
                    "lag": null,
                    "error": e.to_string()
                })),
            )
        }
    };

    let db_last_processed: i64 = row.get("last_processed_ledger");
    let metric_last_processed = metrics().last_processed_ledger.load(Ordering::Relaxed);
    let metric_latest_network = metrics().last_network_ledger.load(Ordering::Relaxed);

    let processed_ledger = if metric_last_processed > 0 {
        std::cmp::max(metric_last_processed, db_last_processed)
    } else {
        db_last_processed
    };

    let rpc_url = soroban_rpc_url();
    let current_ledger = if metric_latest_network > 0 {
        metric_latest_network
    } else {
        match fetch_latest_network_ledger(&rpc_url).await {
            Ok(ledger) => ledger,
            Err(_) => {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(json!({
                        "status": "degraded",
                        "current_ledger": null,
                        "processed_ledger": processed_ledger,
                        "lag": null,
                        "reason": "unable to fetch current ledger from RPC"
                    })),
                )
            }
        }
    };

    let lag = std::cmp::max(current_ledger - processed_ledger, 0);
    let max_lag = max_ledger_lag();
    let in_sync = lag <= max_lag;
    let status = if in_sync { "ok" } else { "lagging" };
    let code = if in_sync {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        code,
        Json(json!({
            "status": status,
            "current_ledger": current_ledger,
            "processed_ledger": processed_ledger,
            "lag": lag,
            "max_allowed_lag": max_lag,
            "in_sync": in_sync
        })),
    )
}
