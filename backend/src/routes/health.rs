use axum::{extract::State, http::StatusCode, Json};
use serde_json::{json, Value};
use tracing::{debug, instrument};

use crate::db::AppState;
use crate::indexer::metrics;
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

#[instrument]
pub async fn liveness() -> (StatusCode, Json<Value>) {
    debug!("liveness check requested");
    (
        StatusCode::OK,
        Json(json!({
            "status": "alive",
            "timestamp": Utc::now().to_rfc3339()
        })),
    )
}

#[instrument(skip(state))]
pub async fn readiness(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    debug!("readiness check requested");
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => {
            debug!("database connection successful");
            (
                StatusCode::OK,
                Json(json!({
                    "status": "ready",
                    "db": "connected",
                    "timestamp": Utc::now().to_rfc3339()
                })),
            )
        }
        Err(e) => {
            tracing::error!(error = %e, "database connection failed");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "status": "not_ready",
                    "db": e.to_string(),
                    "timestamp": Utc::now().to_rfc3339()
                })),
            )
        }
    }
}

#[instrument(skip(state))]
pub async fn health(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    debug!("comprehensive health check requested");
    
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => {
            let (code, Json(sync_status_payload)) = sync_status(State(state.clone())).await;
            let (_, Json(indexer_health_payload)) = indexer_health(State(state.clone())).await;
            
            let overall_status = if code == StatusCode::OK {
                "healthy"
            } else {
                "degraded"
            };
            
            debug!(
                status = overall_status,
                sync_status = ?sync_status_payload["status"],
                indexer_status = ?indexer_health_payload["status"],
                "health check completed"
            );
            
            (
                code,
                Json(json!({
                    "status": overall_status,
                    "db": "connected",
                    "timestamp": Utc::now().to_rfc3339(),
                    "indexer_sync_status": sync_status_payload,
                    "indexer_health": indexer_health_payload
                })),
            )
        }
        Err(e) => {
            tracing::error!(error = %e, "health check failed: database unavailable");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ 
                    "status": "degraded", 
                    "db": e.to_string(),
                    "timestamp": Utc::now().to_rfc3339()
                })),
            )
        }
    }
}

#[instrument(skip(state))]
pub async fn sync_status(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    debug!("sync status check requested");
    
    let row = match sqlx::query(
        "SELECT last_processed_ledger, updated_at FROM indexer_state WHERE id = 1",
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            tracing::warn!("indexer_state row missing");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "status": "degraded",
                    "reason": "indexer_state row missing",
                    "timestamp": Utc::now().to_rfc3339()
                })),
            )
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to query indexer_state");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "status": "degraded",
                    "reason": "db_query_failed",
                    "error": e.to_string(),
                    "timestamp": Utc::now().to_rfc3339()
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
    
    // Calculate time since last update
    let seconds_since_update = (Utc::now() - updated_at).num_seconds();
    let is_stale = seconds_since_update > 300; // 5 minutes

    debug!(
        status,
        last_processed_ledger = source_last_processed,
        latest_network_ledger = ?latest_network,
        lag = ?lag,
        in_sync,
        is_stale,
        seconds_since_update,
        "sync status check completed"
    );

    let mut payload = json!({
        "status": status,
        "in_sync": in_sync,
        "is_stale": is_stale,
        "max_allowed_lag": max_lag,
        "last_processed_ledger": source_last_processed,
        "last_updated_at": updated_at.to_rfc3339(),
        "seconds_since_update": seconds_since_update,
        "error_count": errors,
        "total_events_processed": total_events,
        "last_batch_events_processed": last_batch_events,
        "last_batch_rate_per_second": last_batch_rate,
        "last_loop_duration_ms": last_duration,
        "last_rpc_latency_ms": last_rpc_latency,
        "rpc_retry_count": rpc_retries,
        "timestamp": Utc::now().to_rfc3339(),
        "rpc": {
            "url": rpc_url
        }
    });

    match latest_network {
        Ok(latest) => {
            let current_lag = std::cmp::max(latest - source_last_processed, 0);
            payload["latest_network_ledger"] = json!(latest);
            payload["ledger_lag"] = json!(current_lag);
            payload["ledger_lag_percentage"] = if latest > 0 {
                json!((current_lag as f64 / latest as f64) * 100.0)
            } else {
                json!(0.0)
            };
            payload["rpc"]["reachable"] = json!(true);
            
            debug!(
                latest_network_ledger = latest,
                ledger_lag = current_lag,
                "network ledger fetched successfully"
            );
        }
        Err(e) => {
            tracing::warn!(error = %e, "failed to fetch latest network ledger");
            payload["latest_network_ledger"] = Value::Null;
            payload["ledger_lag"] = Value::Null;
            payload["ledger_lag_percentage"] = Value::Null;
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

#[instrument(skip(state))]
pub async fn indexer_health(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    debug!("indexer health check requested");
    
    #[derive(sqlx::FromRow)]
    struct IndexerHealthRow {
        last_processed_ledger: i64,
        last_successful_cycle_at: Option<DateTime<Utc>>,
        last_error_at: Option<DateTime<Utc>>,
        last_error_message: Option<String>,
        total_cycles_completed: i64,
        total_events_processed: i64,
        worker_version: String,
        updated_at: DateTime<Utc>,
        seconds_since_last_success: Option<f64>,
        health_status: String,
        total_indexed_events: i64,
        failed_ledgers_count: i64,
    }

    let health_row = match sqlx::query_as::<_, IndexerHealthRow>(
        "SELECT * FROM indexer_health"
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            tracing::warn!("indexer_health view returned no data");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "status": "unknown",
                    "reason": "indexer_health view returned no data",
                    "timestamp": Utc::now().to_rfc3339()
                })),
            )
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to query indexer_health view");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "status": "error",
                    "reason": "failed to query indexer_health",
                    "error": e.to_string(),
                    "timestamp": Utc::now().to_rfc3339()
                })),
            )
        }
    };

    let status_code = match health_row.health_status.as_str() {
        "healthy" => StatusCode::OK,
        _ => StatusCode::SERVICE_UNAVAILABLE,
    };

    debug!(
        health_status = %health_row.health_status,
        last_processed_ledger = health_row.last_processed_ledger,
        total_cycles_completed = health_row.total_cycles_completed,
        total_events_processed = health_row.total_events_processed,
        seconds_since_last_success = ?health_row.seconds_since_last_success,
        failed_ledgers_count = health_row.failed_ledgers_count,
        worker_version = %health_row.worker_version,
        "indexer health check completed"
    );

    (
        status_code,
        Json(json!({
            "status": health_row.health_status,
            "last_processed_ledger": health_row.last_processed_ledger,
            "last_successful_cycle_at": health_row.last_successful_cycle_at.map(|dt| dt.to_rfc3339()),
            "last_error_at": health_row.last_error_at.map(|dt| dt.to_rfc3339()),
            "last_error_message": health_row.last_error_message,
            "total_cycles_completed": health_row.total_cycles_completed,
            "total_events_processed": health_row.total_events_processed,
            "worker_version": health_row.worker_version,
            "updated_at": health_row.updated_at.to_rfc3339(),
            "seconds_since_last_success": health_row.seconds_since_last_success,
            "total_indexed_events": health_row.total_indexed_events,
            "failed_ledgers_count": health_row.failed_ledgers_count,
            "timestamp": Utc::now().to_rfc3339()
        })),
    )
}

