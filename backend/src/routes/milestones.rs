//! Milestone tracking routes.
//!
//! Endpoints:
//!   GET    /jobs/:id/milestones              – list all milestones for a job
//!   GET    /jobs/:id/milestones/stats        – aggregate stats (counts + USDC)
//!   GET    /jobs/:id/milestones/:mid         – get a single milestone (full detail)
//!   PATCH  /jobs/:id/milestones/:mid         – update title / description / due_date
//!   POST   /jobs/:id/milestones/:mid/submit  – freelancer marks milestone as submitted
//!   POST   /jobs/:id/milestones/:mid/approve – client approves a submitted milestone
//!   POST   /jobs/:id/milestones/:mid/release – client releases on-chain funds
//!   POST   /jobs/:id/milestones/:mid/reopen  – reopen a submitted milestone (client)
//!   GET    /jobs/:id/milestones/:mid/notes   – list notes on a milestone
//!   POST   /jobs/:id/milestones/:mid/notes   – add a note to a milestone
//!   GET    /jobs/:id/milestones/:mid/events  – full audit log for a milestone

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use uuid::Uuid;

use crate::{
    db::AppState,
    error::{AppError, Result},
    models::{
        AddMilestoneNoteRequest, Milestone, MilestoneEvent, MilestoneNote, MilestoneStats,
        MilestoneSummary, UpdateMilestoneRequest,
    },
};

// ── Router ────────────────────────────────────────────────────────────────────

/// Sub-router mounted at `/jobs/:id/milestones` by `jobs::router()`.
pub fn milestone_sub_router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_milestones))
        .route("/stats", get(get_milestone_stats))
        .route("/:mid", get(get_milestone).patch(update_milestone))
        .route("/:mid/submit", post(submit_milestone))
        .route("/:mid/approve", post(approve_milestone))
        .route("/:mid/release", post(release_milestone))
        .route("/:mid/reopen", post(reopen_milestone))
        .route("/:mid/notes", get(list_notes).post(add_note))
        .route("/:mid/events", get(list_events))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Fetch a milestone, asserting it belongs to the given job.
async fn fetch_milestone(
    state: &AppState,
    job_id: Uuid,
    milestone_id: Uuid,
) -> Result<Milestone> {
    sqlx::query_as::<_, Milestone>(
        r#"SELECT id, job_id, index, title, description, amount_usdc, status,
                  tx_hash, due_date, submitted_at, approved_at, released_at, updated_at
           FROM milestones
           WHERE id = $1 AND job_id = $2"#,
    )
    .bind(milestone_id)
    .bind(job_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("milestone {milestone_id} not found for job {job_id}")))
}

/// Record an immutable audit event for a milestone status transition.
async fn record_event(
    state: &AppState,
    milestone_id: Uuid,
    job_id: Uuid,
    actor_address: &str,
    event_type: &str,
    previous_status: &str,
    new_status: &str,
    tx_hash: Option<&str>,
    metadata: serde_json::Value,
) -> Result<()> {
    sqlx::query(
        r#"INSERT INTO milestone_events
               (milestone_id, job_id, actor_address, event_type,
                previous_status, new_status, tx_hash, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#,
    )
    .bind(milestone_id)
    .bind(job_id)
    .bind(actor_address)
    .bind(event_type)
    .bind(previous_status)
    .bind(new_status)
    .bind(tx_hash)
    .bind(metadata)
    .execute(&state.pool)
    .await?;
    Ok(())
}

// ── GET /jobs/:id/milestones ──────────────────────────────────────────────────

/// List all milestones for a job, ordered by index.
/// Returns lightweight `MilestoneSummary` objects.
pub async fn list_milestones(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
) -> Result<Json<Vec<MilestoneSummary>>> {
    // Verify job exists
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM jobs WHERE id = $1)")
        .bind(job_id)
        .fetch_one(&state.pool)
        .await?;
    if !exists {
        return Err(AppError::NotFound(format!("job {job_id} not found")));
    }

    let rows = sqlx::query_as::<_, Milestone>(
        r#"SELECT id, job_id, index, title, description, amount_usdc, status,
                  tx_hash, due_date, submitted_at, approved_at, released_at, updated_at
           FROM milestones
           WHERE job_id = $1
           ORDER BY index ASC"#,
    )
    .bind(job_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows.into_iter().map(MilestoneSummary::from).collect()))
}

