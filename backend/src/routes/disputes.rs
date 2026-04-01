use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use uuid::Uuid;

use crate::{
    db::AppState,
    error::{AppError, Result},
    models::{Dispute, OpenDisputeRequest},
    routes::{appeals, evidence},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/:id", get(get_dispute))
        .route(
            "/:id/evidence",
            get(evidence::list_evidence).post(evidence::submit_evidence),
        )
        .route("/:id/verdict", get(crate::routes::verdicts::get_verdict))
        .route("/:id/appeal", post(appeals::create_appeal))
}

/// Open a dispute from within the job routes (/jobs/:id/dispute)
pub async fn open_dispute_for_job(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
    Json(req): Json<OpenDisputeRequest>,
) -> Result<Json<Dispute>> {
    // Verify job is in a disputable state
    let status: Option<String> = sqlx::query_scalar("SELECT status FROM jobs WHERE id = $1")
        .bind(job_id)
        .fetch_optional(&state.pool)
        .await?;

    match status.as_deref() {
        Some("funded") | Some("in_progress") | Some("deliverable_submitted") => {}
        Some(s) => {
            return Err(AppError::BadRequest(format!(
                "cannot dispute job in status '{s}'"
            )))
        }
        None => return Err(AppError::NotFound(format!("job {job_id} not found"))),
    }

    // Update job status
    sqlx::query("UPDATE jobs SET status = 'disputed' WHERE id = $1")
        .bind(job_id)
        .execute(&state.pool)
        .await?;

    // Call escrow contract open_dispute via services::stellar
    let _ = state.stellar.open_dispute(&job_id.to_string()).await;

    let dispute = sqlx::query_as::<_, Dispute>(
        r#"INSERT INTO disputes (job_id, opened_by, status)
           VALUES ($1, $2, 'open')
           RETURNING id, job_id, opened_by, status, created_at"#,
    )
    .bind(job_id)
    .bind(req.opened_by)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(dispute))
}

async fn get_dispute(
    State(state): State<AppState>,
    Path(dispute_id): Path<Uuid>,
) -> Result<Json<Dispute>> {
    let dispute = sqlx::query_as::<_, Dispute>(
        "SELECT id, job_id, opened_by, status, created_at FROM disputes WHERE id = $1",
    )
    .bind(dispute_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("dispute {dispute_id} not found")))?;
    Ok(Json(dispute))
}

pub async fn get_job_dispute(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
) -> Result<Json<Dispute>> {
    let dispute = sqlx::query_as::<_, Dispute>(
        r#"SELECT id, job_id, opened_by, status, created_at
           FROM disputes
           WHERE job_id = $1
           ORDER BY created_at DESC
           LIMIT 1"#,
    )
    .bind(job_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("job {job_id} has no dispute")))?;

    Ok(Json(dispute))
}
