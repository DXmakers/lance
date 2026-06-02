// backend/src/queue/types.rs
//
// Data types that flow through the async dispute file analysis queue.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A task enqueued when a file is attached to a dispute.
///
/// The worker that receives this task is responsible for:
/// 1. Fetching the file bytes from storage (S3/GCS URL or local).
/// 2. Forwarding the content to the AI judge for analysis.
/// 3. Persisting the analysis result back to `dispute_file_analyses`.
/// 4. Updating the parent dispute's `ai_analysis_status` column.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisputeAnalysisTask {
    /// Unique identifier for this queued task (used for idempotency checks).
    pub task_id: Uuid,

    /// The dispute this file belongs to.
    pub dispute_id: Uuid,

    /// The specific file record being analysed.
    pub file_id: Uuid,

    /// Publicly accessible (or pre-signed) URL the worker fetches.
    pub file_url: String,

    /// MIME type of the uploaded file (e.g. `application/pdf`, `image/png`).
    pub mime_type: String,

    /// Original filename supplied by the uploader.
    pub original_filename: String,

    /// When this task was enqueued (for latency SLO tracking).
    pub enqueued_at: DateTime<Utc>,

    /// Number of delivery attempts so far (incremented by the worker on retry).
    pub attempt: u8,
}

impl DisputeAnalysisTask {
    /// Constructs a new first-attempt task.
    pub fn new(
        dispute_id: Uuid,
        file_id: Uuid,
        file_url: String,
        mime_type: String,
        original_filename: String,
    ) -> Self {
        Self {
            task_id: Uuid::new_v4(),
            dispute_id,
            file_id,
            file_url,
            mime_type,
            original_filename,
            enqueued_at: Utc::now(),
            attempt: 1,
        }
    }

    /// Returns a cloned task with the attempt counter incremented.
    pub fn retry(&self) -> Self {
        Self {
            task_id: self.task_id,
            attempt: self.attempt + 1,
            enqueued_at: Utc::now(),
            ..self.clone()
        }
    }
}

/// Lifecycle states persisted in `dispute_file_analyses.status`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "analysis_status", rename_all = "snake_case")]
pub enum AnalysisStatus {
    /// Task enqueued, not yet picked up by a worker.
    Pending,
    /// A worker is currently processing this file.
    Processing,
    /// AI judge successfully analysed the file.
    Completed,
    /// Analysis failed after maximum retry attempts.
    Failed,
}