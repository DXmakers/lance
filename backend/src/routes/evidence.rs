use axum::{
    extract::{Path, State},
    Json,
};
use uuid::Uuid;

use crate::{
    db::AppState,
    error::Result,
    models::{Evidence, SubmitEvidenceRequest},
};

pub async fn list_evidence(
    State(state): State<AppState>,
    Path(dispute_id): Path<Uuid>,
) -> Result<Json<Vec<Evidence>>> {
    let evidence = sqlx::query_as::<_, Evidence>(
        r#"SELECT id, dispute_id, submitted_by, content, file_hash, created_at
           FROM evidence
           WHERE dispute_id = $1
           ORDER BY created_at ASC"#,
    )
    .bind(dispute_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(evidence))
}

pub async fn submit_evidence(
    State(state): State<AppState>,
    Path(dispute_id): Path<Uuid>,
    Json(req): Json<SubmitEvidenceRequest>,
) -> Result<Json<Evidence>> {
    let evidence = sqlx::query_as::<_, Evidence>(
        r#"INSERT INTO evidence (dispute_id, submitted_by, content, file_hash)
           VALUES ($1, $2, $3, $4)
           RETURNING id, dispute_id, submitted_by, content, file_hash, created_at"#
    )
    .bind(dispute_id)
    .bind(req.submitted_by)
    .bind(req.content)
    .bind(req.file_hash)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(evidence))
}
