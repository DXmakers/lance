use axum::{
    extract::{Path, State},
    Json,
};
use uuid::Uuid;

use crate::{
    db::AppState,
    error::{AppError, Result},
    models::Verdict,
};

pub async fn get_verdict(
    State(state): State<AppState>,
    Path(dispute_id): Path<Uuid>,
) -> Result<Json<Verdict>> {
    let verdict = sqlx::query_as::<_, Verdict>(
        r#"SELECT id, dispute_id, winner, freelancer_share_bps, reasoning, on_chain_tx, created_at
           FROM verdicts WHERE dispute_id = $1
           ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(dispute_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("no verdict yet for this dispute".into()))?;
    Ok(Json(verdict))
}
