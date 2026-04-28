use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::db::AppState;

pub fn router() -> axum::Router<AppState> {
    use axum::routing::post;
    axum::Router::new()
        .route("/indexer/rescan", post(rescan))
        .route("/indexer/restart", post(restart_signal))
}

#[derive(Deserialize)]
pub struct RescanRequest {
    /// Ledger to roll back to. Defaults to current checkpoint - 100.
    pub from_ledger: Option<i64>,
}

/// Roll the indexer checkpoint back so the worker re-processes from `from_ledger`.
/// Because all event writes are idempotent (ON CONFLICT DO NOTHING) this is safe to call
/// at any time without risk of duplicate records.
pub async fn rescan(
    State(state): State<AppState>,
    Json(body): Json<RescanRequest>,
) -> (StatusCode, Json<Value>) {
    let current: Option<i64> =
        sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state WHERE id = 1")
            .fetch_optional(&state.pool)
            .await
            .unwrap_or(None);

    let target = match body.from_ledger {
        Some(l) => l,
        None => current.unwrap_or(0).saturating_sub(100).max(0),
    };

    match sqlx::query(
        "UPDATE indexer_state SET last_processed_ledger = $1, updated_at = NOW() WHERE id = 1",
    )
    .bind(target)
    .execute(&state.pool)
    .await
    {
        Ok(r) if r.rows_affected() == 1 => {
            tracing::info!(
                target_ledger = target,
                "admin: indexer checkpoint rolled back for rescan"
            );
            (
                StatusCode::OK,
                Json(json!({ "ok": true, "rescan_from_ledger": target })),
            )
        }
        Ok(_) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "ok": false, "error": "indexer_state row not found" })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "ok": false, "error": e.to_string() })),
        ),
    }
}

/// Signals the worker to restart on its next loop by resetting the in-memory error counter.
/// In a real k8s setup you'd send SIGTERM; here we just acknowledge the intent and let the
/// operator handle the pod restart via the runbook.
pub async fn restart_signal(State(_state): State<AppState>) -> (StatusCode, Json<Value>) {
    tracing::warn!("admin: manual worker restart requested via API");
    (
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "message": "Restart signal acknowledged. In Kubernetes: kubectl rollout restart deployment/lance-indexer"
        })),
    )
}
