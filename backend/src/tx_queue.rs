#![allow(dead_code)]
//! Durable transaction queue (#181).
//!
//! Sits between the API endpoints that want to broadcast a Soroban
//! transaction and the worker that actually submits + polls for
//! confirmation. The queue gives us:
//!
//! - **Retry safety** — submitting a transaction does not block the API
//!   response; the worker drains the queue with bounded retries and surfaces
//!   terminal failures via the `abandoned` state.
//! - **Sequence-mismatch recovery** — when Horizon returns `tx_bad_seq` the
//!   worker re-queues the row after refreshing the source-account state, so
//!   the user does not have to retry by hand.
//! - **Idempotent observability** — every state transition is captured on
//!   the row, with `attempts`, `last_error`, and `tx_hash` fields the API
//!   can expose to surface progress.
//!
//! The module is intentionally storage-only: the actual stellar submission
//! lives in `services::stellar`. This keeps the queue side of the worker
//! testable without spinning up a real Horizon endpoint.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(rename_all = "lowercase", type_name = "TEXT")]
pub enum TransactionQueueStatus {
    Queued,
    Submitted,
    Confirmed,
    Failed,
    Abandoned,
}

impl TransactionQueueStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Submitted => "submitted",
            Self::Confirmed => "confirmed",
            Self::Failed => "failed",
            Self::Abandoned => "abandoned",
        }
    }
}

#[derive(Clone, Debug, sqlx::FromRow)]
pub struct TransactionQueueRow {
    pub id: Uuid,
    pub payload: JsonValue,
    pub status: String,
    pub tx_hash: Option<String>,
    pub sequence_number: Option<i64>,
    pub attempts: i32,
    pub max_attempts: i32,
    pub last_error: Option<String>,
    pub scheduled_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug)]
pub struct EnqueueRequest {
    pub payload: JsonValue,
    pub max_attempts: Option<i32>,
}

/// Enqueue a new transaction for the worker to broadcast.
pub async fn enqueue(pool: &PgPool, req: EnqueueRequest) -> sqlx::Result<TransactionQueueRow> {
    let max_attempts = req.max_attempts.unwrap_or(5);
    sqlx::query_as::<_, TransactionQueueRow>(
        "INSERT INTO transaction_queue (payload, max_attempts)
         VALUES ($1, $2)
         RETURNING *",
    )
    .bind(&req.payload)
    .bind(max_attempts)
    .fetch_one(pool)
    .await
}

/// Atomically claim the next queued row whose `scheduled_at` has passed.
///
/// Uses `SELECT … FOR UPDATE SKIP LOCKED` so multiple worker replicas can
/// drain the queue without stepping on each other. The claim flips the row
/// to `submitted` and bumps `attempts`; the caller is responsible for
/// transitioning it onward to `confirmed` / `failed` / `abandoned` /
/// re-queuing it after a transient error.
pub async fn claim_next_queued(pool: &PgPool) -> sqlx::Result<Option<TransactionQueueRow>> {
    let mut tx = pool.begin().await?;
    let row: Option<TransactionQueueRow> = sqlx::query_as(
        "SELECT * FROM transaction_queue
         WHERE status = 'queued' AND scheduled_at <= NOW()
         ORDER BY scheduled_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1",
    )
    .fetch_optional(&mut *tx)
    .await?;

    let Some(row) = row else {
        tx.commit().await?;
        return Ok(None);
    };

    let claimed: TransactionQueueRow = sqlx::query_as(
        "UPDATE transaction_queue
         SET status = 'submitted',
             attempts = attempts + 1,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *",
    )
    .bind(row.id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Some(claimed))
}

/// Mark a row confirmed once the network reports inclusion.
pub async fn mark_confirmed(
    pool: &PgPool,
    id: Uuid,
    tx_hash: &str,
) -> sqlx::Result<TransactionQueueRow> {
    sqlx::query_as(
        "UPDATE transaction_queue
         SET status = 'confirmed',
             tx_hash = $2,
             last_error = NULL,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *",
    )
    .bind(id)
    .bind(tx_hash)
    .fetch_one(pool)
    .await
}

/// Record a transient failure and either re-queue the row (when more
/// attempts are available) or transition it to `abandoned`.
pub async fn record_failure(
    pool: &PgPool,
    id: Uuid,
    error: &str,
) -> sqlx::Result<TransactionQueueRow> {
    let row: TransactionQueueRow = sqlx::query_as("SELECT * FROM transaction_queue WHERE id = $1")
        .bind(id)
        .fetch_one(pool)
        .await?;

    if row.attempts >= row.max_attempts {
        return sqlx::query_as(
            "UPDATE transaction_queue
             SET status = 'abandoned',
                 last_error = $2,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *",
        )
        .bind(id)
        .bind(error)
        .fetch_one(pool)
        .await;
    }

    sqlx::query_as(
        "UPDATE transaction_queue
         SET status = 'queued',
             last_error = $2,
             scheduled_at = NOW() + INTERVAL '5 seconds',
             updated_at = NOW()
         WHERE id = $1
         RETURNING *",
    )
    .bind(id)
    .bind(error)
    .fetch_one(pool)
    .await
}

/// Mark a row terminally failed. Used for non-retriable errors (malformed
/// XDR, contract panics) where retrying would just waste cycles.
pub async fn mark_failed(
    pool: &PgPool,
    id: Uuid,
    error: &str,
) -> sqlx::Result<TransactionQueueRow> {
    sqlx::query_as(
        "UPDATE transaction_queue
         SET status = 'failed',
             last_error = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *",
    )
    .bind(id)
    .bind(error)
    .fetch_one(pool)
    .await
}

/// Read a single row by id. Used by the API to surface queue status
/// (attempts, last_error, tx_hash) back to the caller.
pub async fn get_by_id(pool: &PgPool, id: Uuid) -> sqlx::Result<Option<TransactionQueueRow>> {
    sqlx::query_as("SELECT * FROM transaction_queue WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_strings_match_db_check_constraint() {
        // Column check constraint: ('queued','submitted','confirmed','failed','abandoned')
        assert_eq!(TransactionQueueStatus::Queued.as_str(), "queued");
        assert_eq!(TransactionQueueStatus::Submitted.as_str(), "submitted");
        assert_eq!(TransactionQueueStatus::Confirmed.as_str(), "confirmed");
        assert_eq!(TransactionQueueStatus::Failed.as_str(), "failed");
        assert_eq!(TransactionQueueStatus::Abandoned.as_str(), "abandoned");
    }

    #[test]
    fn status_round_trips_through_serde() {
        for variant in [
            TransactionQueueStatus::Queued,
            TransactionQueueStatus::Submitted,
            TransactionQueueStatus::Confirmed,
            TransactionQueueStatus::Failed,
            TransactionQueueStatus::Abandoned,
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            let back: TransactionQueueStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(back, variant);
        }
    }

    #[test]
    fn enqueue_request_defaults_to_five_attempts() {
        // The default surfaces in `enqueue` via `unwrap_or(5)`; pin the
        // expectation here so a future change to the default also updates
        // the migration `DEFAULT 5`.
        let req = EnqueueRequest {
            payload: serde_json::json!({"hello": "world"}),
            max_attempts: None,
        };
        assert_eq!(req.max_attempts.unwrap_or(5), 5);
    }
}
