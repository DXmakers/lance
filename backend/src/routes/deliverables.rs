use axum::{
    extract::{Path, State},
    Json,
};
use uuid::Uuid;

use crate::{
    db::AppState,
    error::{AppError, Result},
    models::{Deliverable, SubmitDeliverableRequest},
};

pub async fn list_deliverables(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
) -> Result<Json<Vec<Deliverable>>> {
    let deliverables = sqlx::query_as::<_, Deliverable>(
        r#"SELECT id, job_id, milestone_index, submitted_by, label, kind, url, file_hash, created_at
           FROM deliverables
           WHERE job_id = $1
           ORDER BY milestone_index ASC, created_at DESC"#,
    )
    .bind(job_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(deliverables))
}

pub async fn submit_deliverable(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
    Json(req): Json<SubmitDeliverableRequest>,
) -> Result<Json<Deliverable>> {
    let (status, freelancer_address): (String, Option<String>) = sqlx::query_as(
        r#"SELECT status, freelancer_address
           FROM jobs
           WHERE id = $1"#,
    )
    .bind(job_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("job {job_id} not found")))?;

    if !matches!(status.as_str(), "funded" | "in_progress") {
        return Err(AppError::BadRequest(format!(
            "deliverables can only be submitted for funded jobs, not '{status}'"
        )));
    }

    if freelancer_address.as_deref() != Some(req.submitted_by.as_str()) {
        return Err(AppError::BadRequest(
            "only the assigned freelancer can submit deliverables".into(),
        ));
    }

    let milestone_index: i32 = sqlx::query_scalar(
        r#"SELECT index
           FROM milestones
           WHERE job_id = $1 AND status = 'pending'
           ORDER BY index ASC
           LIMIT 1"#,
    )
    .bind(job_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::BadRequest("all milestones have already been delivered".into()))?;

    let deliverable = sqlx::query_as::<_, Deliverable>(
        r#"INSERT INTO deliverables (job_id, milestone_index, submitted_by, label, kind, url, file_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, job_id, milestone_index, submitted_by, label, kind, url, file_hash, created_at"#,
    )
    .bind(job_id)
    .bind(milestone_index)
    .bind(req.submitted_by)
    .bind(req.label)
    .bind(req.kind)
    .bind(req.url)
    .bind(req.file_hash)
    .fetch_one(&state.pool)
    .await?;

    sqlx::query("UPDATE jobs SET status = 'deliverable_submitted' WHERE id = $1")
        .bind(job_id)
        .execute(&state.pool)
        .await?;

    Ok(Json(deliverable))
}
