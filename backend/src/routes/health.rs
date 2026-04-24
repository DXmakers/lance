use axum::{extract::State, http::StatusCode, Json};
use serde_json::{json, Value};

use crate::db::AppState;

pub async fn health(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    let mut db_status = "disconnected".to_string();
    let mut cache_status = "not configured".to_string();
    let mut overall_status = "ok";

    // Check database connection
    let db_healthy = match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => {
            db_status = "connected".to_string();
            true
        }
        Err(e) => {
            db_status = e.to_string();
            overall_status = "degraded";
            false
        }
    };

    // Check Redis cache connection (if configured)
    if let Some(ref cache) = state.cache {
        match cache.ping().await {
            Ok(pong) => {
                cache_status = pong;
            }
            Err(e) => {
                cache_status = format!("error: {}", e);
                overall_status = "degraded";
            }
        }
    }

    // If database is down, mark as service unavailable
    let status_code = if db_healthy {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        status_code,
        Json(json!({
            "status": overall_status,
            "db": db_status,
            "cache": cache_status
        })),
    )
}
