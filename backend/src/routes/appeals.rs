use axum::{
    extract::{Path, State},
    routing::post,
    Json, Router,
};
use uuid::Uuid;

use crate::{
    db::AppState,
    error::{AppError, Result},
    models::{
        Appeal, ArbiterVote, CastVoteRequest, CreateAppealRequest,
        APPEAL_BUDGET_THRESHOLD, APPEAL_QUORUM,
    },
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/:id/vote", post(cast_vote))
}

/// POST /disputes/:id/appeal
///
/// Creates an appeal for a dispute whose job budget exceeds the threshold
/// (1000 USDC in stroops). Only resolved disputes can be appealed.
pub async fn create_appeal(
    State(state): State<AppState>,
    Path(dispute_id): Path<Uuid>,
    Json(req): Json<CreateAppealRequest>,
) -> Result<Json<Appeal>> {
    // 1. Load the dispute
    let dispute_row = sqlx::query_as::<_, crate::models::Dispute>(
        "SELECT id, job_id, opened_by, status, created_at FROM disputes WHERE id = $1",
    )
    .bind(dispute_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("dispute {dispute_id} not found")))?;

    if dispute_row.status != "resolved" {
        return Err(AppError::BadRequest(
            "only resolved disputes can be appealed".into(),
        ));
    }

    // 2. Check that the underlying job budget exceeds the appeal threshold
    let budget: Option<i64> =
        sqlx::query_scalar("SELECT budget_usdc FROM jobs WHERE id = $1")
            .bind(dispute_row.job_id)
            .fetch_optional(&state.pool)
            .await?;

    let budget = budget.ok_or_else(|| {
        AppError::NotFound(format!("job {} not found", dispute_row.job_id))
    })?;

    if budget < APPEAL_BUDGET_THRESHOLD {
        return Err(AppError::BadRequest(format!(
            "job budget ({budget} stroops) is below the appeal threshold ({APPEAL_BUDGET_THRESHOLD} stroops / 1000 USDC)"
        )));
    }

    // 3. Ensure no existing appeal
    let existing: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM appeals WHERE dispute_id = $1")
            .bind(dispute_id)
            .fetch_optional(&state.pool)
            .await?;
    if existing.is_some() {
        return Err(AppError::BadRequest(
            "an appeal already exists for this dispute".into(),
        ));
    }

    // 4. Create the appeal
    let appeal = sqlx::query_as::<_, Appeal>(
        r#"INSERT INTO appeals (dispute_id, status)
           VALUES ($1, 'open')
           RETURNING id, dispute_id, status, created_at"#,
    )
    .bind(dispute_id)
    .fetch_one(&state.pool)
    .await?;

    // 5. Notify arbiters (log for now; a real implementation would
    //    send webhooks or emails)
    let arbiter_addrs: Vec<String> =
        sqlx::query_scalar("SELECT address FROM arbiters WHERE active = TRUE")
            .fetch_all(&state.pool)
            .await?;
    tracing::info!(
        appeal_id = %appeal.id,
        requester = %req.requester_address,
        arbiters = ?arbiter_addrs,
        "appeal created — notifying arbiters"
    );

    Ok(Json(appeal))
}

