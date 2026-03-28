use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── Job ───────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Job {
    pub id: Uuid,
    pub title: String,
    pub description: String,
    pub budget_usdc: i64,       // in micro-USDC (7 decimal places)
    pub milestones: i32,
    pub client_address: String, // Stellar G… address
    pub freelancer_address: Option<String>,
    pub status: String,         // open | in_progress | deliverable_submitted | completed | disputed
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

// ── Milestone ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Milestone {
    pub id: Uuid,
    pub job_id: Uuid,
    pub index: i32,
    pub title: String,
    pub amount_usdc: i64,
    pub status: String, // pending | released
    pub tx_hash: Option<String>,
    pub released_at: Option<DateTime<Utc>>,
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
    pub winner: String,                 // "freelancer" | "client" | "split"
    pub freelancer_share_bps: i32,      // 0–10000 basis points
    pub reasoning: String,
    pub on_chain_tx: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Structured JSON output from the AI Judge (OpenClaw).
#[derive(Debug, Deserialize, Serialize)]
pub struct LlmVerdict {
    #[serde(rename = "Verdict Summary")]
    pub summary: String,
    #[serde(rename = "Liability")]
    pub liability: String, // e.g., "Freelancer", "Client", "Split"
    #[serde(rename = "Payout Split")]
    pub payout_split: PayoutSplit,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PayoutSplit {
    #[serde(rename = "Freelancer Percentage")]
    pub freelancer_percentage: f64,
    #[serde(rename = "Client Percentage")]
    pub client_percentage: f64,
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
