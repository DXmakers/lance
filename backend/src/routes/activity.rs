use crate::{
    db::AppState,
    error::Result,
    models::{ActivityLog, CreateActivityLogRequest},
};
use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use sqlx::QueryBuilder;

pub fn router() -> Router<AppState> {
    Router::new().route("/logs", get(list_logs).post(create_log))
}

#[derive(Deserialize)]
struct ListQuery {
    job_id: Option<uuid::Uuid>,
    user_address: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

async fn list_logs(
    Query(q): Query<ListQuery>,
    State(state): State<AppState>,
) -> Result<Json<Vec<ActivityLog>>> {
    let limit = q.limit.unwrap_or(50);
    let offset = q.offset.unwrap_or(0);

    let mut query_builder: QueryBuilder<sqlx::Postgres> =
        QueryBuilder::new("SELECT * FROM activity_logs");

    let mut has_where = false;
    if let Some(job_id) = q.job_id {
        query_builder.push(" WHERE job_id = ");
        query_builder.push_bind(job_id);
        has_where = true;
    }

    if let Some(addr) = q.user_address {
        if has_where {
            query_builder.push(" AND user_address = ");
        } else {
            query_builder.push(" WHERE user_address = ");
        }
        query_builder.push_bind(addr);
    }

    query_builder.push(" ORDER BY created_at DESC LIMIT ");
    query_builder.push_bind(limit);
    query_builder.push(" OFFSET ");
    query_builder.push_bind(offset);

    let query = query_builder.build_query_as::<ActivityLog>();
    let rows = query.fetch_all(&state.pool).await?;

    Ok(Json(rows))
}

async fn create_log(
    State(state): State<AppState>,
    Json(req): Json<CreateActivityLogRequest>,
) -> Result<Json<ActivityLog>> {
    let level = req.level.unwrap_or_else(|| "info".to_string());
    let details = req.details.unwrap_or_else(|| serde_json::json!({}));

    let rec = sqlx::query_as::<_, ActivityLog>(
        "INSERT INTO activity_logs (user_address, job_id, event_type, level, details) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    )
    .bind(req.user_address)
    .bind(req.job_id)
    .bind(req.event_type)
    .bind(level)
    .bind(details)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(rec))
}
