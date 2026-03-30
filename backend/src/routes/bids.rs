use axum::{
    extract::{Path, State},
    Json,
};
use uuid::Uuid;

use crate::{
    db::AppState,
    error::{AppError, Result},
    models::{AcceptBidRequest, Bid, CreateBidRequest, Job},
};

pub async fn list_bids(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
) -> Result<Json<Vec<Bid>>> {
    let bids = sqlx::query_as::<_, Bid>(
        r#"SELECT id, job_id, freelancer_address, proposal, proposal_hash, status, created_at
           FROM bids WHERE job_id = $1 ORDER BY created_at ASC"#
    )
    .bind(job_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(bids))
}

pub async fn create_bid(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
    Json(req): Json<CreateBidRequest>,
) -> Result<Json<Bid>> {
    // ensure job is open
    let job_status: Option<String> = sqlx::query_scalar("SELECT status FROM jobs WHERE id = $1")
        .bind(job_id)
    .fetch_optional(&state.pool)
    .await?;

    match job_status.as_deref() {
        Some("open") => {}
        Some(s) => return Err(AppError::BadRequest(format!("job status is '{s}', not open"))),
        None => return Err(AppError::NotFound(format!("job {job_id} not found"))),
    }

    let bid = sqlx::query_as::<_, Bid>(
        r#"INSERT INTO bids (job_id, freelancer_address, proposal, status)
           VALUES ($1, $2, $3, 'pending')
           RETURNING id, job_id, freelancer_address, proposal, proposal_hash, status, created_at"#
    )
    .bind(job_id)
    .bind(req.freelancer_address)
    .bind(req.proposal)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(bid))
}

pub async fn accept_bid(
    State(state): State<AppState>,
    Path((job_id, bid_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<AcceptBidRequest>,
) -> Result<Json<Job>> {
    let client_address: Option<String> = sqlx::query_scalar(
        "SELECT client_address FROM jobs WHERE id = $1 AND status = 'open'",
    )
    .bind(job_id)
    .fetch_optional(&state.pool)
    .await?;

    match client_address.as_deref() {
        Some(address) if address == req.client_address => {}
        Some(_) => {
            return Err(AppError::BadRequest(
                "only the job owner can accept a bid".into(),
            ))
        }
        None => {
            return Err(AppError::BadRequest(
                "job is not open for bid acceptance".into(),
            ))
        }
    }

    let freelancer_address: String = sqlx::query_scalar(
        r#"SELECT freelancer_address
           FROM bids
           WHERE id = $1 AND job_id = $2"#,
    )
    .bind(bid_id)
    .bind(job_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("bid {bid_id} not found for job {job_id}")))?;

    sqlx::query("UPDATE bids SET status = CASE WHEN id = $1 THEN 'accepted' ELSE 'rejected' END WHERE job_id = $2")
        .bind(bid_id)
        .bind(job_id)
        .execute(&state.pool)
        .await?;

    let job = sqlx::query_as::<_, Job>(
        r#"UPDATE jobs
           SET freelancer_address = $1, status = 'awaiting_funding'
           WHERE id = $2
           RETURNING id, title, description, budget_usdc, milestones, client_address,
                     freelancer_address, status, metadata_hash, on_chain_job_id,
                     created_at, updated_at"#,
    )
    .bind(freelancer_address)
    .bind(job_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(job))
}