// ── GET /jobs/:id/milestones/stats ────────────────────────────────────────────

/// Return aggregate milestone statistics for a job.
pub async fn get_milestone_stats(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
) -> Result<Json<MilestoneStats>> {
    // Verify job exists
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM jobs WHERE id = $1)")
        .bind(job_id)
        .fetch_one(&state.pool)
        .await?;
    if !exists {
        return Err(AppError::NotFound(format!("job {job_id} not found")));
    }

    // Single aggregation query — avoids N+1
    let row: (i64, i64, i64, i64, i64, i64, i64, i64) = sqlx::query_as(
        r#"SELECT
               COUNT(*)                                                    AS total,
               COUNT(*) FILTER (WHERE status = 'pending')                 AS pending,
               COUNT(*) FILTER (WHERE status = 'submitted')               AS submitted,
               COUNT(*) FILTER (WHERE status = 'approved')                AS approved,
               COUNT(*) FILTER (WHERE status = 'released')                AS released,
               COUNT(*) FILTER (WHERE status = 'disputed')                AS disputed,
               COALESCE(SUM(amount_usdc), 0)                              AS total_budget_usdc,
               COALESCE(SUM(amount_usdc) FILTER (WHERE status = 'released'), 0) AS released_usdc
           FROM milestones
           WHERE job_id = $1"#,
    )
    .bind(job_id)
    .fetch_one(&state.pool)
    .await?;

    let (total, pending, submitted, approved, released, disputed, total_budget, released_usdc) = row;
    let pending_usdc = total_budget - released_usdc;
    let completion_pct = if total > 0 {
        (released as f64 / total as f64) * 100.0
    } else {
        0.0
    };

    Ok(Json(MilestoneStats {
        total,
        pending,
        submitted,
        approved,
        released,
        disputed,
        total_budget_usdc: total_budget,
        released_usdc,
        pending_usdc,
        completion_pct,
    }))
}

// ── GET /jobs/:id/milestones/:mid ─────────────────────────────────────────────