pub async fn prometheus_metrics() -> String {
    let m = metrics();
    
    // Ledger metrics
    let last_ledger = m.last_processed_ledger.load(Ordering::Relaxed);
    let latest_network_ledger = m.last_network_ledger.load(Ordering::Relaxed);
    let ledger_lag = std::cmp::max(latest_network_ledger - last_ledger, 0);
    
    // Event processing metrics
    let events = m.total_events_processed.load(Ordering::Relaxed);
    let batch_events = m.last_batch_events_processed.load(Ordering::Relaxed);
    let batch_rate = m.last_batch_rate_per_second.load(Ordering::Relaxed);
    
    // Error metrics
    let errors = m.total_errors.load(Ordering::Relaxed);
    let rpc_errors = m.rpc_errors.load(Ordering::Relaxed);
    let db_errors = m.database_errors.load(Ordering::Relaxed);
    let processing_errors = m.processing_errors.load(Ordering::Relaxed);
    let rpc_retries = m.total_rpc_retries.load(Ordering::Relaxed);
    
    // Latency metrics
    let latency = m.last_loop_duration_ms.load(Ordering::Relaxed);
    let rpc_latency = m.last_rpc_latency_ms.load(Ordering::Relaxed);
    let db_latency = m.last_db_commit_latency_ms.load(Ordering::Relaxed);
    let event_latency = m.last_event_processing_latency_ms.load(Ordering::Relaxed);
    let avg_latency = m.avg_loop_duration_ms.load(Ordering::Relaxed);
    let max_latency = m.max_loop_duration_ms.load(Ordering::Relaxed);
    
    // Cycle metrics
    let cycles_completed = m.cycles_completed.load(Ordering::Relaxed);
    let cycles_failed = m.cycles_failed.load(Ordering::Relaxed);
    let total_processing_time = m.total_processing_time_ms.load(Ordering::Relaxed);
    
    // Recovery metrics
    let recovery_attempts = m.recovery_attempts.load(Ordering::Relaxed);
    let successful_recoveries = m.successful_recoveries.load(Ordering::Relaxed);
    let checkpoint_updates = m.checkpoint_updates.load(Ordering::Relaxed);
    
    // Calculate success rate
    let total_cycles = cycles_completed + cycles_failed;
    let success_rate = if total_cycles > 0 {
        (cycles_completed as f64 / total_cycles as f64) * 100.0
    } else {
        100.0
    };
    
    // Calculate recovery rate
    let recovery_rate = if recovery_attempts > 0 {
        (successful_recoveries as f64 / recovery_attempts as f64) * 100.0
    } else {
        100.0
    };

    format!(
        "# HELP indexer_last_processed_ledger The last ledger successfully indexed\n\
         # TYPE indexer_last_processed_ledger gauge\n\
         indexer_last_processed_ledger {last_ledger}\n\
         # HELP indexer_latest_network_ledger The latest Stellar network ledger seen by the worker\n\
         # TYPE indexer_latest_network_ledger gauge\n\
         indexer_latest_network_ledger {latest_network_ledger}\n\
         # HELP indexer_ledger_lag The number of ledgers the worker is behind the network head\n\
         # TYPE indexer_ledger_lag gauge\n\
         indexer_ledger_lag {ledger_lag}\n\
         # HELP indexer_total_events_processed Total number of Soroban events processed\n\
         # TYPE indexer_total_events_processed counter\n\
         indexer_total_events_processed {events}\n\
         # HELP indexer_last_batch_events_processed Number of events processed during the last indexer cycle\n\
         # TYPE indexer_last_batch_events_processed gauge\n\
         indexer_last_batch_events_processed {batch_events}\n\
         # HELP indexer_last_batch_rate_per_second Approximate event throughput from the last cycle\n\
         # TYPE indexer_last_batch_rate_per_second gauge\n\
         indexer_last_batch_rate_per_second {batch_rate}\n\
         # HELP indexer_total_errors Total number of indexer errors\n\
         # TYPE indexer_total_errors counter\n\
         indexer_total_errors {errors}\n\
         # HELP indexer_rpc_errors Total number of RPC errors\n\
         # TYPE indexer_rpc_errors counter\n\
         indexer_rpc_errors {rpc_errors}\n\
         # HELP indexer_database_errors Total number of database errors\n\
         # TYPE indexer_database_errors counter\n\
         indexer_database_errors {db_errors}\n\
         # HELP indexer_processing_errors Total number of processing errors\n\
         # TYPE indexer_processing_errors counter\n\
         indexer_processing_errors {processing_errors}\n\
         # HELP indexer_rpc_retries_total Total RPC retries triggered by transient failures or rate limits\n\
         # TYPE indexer_rpc_retries_total counter\n\
         indexer_rpc_retries_total {rpc_retries}\n\
         # HELP indexer_last_loop_duration_ms Time taken for the last indexer loop in milliseconds\n\
         # TYPE indexer_last_loop_duration_ms gauge\n\
         indexer_last_loop_duration_ms {latency}\n\
         # HELP indexer_avg_loop_duration_ms Average time taken for indexer loops in milliseconds\n\
         # TYPE indexer_avg_loop_duration_ms gauge\n\
         indexer_avg_loop_duration_ms {avg_latency}\n\
         # HELP indexer_max_loop_duration_ms Maximum time taken for any indexer loop in milliseconds\n\
         # TYPE indexer_max_loop_duration_ms gauge\n\
         indexer_max_loop_duration_ms {max_latency}\n\
         # HELP indexer_last_rpc_latency_ms Latency of the last RPC request in milliseconds\n\
         # TYPE indexer_last_rpc_latency_ms gauge\n\
         indexer_last_rpc_latency_ms {rpc_latency}\n\
         # HELP indexer_last_db_commit_latency_ms Latency of the last database commit in milliseconds\n\
         # TYPE indexer_last_db_commit_latency_ms gauge\n\
         indexer_last_db_commit_latency_ms {db_latency}\n\
         # HELP indexer_last_event_processing_latency_ms Latency of the last event processing in milliseconds\n\
         # TYPE indexer_last_event_processing_latency_ms gauge\n\
         indexer_last_event_processing_latency_ms {event_latency}\n\
         # HELP indexer_cycles_completed_total Total number of successfully completed indexer cycles\n\
         # TYPE indexer_cycles_completed_total counter\n\
         indexer_cycles_completed_total {cycles_completed}\n\
         # HELP indexer_cycles_failed_total Total number of failed indexer cycles\n\
         # TYPE indexer_cycles_failed_total counter\n\
         indexer_cycles_failed_total {cycles_failed}\n\
         # HELP indexer_success_rate_percent Percentage of successful indexer cycles\n\
         # TYPE indexer_success_rate_percent gauge\n\
         indexer_success_rate_percent {success_rate}\n\
         # HELP indexer_total_processing_time_ms Total time spent processing in milliseconds\n\
         # TYPE indexer_total_processing_time_ms counter\n\
         indexer_total_processing_time_ms {total_processing_time}\n\
         # HELP indexer_recovery_attempts_total Total number of recovery attempts after failures\n\
         # TYPE indexer_recovery_attempts_total counter\n\
         indexer_recovery_attempts_total {recovery_attempts}\n\
         # HELP indexer_successful_recoveries_total Total number of successful recoveries\n\
         # TYPE indexer_successful_recoveries_total counter\n\
         indexer_successful_recoveries_total {successful_recoveries}\n\
         # HELP indexer_recovery_rate_percent Percentage of successful recoveries\n\
         # TYPE indexer_recovery_rate_percent gauge\n\
         indexer_recovery_rate_percent {recovery_rate}\n\
         # HELP indexer_checkpoint_updates_total Total number of checkpoint updates\n\
         # TYPE indexer_checkpoint_updates_total counter\n\
         indexer_checkpoint_updates_total {checkpoint_updates}\n"
    )
}
