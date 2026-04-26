use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── Job ───────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Job {
    pub id: Uuid,
    pub title: String,
    pub description: String,
    pub budget_usdc: i64, // in micro-USDC (7 decimal places)
    pub milestones: i32,
    pub client_address: String, // Stellar G… address
    pub freelancer_address: Option<String>,
    pub status: String, // open | awaiting_funding | funded | deliverable_submitted | completed | disputed
    pub metadata_hash: Option<String>, // IPFS CID
    pub on_chain_job_id: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateJobRequest {
    pub title: String,
    pub description: String,
    pub budget_usdc: i64,
    pub milestones: i32,
    pub client_address: String,
}

#[derive(Debug, Deserialize)]
pub struct MarkJobFundedRequest {
    pub client_address: String,
}

// ── Bid ───────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Bid {
    pub id: Uuid,
    pub job_id: Uuid,
    pub freelancer_address: String,
    pub proposal: String,
    pub proposal_hash: Option<String>,
    pub status: String, // pending | accepted | rejected
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateBidRequest {
    pub freelancer_address: String,
    pub proposal: String,
}

#[derive(Debug, Deserialize)]
pub struct AcceptBidRequest {
    pub client_address: String,
}

// ── Milestone ─────────────────────────────────────────────────────────────────

/// Full milestone record — maps to the `milestones` table after migration 005.
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Milestone {
    pub id: Uuid,
    pub job_id: Uuid,
    pub index: i32,
    pub title: String,
    pub description: String,
    pub amount_usdc: i64,
    /// pending | submitted | approved | released | disputed
    pub status: String,
    pub tx_hash: Option<String>,
    /// ISO-8601 date string (YYYY-MM-DD) stored as TEXT in the DB.
    pub due_date: Option<chrono::NaiveDate>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub approved_at: Option<DateTime<Utc>>,
    pub released_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

/// Lightweight summary used in list responses and dashboard widgets.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MilestoneSummary {
    pub id: Uuid,
    pub job_id: Uuid,
    pub index: i32,
    pub title: String,
    pub amount_usdc: i64,
    pub status: String,
    pub due_date: Option<chrono::NaiveDate>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub released_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

impl From<Milestone> for MilestoneSummary {
    fn from(m: Milestone) -> Self {
        Self {
            id: m.id,
            job_id: m.job_id,
            index: m.index,
            title: m.title,
            amount_usdc: m.amount_usdc,
            status: m.status,
            due_date: m.due_date,
            submitted_at: m.submitted_at,
            released_at: m.released_at,
            updated_at: m.updated_at,
        }
    }
}

/// Aggregate stats for all milestones on a job.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MilestoneStats {
    pub total: i64,
    pub pending: i64,
    pub submitted: i64,
    pub approved: i64,
    pub released: i64,
    pub disputed: i64,
    pub total_budget_usdc: i64,
    pub released_usdc: i64,
    pub pending_usdc: i64,
    /// Completion percentage (0–100).
    pub completion_pct: f64,
}

/// Request body for PATCH /jobs/:id/milestones/:mid
#[derive(Debug, Deserialize)]
pub struct UpdateMilestoneRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub due_date: Option<chrono::NaiveDate>,
}

/// A timestamped note attached to a milestone.
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct MilestoneNote {
    pub id: Uuid,
    pub milestone_id: Uuid,
    pub job_id: Uuid,
    pub author_address: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
}

/// Request body for POST /jobs/:id/milestones/:mid/notes
#[derive(Debug, Deserialize)]
pub struct AddMilestoneNoteRequest {
    pub author_address: String,
    pub body: String,
}

/// An immutable audit event for a milestone status transition.
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct MilestoneEvent {
    pub id: Uuid,
    pub milestone_id: Uuid,
    pub job_id: Uuid,
    pub actor_address: String,
    /// submitted | approved | released | disputed | reopened
    pub event_type: String,
    pub previous_status: String,
    pub new_status: String,
    pub tx_hash: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

// ── Deliverable ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Deliverable {
    pub id: Uuid,
    pub job_id: Uuid,
    pub milestone_index: i32,
    pub submitted_by: String,
    pub label: String,
    pub kind: String,
    pub url: String,
    pub file_hash: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SubmitDeliverableRequest {
    pub submitted_by: String,
    pub label: String,
    pub kind: String,
    pub url: String,
    pub file_hash: Option<String>,
}

// ── Dispute ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Dispute {
    pub id: Uuid,
    pub job_id: Uuid,
    pub opened_by: String,
    pub status: String, // open | under_review | resolved
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct OpenDisputeRequest {
    pub opened_by: String,
}

// ── Evidence ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Evidence {
    pub id: Uuid,
    pub dispute_id: Uuid,
    pub submitted_by: String,
    pub content: String,
    pub file_hash: Option<String>, // IPFS CID
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SubmitEvidenceRequest {
    pub submitted_by: String,
    pub content: String,
    pub file_hash: Option<String>,
}

// ── Verdict ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Verdict {
    pub id: Uuid,
    pub dispute_id: Uuid,
    pub winner: String,            // "freelancer" | "client" | "split"
    pub freelancer_share_bps: i32, // 0–10000 basis points
    pub reasoning: String,
    pub on_chain_tx: Option<String>,
    pub created_at: DateTime<Utc>,
}

// ── Profile ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct UserProfileRecord {
    pub address: String,
    pub display_name: Option<String>,
    pub headline: String,
    pub bio: String,
    pub portfolio_links: serde_json::Value,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProfileMetrics {
    pub total_jobs: i64,
    pub completed_jobs: i64,
    pub active_jobs: i64,
    pub disputed_jobs: i64,
    pub verified_volume_usdc: i64,
    pub completion_rate: f64,
    pub dispute_rate: f64,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct ProfileJobLedgerEntry {
    pub job_id: Uuid,
    pub title: String,
    pub budget_usdc: i64,
    pub role: String,
    pub counterparty: String,
    pub status: String,
    pub completed_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PublicProfile {
    pub address: String,
    pub display_name: Option<String>,
    pub headline: String,
    pub bio: String,
    pub portfolio_links: Vec<String>,
    pub updated_at: DateTime<Utc>,
    pub metrics: ProfileMetrics,
    pub history: Vec<ProfileJobLedgerEntry>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub display_name: Option<String>,
    pub headline: String,
    pub bio: String,
    pub portfolio_links: Vec<String>,
}

// ── Appeal ────────────────────────────────────────────────────────────────────

/// 1000 USDC expressed in stroops (7-decimal micro-USDC).
pub const APPEAL_BUDGET_THRESHOLD: i64 = 10_000_000_000;

/// Number of arbiter votes required to close an appeal.
pub const APPEAL_QUORUM: i32 = 3;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Appeal {
    pub id: Uuid,
    pub dispute_id: Uuid,
    pub status: String, // open | closed_override | closed_upheld
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAppealRequest {
    pub requester_address: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct ArbiterVote {
    pub id: Uuid,
    pub appeal_id: Uuid,
    pub arbiter_address: String,
    pub freelancer_share_bps: i32, // 0–10000
    pub reasoning: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CastVoteRequest {
    pub arbiter_address: String,
    pub freelancer_share_bps: i32,
    pub reasoning: String,
}
