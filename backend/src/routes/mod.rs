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

use crate::db::AppState;
use axum::{routing::get, Router};

pub fn api_router(state: AppState) -> Router<AppState> {
    Router::new()
        // health checks — outside versioned prefix so load balancers can reach them
        .route("/health/live", get(health::liveness))
        .route("/health/ready", get(health::readiness))
        .route("/health", get(health::health))
        .route("/sync-status", get(health::sync_status))
        .route("/metrics", get(health::prometheus_metrics))
        // v1 API routes
        .nest(
            "/v1",
            Router::new()
                .nest("/jobs", jobs::router())
                .nest("/activity", activity::router())
                .nest("/disputes", disputes::router())
                .nest("/appeals", appeals::router())
                .nest("/users", users::router(state))
                .nest("/auth", auth::router())
                .nest("/uploads", uploads::router())
                .nest("/admin", admin::router()),
        )
}
