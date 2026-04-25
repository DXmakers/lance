use axum::{extract::State, http::StatusCode, Json};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::indexer::metrics;
use std::sync::atomic::Ordering;

pub async fn health(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => {
            let last_ledger = metrics().last_processed_ledger.load(Ordering::Relaxed);
            let errors = metrics().total_errors.load(Ordering::Relaxed);
            (
                StatusCode::OK,
                Json(json!({
                    "status": "ok",
                    "db": "connected",
                    "indexer_sync_status": {
                        "last_processed_ledger": last_ledger,
                        "error_count": errors
                    }
                })),
            )
        }
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "status": "degraded", "db": e.to_string() })),
        ),
    }
}

pub async fn prometheus_metrics() -> String {
    let last_ledger = metrics().last_processed_ledger.load(Ordering::Relaxed);
    let events = metrics().total_events_processed.load(Ordering::Relaxed);
    let errors = metrics().total_errors.load(Ordering::Relaxed);

    format!(
        "# HELP indexer_last_processed_ledger The last ledger successfully indexed\n\
         # TYPE indexer_last_processed_ledger gauge\n\
         indexer_last_processed_ledger {last_ledger}\n\
         # HELP indexer_total_events_processed Total number of Soroban events processed\n\
         # TYPE indexer_total_events_processed counter\n\
         indexer_total_events_processed {events}\n\
         # HELP indexer_total_errors Total number of indexer errors\n\
         # TYPE indexer_total_errors counter\n\
         indexer_total_errors {errors}\n"
    )
}
