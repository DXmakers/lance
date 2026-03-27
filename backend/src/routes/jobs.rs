use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use uuid::Uuid;

use crate::{
    db::AppState,
    error::{AppError, Result},
    models::{CreateJobRequest, Job},
    routes::{bids, milestones},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_jobs).post(create_job))
        .route("/:id", get(get_job))
        .route("/:id/bids", get(bids::list_bids).post(bids::create_bid))
        .route("/:id/milestones/:mid/release", post(milestones::release_milestone))
        .route("/:id/accept-bid", post(accept_bid))
        .route("/:id/dispute", post(crate::routes::disputes::open_dispute_for_job))
}

async fn list_jobs(State(state): State<AppState>) -> Result<Json<Vec<Job>>> {
    let jobs = sqlx::query_as::<_, Job>(
        r#"SELECT id, title, description, budget_usdc, milestones, client_address,
                  freelancer_address, status, metadata_hash, on_chain_job_id,
                  created_at, updated_at
           FROM jobs ORDER BY created_at DESC"#
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(jobs))
}

async fn get_job(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Job>> {
    let job = sqlx::query_as::<_, Job>(
        r#"SELECT id, title, description, budget_usdc, milestones, client_address,
                  freelancer_address, status, metadata_hash, on_chain_job_id,
                  created_at, updated_at
           FROM jobs WHERE id = $1"#
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
    let job = sqlx::query_as::<_, Job>(
        r#"INSERT INTO jobs (title, description, budget_usdc, milestones, client_address, status)
           VALUES ($1, $2, $3, $4, $5, 'open')
           RETURNING id, title, description, budget_usdc, milestones, client_address,
                     freelancer_address, status, metadata_hash, on_chain_job_id,
                     created_at, updated_at"#
    )
    .bind(req.title)
    .bind(req.description)
    .bind(req.budget_usdc)
    .bind(req.milestones)
    .bind(req.client_address)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(job))
}

pub async fn accept_bid(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<serde_json::Value>,
) -> Result<Json<Job>> {
    let freelancer_address = req["freelancer_address"]
        .as_str()
        .ok_or_else(|| crate::error::AppError::BadRequest("freelancer_address is required".into()))?;

    let job = sqlx::query_as::<_, Job>(
        r#"UPDATE jobs 
           SET status = 'in_progress', freelancer_address = $1, updated_at = NOW()
           WHERE id = $2
           RETURNING id, title, description, budget_usdc, milestones, client_address,
                     freelancer_address, status, metadata_hash, on_chain_job_id,
                     created_at, updated_at"#
    )
    .bind(freelancer_address)
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(job))
}