/// POST /appeals/:id/vote
///
/// An arbiter casts their vote on an open appeal.
/// When the quorum (3-of-5) is reached the appeal closes and overrides
/// the original AI judge verdict.
async fn cast_vote(
    State(state): State<AppState>,
    Path(appeal_id): Path<Uuid>,
    Json(req): Json<CastVoteRequest>,
) -> Result<Json<ArbiterVote>> {
    // Validate BPS range
    if !(0..=10_000).contains(&req.freelancer_share_bps) {
        return Err(AppError::BadRequest(
            "freelancer_share_bps must be 0–10000".into(),
        ));
    }

    // 1. Load appeal
    let appeal = sqlx::query_as::<_, Appeal>(
        "SELECT id, dispute_id, status, created_at FROM appeals WHERE id = $1",
    )
    .bind(appeal_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("appeal {appeal_id} not found")))?;

    if appeal.status != "open" {
        return Err(AppError::BadRequest("appeal is no longer open".into()));
    }

    // 2. Verify the voter is an active arbiter
    let is_arbiter: Option<bool> = sqlx::query_scalar(
        "SELECT active FROM arbiters WHERE address = $1",
    )
    .bind(&req.arbiter_address)
    .fetch_optional(&state.pool)
    .await?;

    match is_arbiter {
        Some(true) => {}
        Some(false) => {
            return Err(AppError::BadRequest("arbiter is inactive".into()))
        }
        None => {
            return Err(AppError::BadRequest(
                "address is not a registered arbiter".into(),
            ))
        }
    }

    // 3. Insert the vote (unique constraint prevents double-voting)
    let vote = sqlx::query_as::<_, ArbiterVote>(
        r#"INSERT INTO arbiter_votes (appeal_id, arbiter_address, freelancer_share_bps, reasoning)
           VALUES ($1, $2, $3, $4)
           RETURNING id, appeal_id, arbiter_address, freelancer_share_bps, reasoning, created_at"#,
    )
    .bind(appeal_id)
    .bind(&req.arbiter_address)
    .bind(req.freelancer_share_bps)
    .bind(&req.reasoning)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(ref db_err) = e {
            if db_err.constraint() == Some("arbiter_votes_appeal_id_arbiter_address_key") {
                return AppError::BadRequest("this arbiter has already voted".into());
            }
        }
        AppError::Database(e)
    })?;

    // 4. Count votes so far
    let vote_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM arbiter_votes WHERE appeal_id = $1")
            .bind(appeal_id)
            .fetch_one(&state.pool)
            .await?;
    // let vote_count = vote_count.unwrap_or(0); // No longer needed as fetch_one returns i64

    // 5. If quorum reached, close appeal and override the original verdict
    if vote_count >= APPEAL_QUORUM as i64 {
        // Compute average freelancer_share_bps from all votes
        let avg_bps: Option<i32> = sqlx::query_scalar(
            "SELECT AVG(freelancer_share_bps)::INT FROM arbiter_votes WHERE appeal_id = $1",
        )
        .bind(appeal_id)
        .fetch_one(&state.pool)
        .await?;

        let final_bps = avg_bps.unwrap_or(5000);
        let winner = match final_bps {
            0 => "client".to_string(),
            10000 => "freelancer".to_string(),
            _ => "split".to_string(),
        };

        // Close the appeal
        sqlx::query("UPDATE appeals SET status = 'closed_override' WHERE id = $1")
            .bind(appeal_id)
            .execute(&state.pool)
            .await?;

        // Override the original verdict by inserting a new one marked as appeal override
        sqlx::query(
            r#"INSERT INTO verdicts (dispute_id, winner, freelancer_share_bps, reasoning, on_chain_tx)
               VALUES ($1, $2, $3, $4, NULL)"#,
        )
        .bind(appeal.dispute_id)
        .bind(&winner)
        .bind(final_bps)
        .bind(format!(
            "Appeal override: {vote_count} arbiter votes, avg freelancer share {final_bps} bps"
        ))
        .execute(&state.pool)
        .await?;

        tracing::info!(
            appeal_id = %appeal_id,
            dispute_id = %appeal.dispute_id,
            winner = %winner,
            final_bps = final_bps,
            "appeal quorum reached — verdict overridden"
        );
    }

    Ok(Json(vote))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::APPEAL_BUDGET_THRESHOLD;

    #[test]
    fn test_threshold_constant() {
        // 1000 USDC * 10^7 stroops = 10_000_000_000
        assert_eq!(APPEAL_BUDGET_THRESHOLD, 10_000_000_000);
    }

    #[test]
    fn test_quorum() {
        assert_eq!(APPEAL_QUORUM, 3);
    }
}
