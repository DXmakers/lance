pub mod activity;
pub mod admin;
pub mod appeals;
pub mod auth;
pub mod bids;
pub mod deliverables;
pub mod disputes;
pub mod evidence;
pub mod health;
pub mod jobs;
pub mod milestones;
pub mod uploads;
pub mod users;
pub mod verdicts;

use crate::AppState;
use axum::{routing::get, Router};

pub fn api_router(_state: AppState) -> Router<AppState> {
    Router::new()
        .route("/health", get(health::health))
        .route("/health/sync", get(health::sync_status))
        .route("/indexer/rescan", get(health::indexer::rescan))
        .nest(
            "/v1",
            Router::new()
                .nest("/jobs", jobs::router())
                .nest("/activity", activity::router())
                .nest("/disputes", disputes::router())
                .nest("/appeals", appeals::router())
                .nest("/users", users::router())
                .nest("/auth", auth::router())
                .nest("/uploads", uploads::router())
                .nest("/admin", admin::router()),
        )
}
