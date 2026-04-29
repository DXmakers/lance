use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use reqwest::Client;
use serde_json::json;
use uuid::Uuid;

use crate::{
    db::AppState,
    error::{AppError, Result},
    models::{CreateJobRequest, Job, MarkJobFundedRequest},
    routes::{bids, deliverables, milestones},
    services::metadata,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_jobs).post(create_job))
        .route("/:id", get(get_job))
        .route("/:id/fund", post(mark_job_funded))
        .route(
            "/:id/metadata",
            post(store_job_metadata).get(retrieve_job_metadata),
        )
        .route("/:id/bids", get(bids::list_bids).post(bids::create_bid))
        .route("/:id/bids/:bid_id/accept", post(bids::accept_bid))
        .route(
            "/:id/bids/:bid_id/metadata",
            post(store_bid_metadata).get(retrieve_bid_metadata),
        )
        .route(
            "/:id/deliverables",
            get(deliverables::list_deliverables).post(deliverables::submit_deliverable),
        )
        .route(
            "/:id/dispute",
            get(crate::routes::disputes::get_job_dispute)
                .post(crate::routes::disputes::open_dispute_for_job),
        )
        .route("/:id/milestones", get(milestones::list_milestones))
        .route(
            "/:id/milestones/:mid/release",
            post(milestones::release_milestone),
        )
        .route(
            "/:id/milestones/:mid/events",
            get(milestones::list_milestone_events),
        )
}

async fn list_jobs(State(state): State<AppState>) -> Result<Json<Vec<Job>>> {
    let jobs = sqlx::query_as::<_, Job>(
        r#"SELECT id, title, description, budget_usdc, milestones, client_address,
                  freelancer_address, status, metadata_hash, on_chain_job_id,
                  created_at, updated_at
           FROM jobs ORDER BY created_at DESC"#,
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(jobs))
}

async fn get_job(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<Job>> {
    let job = sqlx::query_as::<_, Job>(
        r#"SELECT id, title, description, budget_usdc, milestones, client_address,
                  freelancer_address, status, metadata_hash, on_chain_job_id,
                  created_at, updated_at
           FROM jobs WHERE id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("job {id} not found")))?;
    Ok(Json(job))
}

async fn create_job(
    State(state): State<AppState>,
    Json(req): Json<CreateJobRequest>,
) -> Result<Json<Job>> {
    if req.title.is_empty() {
        return Err(AppError::BadRequest("title is required".into()));
    }
    if req.milestones < 1 {
        return Err(AppError::BadRequest("milestones must be at least 1".into()));
    }
    if req.budget_usdc <= 0 {
        return Err(AppError::BadRequest(
            "budget must be greater than zero".into(),
        ));
    }

    let mut tx = state.pool.begin().await?;

    let job = sqlx::query_as::<_, Job>(
        r#"INSERT INTO jobs (title, description, budget_usdc, milestones, client_address, status)
           VALUES ($1, $2, $3, $4, $5, 'open')
           RETURNING id, title, description, budget_usdc, milestones, client_address,
                     freelancer_address, status, metadata_hash, on_chain_job_id,
                     created_at, updated_at"#,
    )
    .bind(req.title)
    .bind(req.description)
    .bind(req.budget_usdc)
    .bind(req.milestones)
    .bind(req.client_address)
    .fetch_one(&mut *tx)
    .await?;

    let per_milestone = job.budget_usdc / i64::from(job.milestones);
    let remainder = job.budget_usdc % i64::from(job.milestones);

    for index in 0..job.milestones {
        let amount_usdc = if index == job.milestones - 1 {
            per_milestone + remainder
        } else {
            per_milestone
        };

        sqlx::query(
            r#"INSERT INTO milestones (job_id, index, title, amount_usdc, status)
               VALUES ($1, $2, $3, $4, 'pending')"#,
        )
        .bind(job.id)
        .bind(index + 1)
        .bind(format!("Milestone {}", index + 1))
        .bind(amount_usdc)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(Json(job))
}

async fn mark_job_funded(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
    Json(req): Json<MarkJobFundedRequest>,
) -> Result<Json<Job>> {
    let (client_address, freelancer_address, status): (String, Option<String>, String) =
        sqlx::query_as(
            r#"SELECT client_address, freelancer_address, status
               FROM jobs WHERE id = $1"#,
        )
        .bind(job_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("job {job_id} not found")))?;

    if client_address != req.client_address {
        return Err(AppError::BadRequest(
            "only the client can mark a job as funded".into(),
        ));
    }
    if freelancer_address.is_none() {
        return Err(AppError::BadRequest(
            "job must have an accepted freelancer first".into(),
        ));
    }
    if !matches!(
        status.as_str(),
        "awaiting_funding" | "funded" | "in_progress"
    ) {
        return Err(AppError::BadRequest(format!(
            "job status '{status}' cannot transition to funded"
        )));
    }

    let job = sqlx::query_as::<_, Job>(
        r#"UPDATE jobs
           SET status = 'funded'
           WHERE id = $1
           RETURNING id, title, description, budget_usdc, milestones, client_address,
                     freelancer_address, status, metadata_hash, on_chain_job_id,
                     created_at, updated_at"#,
    )
    .bind(job_id)
    .fetch_one(&state.pool)
    .await?;

    // Create milestone records in 'milestones' table
    if job.milestones > 0 {
        let amount_per = job.budget_usdc / (job.milestones as i64);
        for i in 0..job.milestones {
            sqlx::query(
                r#"INSERT INTO milestones (job_id, index, title, amount_usdc, status)
                   VALUES ($1, $2, $3, $4, 'pending')"#,
            )
            .bind(job.id)
            .bind(i)
            .bind(format!("Milestone {}", i + 1))
            .bind(amount_per)
            .execute(&state.pool)
            .await?;
        }
    }

    Ok(Json(job))
}

