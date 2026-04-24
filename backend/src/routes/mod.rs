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

pub fn api_router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health::health))
        .nest(
            "/v1",
            Router::new()
                .nest("/auth", auth::router())
                .nest("/jobs", jobs::router())
                .nest("/disputes", disputes::router())
                .nest("/appeals", appeals::router())
                .nest("/users", users::router())
                .nest("/uploads", uploads::router()),
        )
}