/// Get a single milestone with full detail (including description, dates, notes count).
pub async fn get_milestone(
    State(state): State<AppState>,
    Path((job_id, milestone_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Milestone>> {
    let milestone = fetch_milestone(&state, job_id, milestone_id).await?;
    Ok(Json(milestone))
}

// ── PATCH /jobs/:id/milestones/:mid ──────────────────────────────────────────

/// Update editable fields on a milestone: title, description, due_date.
/// Only allowed while the milestone is in `pending` or `submitted` status.
pub async fn update_milestone(
    State(state): State<AppState>,
    Path((job_id, milestone_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdateMilestoneRequest>,
) -> Result<Json<Milestone>> {
    let milestone = fetch_milestone(&state, job_id, milestone_id).await?;

    if matches!(milestone.status.as_str(), "released" | "approved") {
        return Err(AppError::BadRequest(
            "cannot edit a milestone that has already been approved or released".into(),
        ));
    }

    // Build a partial update — only touch fields that were provided
    let updated = sqlx::query_as::<_, Milestone>(
        r#"UPDATE milestones
           SET title       = COALESCE($1, title),
               description = COALESCE($2, description),
               due_date    = COALESCE($3, due_date)
           WHERE id = $4 AND job_id = $5
           RETURNING id, job_id, index, title, description, amount_usdc, status,
                     tx_hash, due_date, submitted_at, approved_at, released_at, updated_at"#,
    )
    .bind(req.title)
    .bind(req.description)
    .bind(req.due_date)
    .bind(milestone_id)
    .bind(job_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(updated))
}

// ── POST /jobs/:id/milestones/:mid/submit ─────────────────────────────────────

/// Freelancer marks a milestone as submitted (deliverable ready for review).
/// Requires the job to have an assigned freelancer and the milestone to be `pending`.
pub async fn submit_milestone(
    State(state): State<AppState>,
    Path((job_id, milestone_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<serde_json::Value>,
) -> Result<(StatusCode, Json<Milestone>)> {
    let actor = body
        .get("freelancer_address")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("freelancer_address is required".into()))?
        .to_string();

    // Verify the actor is the assigned freelancer
    let (freelancer_address, job_status): (Option<String>, String) = sqlx::query_as(
        "SELECT freelancer_address, status FROM jobs WHERE id = $1",
    )
    .bind(job_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("job {job_id} not found")))?;

    if freelancer_address.as_deref() != Some(actor.as_str()) {
        return Err(AppError::BadRequest(
            "only the assigned freelancer can submit a milestone".into(),
        ));
    }

    if !matches!(job_status.as_str(), "funded" | "in_progress" | "deliverable_submitted") {
        return Err(AppError::BadRequest(format!(
            "job status '{job_status}' does not allow milestone submission"
        )));
    }

    let milestone = fetch_milestone(&state, job_id, milestone_id).await?;

    if milestone.status != "pending" {
        return Err(AppError::BadRequest(format!(
            "milestone is '{}', not pending — cannot submit",
            milestone.status
        )));
    }

    let updated = sqlx::query_as::<_, Milestone>(
        r#"UPDATE milestones
           SET status = 'submitted', submitted_at = NOW()
           WHERE id = $1
           RETURNING id, job_id, index, title, description, amount_usdc, status,
                     tx_hash, due_date, submitted_at, approved_at, released_at, updated_at"#,
    )
    .bind(milestone_id)
    .fetch_one(&state.pool)
    .await?;

    // Transition job to deliverable_submitted
    sqlx::query("UPDATE jobs SET status = 'deliverable_submitted' WHERE id = $1")
        .bind(job_id)
        .execute(&state.pool)
        .await?;

    record_event(
        &state,
        milestone_id,
        job_id,
        &actor,
        "submitted",
        "pending",
        "submitted",
        None,
        json!({ "freelancer_address": actor }),
    )
    .await?;

    Ok((StatusCode::OK, Json(updated)))
}

// ── POST /jobs/:id/milestones/:mid/approve ────────────────────────────────────

/// Client approves a submitted milestone (off-chain approval before on-chain release).
/// Transitions milestone from `submitted` → `approved`.
pub async fn approve_milestone(
    State(state): State<AppState>,
    Path((job_id, milestone_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<Milestone>> {
    let actor = body
        .get("client_address")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("client_address is required".into()))?
        .to_string();

    // Verify actor is the job client
    let client_address: String =
        sqlx::query_scalar("SELECT client_address FROM jobs WHERE id = $1")
            .bind(job_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("job {job_id} not found")))?;

    if client_address != actor {
        return Err(AppError::BadRequest(
            "only the job client can approve a milestone".into(),
        ));
    }

    let milestone = fetch_milestone(&state, job_id, milestone_id).await?;

    if milestone.status != "submitted" {
        return Err(AppError::BadRequest(format!(
            "milestone is '{}', not submitted — cannot approve",
            milestone.status
        )));
    }

    let updated = sqlx::query_as::<_, Milestone>(
        r#"UPDATE milestones
           SET status = 'approved', approved_at = NOW()
           WHERE id = $1
           RETURNING id, job_id, index, title, description, amount_usdc, status,
                     tx_hash, due_date, submitted_at, approved_at, released_at, updated_at"#,
    )
    .bind(milestone_id)
    .fetch_one(&state.pool)
    .await?;

    record_event(
        &state,
        milestone_id,
        job_id,
        &actor,
        "approved",
        "submitted",
        "approved",
        None,
        json!({ "client_address": actor }),
    )
    .await?;

    Ok(Json(updated))
}

// ── POST /jobs/:id/milestones/:mid/release ────────────────────────────────────

/// Client releases on-chain escrow funds for an approved milestone.
/// Transitions milestone from `approved` → `released` (or `submitted` → `released`
/// as a combined approve+release shortcut).
pub async fn release_milestone(
    State(state): State<AppState>,
    Path((job_id, milestone_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Milestone>> {
    let milestone = fetch_milestone(&state, job_id, milestone_id).await?;

    if !matches!(milestone.status.as_str(), "submitted" | "approved") {
        return Err(AppError::BadRequest(format!(
            "milestone is '{}' — only submitted or approved milestones can be released",
            milestone.status
        )));
    }

    // Verify a deliverable exists for this milestone
    let deliverable_exists: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(
               SELECT 1 FROM deliverables
               WHERE job_id = $1 AND milestone_index = $2
           )"#,
    )
    .bind(job_id)
    .bind(milestone.index)
    .fetch_one(&state.pool)
    .await?;

    if !deliverable_exists {
        return Err(AppError::BadRequest(
            "a deliverable must be submitted before releasing milestone funds".into(),
        ));
    }

    // Attempt on-chain release — non-fatal in dev/test environments
    let job_id_str = job_id.to_string();
    let tx_hash = state
        .stellar
        .release_milestone(&job_id_str, milestone.index)
        .await
        .map(Some)
        .unwrap_or_else(|e| {
            tracing::warn!("on-chain release_milestone failed (non-fatal): {e}");
            None
        });

    let prev_status = milestone.status.clone();

    let updated = sqlx::query_as::<_, Milestone>(
        r#"UPDATE milestones
           SET status       = 'released',
               tx_hash      = COALESCE($1, tx_hash),
               approved_at  = COALESCE(approved_at, NOW()),
               released_at  = NOW()
           WHERE id = $2
           RETURNING id, job_id, index, title, description, amount_usdc, status,
                     tx_hash, due_date, submitted_at, approved_at, released_at, updated_at"#,
    )
    .bind(tx_hash.as_deref())
    .bind(milestone_id)
    .fetch_one(&state.pool)
    .await?;

    // Determine new job status
    let remaining_pending: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM milestones WHERE job_id = $1 AND status != 'released'",
    )
    .bind(job_id)
    .fetch_one(&state.pool)
    .await?;

    let next_job_status = if remaining_pending == 0 {
        "completed"
    } else {
        "funded"
    };

    sqlx::query("UPDATE jobs SET status = $1 WHERE id = $2")
        .bind(next_job_status)
        .bind(job_id)
        .execute(&state.pool)
        .await?;

    record_event(
        &state,
        milestone_id,
        job_id,
        "system",
        "released",
        &prev_status,
        "released",
        tx_hash.as_deref(),
        json!({ "job_status_after": next_job_status }),
    )
    .await?;

    Ok(Json(updated))
}

// ── POST /jobs/:id/milestones/:mid/reopen ─────────────────────────────────────

/// Client reopens a submitted milestone (sends it back to `pending`).
/// Used when the deliverable does not meet the brief.
pub async fn reopen_milestone(
    State(state): State<AppState>,
    Path((job_id, milestone_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<Milestone>> {
    let actor = body
        .get("client_address")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("client_address is required".into()))?
        .to_string();

    let client_address: String =
        sqlx::query_scalar("SELECT client_address FROM jobs WHERE id = $1")
            .bind(job_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("job {job_id} not found")))?;

    if client_address != actor {
        return Err(AppError::BadRequest(
            "only the job client can reopen a milestone".into(),
        ));
    }

    let milestone = fetch_milestone(&state, job_id, milestone_id).await?;

    if milestone.status != "submitted" {
        return Err(AppError::BadRequest(format!(
            "milestone is '{}' — only submitted milestones can be reopened",
            milestone.status
        )));
    }

    let updated = sqlx::query_as::<_, Milestone>(
        r#"UPDATE milestones
           SET status = 'pending', submitted_at = NULL
           WHERE id = $1
           RETURNING id, job_id, index, title, description, amount_usdc, status,
                     tx_hash, due_date, submitted_at, approved_at, released_at, updated_at"#,
    )
    .bind(milestone_id)
    .fetch_one(&state.pool)
    .await?;

    // Revert job status to funded
    sqlx::query("UPDATE jobs SET status = 'funded' WHERE id = $1")
        .bind(job_id)
        .execute(&state.pool)
        .await?;

    record_event(
        &state,
        milestone_id,
        job_id,
        &actor,
        "reopened",
        "submitted",
        "pending",
        None,
        json!({ "client_address": actor }),
    )
    .await?;

    Ok(Json(updated))
}

// ── GET /jobs/:id/milestones/:mid/notes ───────────────────────────────────────

/// List all notes on a milestone, newest first.
pub async fn list_notes(
    State(state): State<AppState>,
    Path((job_id, milestone_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<MilestoneNote>>> {
    // Verify milestone belongs to job
    let _ = fetch_milestone(&state, job_id, milestone_id).await?;

    let notes = sqlx::query_as::<_, MilestoneNote>(
        r#"SELECT id, milestone_id, job_id, author_address, body, created_at
           FROM milestone_notes
           WHERE milestone_id = $1
           ORDER BY created_at DESC"#,
    )
    .bind(milestone_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(notes))
}

// ── POST /jobs/:id/milestones/:mid/notes ──────────────────────────────────────

/// Add a note to a milestone. Either party (client or freelancer) may add notes.
pub async fn add_note(
    State(state): State<AppState>,
    Path((job_id, milestone_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<AddMilestoneNoteRequest>,
) -> Result<(StatusCode, Json<MilestoneNote>)> {
    if req.body.trim().is_empty() {
        return Err(AppError::BadRequest("note body cannot be empty".into()));
    }
    if req.body.len() > 4000 {
        return Err(AppError::BadRequest(
            "note body must be 4,000 characters or fewer".into(),
        ));
    }

    // Verify milestone belongs to job
    let _ = fetch_milestone(&state, job_id, milestone_id).await?;

    // Verify author is a party to the job (client or freelancer)
    let (client_address, freelancer_address): (String, Option<String>) = sqlx::query_as(
        "SELECT client_address, freelancer_address FROM jobs WHERE id = $1",
    )
    .bind(job_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("job {job_id} not found")))?;

    let is_party = req.author_address == client_address
        || freelancer_address.as_deref() == Some(req.author_address.as_str());

    if !is_party {
        return Err(AppError::BadRequest(
            "only the client or assigned freelancer can add notes".into(),
        ));
    }

    let note = sqlx::query_as::<_, MilestoneNote>(
        r#"INSERT INTO milestone_notes (milestone_id, job_id, author_address, body)
           VALUES ($1, $2, $3, $4)
           RETURNING id, milestone_id, job_id, author_address, body, created_at"#,
    )
    .bind(milestone_id)
    .bind(job_id)
    .bind(req.author_address)
    .bind(req.body.trim())
    .fetch_one(&state.pool)
    .await?;

    Ok((StatusCode::CREATED, Json(note)))
}

// ── GET /jobs/:id/milestones/:mid/events ──────────────────────────────────────

/// Return the full immutable audit log for a milestone, newest first.
pub async fn list_events(
    State(state): State<AppState>,
    Path((job_id, milestone_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<MilestoneEvent>>> {
    // Verify milestone belongs to job
    let _ = fetch_milestone(&state, job_id, milestone_id).await?;

    let events = sqlx::query_as::<_, MilestoneEvent>(
        r#"SELECT id, milestone_id, job_id, actor_address, event_type,
                  previous_status, new_status, tx_hash, metadata, created_at
           FROM milestone_events
           WHERE milestone_id = $1
           ORDER BY created_at DESC"#,
    )
    .bind(milestone_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(events))
}
