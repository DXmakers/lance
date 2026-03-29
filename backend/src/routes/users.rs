use axum::{routing::get, Router};

use crate::db::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(list_users))
}

/// GET /api/v1/users — stub; returns empty list until auth/profile system is built.
async fn list_users() -> axum::Json<Vec<serde_json::Value>> {
    axum::Json(vec![])
}