/// Store job metadata to IPFS and update job record with metadata CID.
///
/// POST /api/jobs/:id/metadata
///
/// Request body: metadata::JobMetadata JSON
/// Returns: { "cid": "Qm...", "metadata_hash": "Qm...", "job_id": "..." }
async fn store_job_metadata(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
    Json(metadata): Json<metadata::JobMetadata>,
) -> Result<(StatusCode, Json<serde_json::Value>)> {
    // Verify job exists
    let _job: (String,) = sqlx::query_as("SELECT title FROM jobs WHERE id = $1")
        .bind(job_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("job {job_id} not found")))?;

    // Validate metadata matches job ID
    if metadata.job_id != job_id {
        return Err(AppError::BadRequest(
            "metadata job_id does not match route parameter".into(),
        ));
    }

    // Pin metadata to IPFS
    let client = Client::new();
    let cid = metadata::store_job_metadata(&client, &metadata)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;

    // Update job record with metadata CID
    sqlx::query("UPDATE jobs SET metadata_hash = $1 WHERE id = $2")
        .bind(&cid)
        .bind(job_id)
        .execute(&state.pool)
        .await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "cid": cid,
            "metadata_hash": cid,
            "job_id": job_id.to_string()
        })),
    ))
}

/// Retrieve job metadata from IPFS by job ID.
///
/// GET /api/jobs/:id/metadata
///
/// Returns: metadata::JobMetadata from IPFS
async fn retrieve_job_metadata(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
) -> Result<Json<metadata::JobMetadata>> {
    // Fetch job and get metadata CID
    let (metadata_cid,): (Option<String>,) =
        sqlx::query_as("SELECT metadata_hash FROM jobs WHERE id = $1")
            .bind(job_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("job {job_id} not found")))?;

    let cid = metadata_cid
        .ok_or_else(|| AppError::NotFound(format!("no metadata stored for job {job_id}")))?;

    // Fetch from IPFS gateway
    let client = Client::new();
    let metadata = metadata::retrieve_job_metadata(&client, &cid)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;

    Ok(Json(metadata))
}

/// Store bid metadata to IPFS and update bid record with metadata CID.
///
/// POST /api/jobs/:id/bids/:bid_id/metadata
///
/// Request body: metadata::BidMetadata JSON
/// Returns: { "cid": "Qm...", "proposal_hash": "Qm...", "bid_id": "..." }
async fn store_bid_metadata(
    State(state): State<AppState>,
    Path((job_id, bid_id)): Path<(Uuid, Uuid)>,
    Json(metadata): Json<metadata::BidMetadata>,
) -> Result<(StatusCode, Json<serde_json::Value>)> {
    // Verify bid exists and belongs to job
    let (_bidder,): (String,) =
        sqlx::query_as("SELECT freelancer_address FROM bids WHERE id = $1 AND job_id = $2")
            .bind(bid_id)
            .bind(job_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| {
                AppError::NotFound(format!("bid {bid_id} not found for job {job_id}"))
            })?;

    // Validate metadata matches bid and job IDs
    if metadata.bid_id != bid_id || metadata.job_id != job_id {
        return Err(AppError::BadRequest(
            "metadata bid_id or job_id does not match route parameters".into(),
        ));
    }

    // Pin metadata to IPFS
    let client = Client::new();
    let cid = metadata::store_bid_metadata(&client, &metadata)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;

    // Update bid record with proposal hash (using CID as hash)
    sqlx::query("UPDATE bids SET proposal_hash = $1 WHERE id = $2")
        .bind(&cid)
        .bind(bid_id)
        .execute(&state.pool)
        .await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "cid": cid,
            "proposal_hash": cid,
            "bid_id": bid_id.to_string()
        })),
    ))
}

/// Retrieve bid metadata from IPFS by bid ID.
///
/// GET /api/jobs/:id/bids/:bid_id/metadata
///
/// Returns: metadata::BidMetadata from IPFS
async fn retrieve_bid_metadata(
    State(state): State<AppState>,
    Path((job_id, bid_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<metadata::BidMetadata>> {
    // Fetch bid and get proposal hash (CID)
    let (proposal_hash,): (Option<String>,) =
        sqlx::query_as("SELECT proposal_hash FROM bids WHERE id = $1 AND job_id = $2")
            .bind(bid_id)
            .bind(job_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| {
                AppError::NotFound(format!("bid {bid_id} not found for job {job_id}"))
            })?;

    let cid = proposal_hash
        .ok_or_else(|| AppError::NotFound(format!("no metadata stored for bid {bid_id}")))?;

    // Fetch from IPFS gateway
    let client = Client::new();
    let metadata = metadata::retrieve_bid_metadata(&client, &cid)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;

    Ok(Json(metadata))
}
