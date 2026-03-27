pub mod appeals;
pub mod bids;
pub mod disputes;
pub mod evidence;
pub mod jobs;
pub mod milestones;
pub mod verdicts;
pub mod ipfs;

use axum::Router;
use crate::db::AppState;

pub fn api_router() -> Router<AppState> {
    Router::new()
        .nest("/jobs", jobs::router())
        .nest("/disputes", disputes::router())
        .nest("/appeals", appeals::router())
        .nest("/ipfs", ipfs::router())
}
