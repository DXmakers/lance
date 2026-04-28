use crate::{models::{HealthResponse, SyncStatus}, AppState};
use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::get, Json, Router};
use std::sync::Arc;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .with_state(state)
}

async fn health(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let snapshot = state.snapshot.read().await.clone();
    let healthy = matches!(snapshot.status, SyncStatus::Synced | SyncStatus::CatchingUp | SyncStatus::Starting);

    let response = HealthResponse {
        status: snapshot.status,
        healthy,
        last_processed_ledger: snapshot.last_processed_ledger,
        latest_ledger: snapshot.latest_ledger,
        ledger_lag: snapshot.ledger_lag,
        last_success_at: snapshot.last_success_at,
        last_error: snapshot.last_error,
    };

    (StatusCode::OK, Json(response))
}

async fn metrics(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.metrics.render() {
        Ok(body) => (StatusCode::OK, body).into_response(),
        Err(error) => {
            tracing::error!(error = %error, "failed to render metrics");
            (StatusCode::INTERNAL_SERVER_ERROR, "failed to render metrics").into_response()
        }
    }
}