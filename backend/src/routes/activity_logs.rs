use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{db::AppState, error::Result, models::ActivityLog, services::activity_log};

#[derive(Debug, Deserialize)]
pub struct GetLogsQuery {
    pub limit: Option<i64>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/:job_id/activity", get(get_job_activity))
        .route("/user/:address/activity", get(get_user_activity))
}

async fn get_job_activity(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
    Query(params): Query<GetLogsQuery>,
) -> Result<Json<Vec<ActivityLog>>> {
    let logs = activity_log::get_activity_logs(&state, job_id, params.limit).await?;
    Ok(Json(logs))
}

async fn get_user_activity(
    State(state): State<AppState>,
    Path(address): Path<String>,
    Query(params): Query<GetLogsQuery>,
) -> Result<Json<Vec<ActivityLog>>> {
    let logs = activity_log::get_user_activity(&state, address, params.limit).await?;
    Ok(Json(logs))
}
