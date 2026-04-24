use axum::Json;
use serde_json::json;
use uuid::Uuid;

use crate::{
    db::AppState,
    error::Result,
    models::{ActivityLog, CreateActivityLogRequest},
};

/// Log an activity for a job
pub async fn log_activity(
    state: &AppState,
    job_id: Uuid,
    actor: String,
    action: String,
    action_type: Option<String>,
    metadata: Option<serde_json::Value>,
) -> Result<ActivityLog> {
    let action_type = action_type.unwrap_or_else(|| "info".to_string());
    let metadata = metadata.unwrap_or(json!({}));

    let activity = sqlx::query_as::<_, ActivityLog>(
        r#"INSERT INTO activity_logs (job_id, actor, action, action_type, metadata)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, job_id, actor, action, action_type, metadata, created_at"#,
    )
    .bind(job_id)
    .bind(actor)
    .bind(action)
    .bind(action_type)
    .bind(metadata)
    .fetch_one(&state.pool)
    .await?;

    Ok(activity)
}

/// Get activity logs for a job
pub async fn get_activity_logs(
    state: &AppState,
    job_id: Uuid,
    limit: Option<i64>,
) -> Result<Vec<ActivityLog>> {
    let limit = limit.unwrap_or(50);

    let logs = sqlx::query_as::<_, ActivityLog>(
        r#"SELECT id, job_id, actor, action, action_type, metadata, created_at
           FROM activity_logs
           WHERE job_id = $1
           ORDER BY created_at DESC
           LIMIT $2"#,
    )
    .bind(job_id)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    Ok(logs)
}

/// Get recent activity logs across all jobs for an address
pub async fn get_user_activity(
    state: &AppState,
    address: String,
    limit: Option<i64>,
) -> Result<Vec<ActivityLog>> {
    let limit = limit.unwrap_or(50);

    let logs = sqlx::query_as::<_, ActivityLog>(
        r#"SELECT id, job_id, actor, action, action_type, metadata, created_at
           FROM activity_logs
           WHERE actor = $1 OR 
                 job_id IN (SELECT id FROM jobs WHERE client_address = $1 OR freelancer_address = $1)
           ORDER BY created_at DESC
           LIMIT $2"#,
    )
    .bind(&address)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    Ok(logs)
}
