//! OpenClaw AI judge service.
//! This service connects to the OpenClaw LLM agent to analyze disputes.

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::time::Duration;
use tokio::time::sleep;
use uuid::Uuid;

use crate::models::{Dispute, Evidence, Job, Milestone};

// ── OpenClaw Data Structures ──────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JobContext {
    pub title: String,
    pub description: String,
    pub budget_usdc: i64,
    pub milestones: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeliverableEvidence {
    pub id: Uuid,
    pub submitted_by: String,
    pub content: String,
    pub file_hash: Option<String>,
    pub file_content: Option<String>, // Fetched from IPFS
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CaseFile {
    pub dispute_id: Uuid,
    pub job_context: JobContext,
    pub evidence: Vec<DeliverableEvidence>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JudgeVerdict {
    pub winner: String,           // "freelancer" | "client" | "split"
    pub freelancer_share_bps: i32, // 0–10000 basis points
    pub reasoning: String,
}

// ── OpenClaw API Client ───────────────────────────────────────────────────────

pub struct OpenClawClient {
    client: Client,
    api_url: String,
    api_key: String,
}

impl OpenClawClient {
    pub fn new(api_url: String, api_key: String) -> Self {
        Self {
            client: Client::new(),
            api_url,
            api_key,
        }
    }

    /// Bundles the CaseFile into a prompt payload and sends it to the OpenClaw agent.
    /// Implements an exponential backoff retry mechanism for transient failures.
    pub async fn analyze_dispute(&self, case_file: CaseFile) -> Result<JudgeVerdict> {
        let max_retries = 3;
        let mut retry_count = 0;

        loop {
            let response = self.client
                .post(format!("{}/analyze", self.api_url))
                .header("Authorization", format!("Bearer {}", self.api_key))
                .json(&case_file)
                .send()
                .await;

            match response {
                Ok(res) if res.status().is_success() => {
                    return Ok(res.json::<JudgeVerdict>().await?);
                }
                Ok(res) if (res.status().is_server_error() || res.status() == reqwest::StatusCode::TOO_MANY_REQUESTS) && retry_count < max_retries => {
                    tracing::warn!("OpenClaw retryable error ({}): {}. Retrying...", retry_count + 1, res.status());
                    retry_count += 1;
                    sleep(Duration::from_secs(2u64.pow(retry_count))).await;
                }
                Err(e) if retry_count < max_retries => {
                    tracing::warn!("OpenClaw connection error ({}): {}. Retrying...", retry_count + 1, e);
                    retry_count += 1;
                    sleep(Duration::from_secs(2u64.pow(retry_count))).await;
                }
                Ok(res) => {
                    anyhow::bail!("OpenClaw API returned error status: {}", res.status());
                }
                Err(e) => {
                    anyhow::bail!("OpenClaw request failed after retries: {}", e);
                }
            }
        }
    }
}

// ── Judge Service ─────────────────────────────────────────────────────────────

pub struct JudgeService {
    openclaw: OpenClawClient,
}

impl JudgeService {
    pub fn from_env() -> Self {
        let api_url = std::env::var("OPENCLAW_API_URL")
            .unwrap_or_else(|_| "https://api.openclaw.ai/v1".to_string());
        let api_key = std::env::var("OPENCLAW_API_KEY")
            .unwrap_or_else(|_| "dummy_key".to_string());

        Self {
            openclaw: OpenClawClient::new(api_url, api_key),
        }
    }

    /// Bundles all database records and IPFS texts for a given dispute into a CaseFile.
    pub async fn bundle_case_file(&self, pool: &PgPool, dispute_id: Uuid) -> Result<CaseFile> {
        // 1. Fetch Dispute
        let dispute: Dispute = sqlx::query_as("SELECT * FROM disputes WHERE id = $1")
            .bind(dispute_id)
            .fetch_one(pool)
            .await
            .context("failed to fetch dispute")?;

        // 2. Fetch Job & Milestones
        let job: Job = sqlx::query_as("SELECT * FROM jobs WHERE id = $1")
            .bind(dispute.job_id)
            .fetch_one(pool)
            .await
            .context("failed to fetch job for dispute")?;

        let milestones: Vec<Milestone> = sqlx::query_as("SELECT * FROM milestones WHERE job_id = $1 ORDER BY index ASC")
            .bind(job.id)
            .fetch_all(pool)
            .await
            .context("failed to fetch milestones for job")?;

        // 3. Fetch Evidence
        let evidence_list: Vec<Evidence> = sqlx::query_as("SELECT * FROM evidence WHERE dispute_id = $1 ORDER BY created_at ASC")
            .bind(dispute_id)
            .fetch_all(pool)
            .await
            .context("failed to fetch evidence for dispute")?;

        // 4. Bundle everything (including potential IPFS text fetching)
        let mut bundled_evidence = Vec::new();
        for ev in evidence_list {
            let file_content = if let Some(ref cid) = ev.file_hash {
                // Placeholder for IPFS fetching logic
                Some(self.fetch_ipfs_text(cid).await.unwrap_or_else(|_| "Error fetching IPFS content".to_string()))
            } else {
                None
            };

            bundled_evidence.push(DeliverableEvidence {
                id: ev.id,
                submitted_by: ev.submitted_by,
                content: ev.content,
                file_hash: ev.file_hash,
                file_content,
                created_at: ev.created_at,
            });
        }

        Ok(CaseFile {
            dispute_id,
            job_context: JobContext {
                title: job.title,
                description: job.description,
                budget_usdc: job.budget_usdc,
                milestones: milestones.into_iter().map(|m| format!("{}: {}", m.title, m.amount_usdc)).collect(),
            },
            evidence: bundled_evidence,
        })
    }

    /// Placeholder for fetching text content from IPFS.
    pub async fn fetch_ipfs_text(&self, cid: &str) -> Result<String> {
        // In a real scenario, this would call an IPFS gateway or a local IPFS node.
        // For now, we stub it as per the "Integration Foundation" requirements.
        tracing::debug!("Fetching IPFS content for CID: {}", cid);
        Ok(format!("[Stub content for IPFS CID: {}]", cid))
    }

    /// Core entry point for triggering a dispute analysis.
    pub async fn judge(&self, pool: &PgPool, dispute_id: Uuid) -> Result<JudgeVerdict> {
        let case_file = self.bundle_case_file(pool, dispute_id).await?;
        self.openclaw.analyze_dispute(case_file).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;

    #[tokio::test]
    async fn test_openclaw_integration_success() {
        let mut server = Server::new_async().await;
        let url = server.url();

        let mock = server
            .mock("POST", "/analyze")
            .match_header("Authorization", "Bearer test_key")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"winner": "freelancer", "freelancer_share_bps": 10000, "reasoning": "Work was completed as per requirements."}"#)
            .create_async()
            .await;

        let client = OpenClawClient::new(url, "test_key".to_string());
        let case_file = CaseFile {
            dispute_id: Uuid::new_v4(),
            job_context: JobContext {
                title: "Test Job".to_string(),
                description: "Test description".to_string(),
                budget_usdc: 1000,
                milestones: vec!["M1".to_string()],
            },
            evidence: vec![],
        };

        let result = client.analyze_dispute(case_file).await.unwrap();

        assert_eq!(result.winner, "freelancer");
        assert_eq!(result.freelancer_share_bps, 10000);
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_openclaw_retry_mechanism() {
        let mut server = Server::new_async().await;
        let url = server.url();

        // Fail twice, succeed once
        let mock_fail = server
            .mock("POST", "/analyze")
            .with_status(500)
            .expect(2)
            .create_async()
            .await;

        let mock_success = server
            .mock("POST", "/analyze")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"winner": "split", "freelancer_share_bps": 5000, "reasoning": "Partial completion."}"#)
            .create_async()
            .await;

        let client = OpenClawClient::new(url, "test_key".to_string());
        let case_file = CaseFile {
            dispute_id: Uuid::new_v4(),
            job_context: JobContext {
                title: "Retry Job".to_string(),
                description: "Description".to_string(),
                budget_usdc: 1000,
                milestones: vec![],
            },
            evidence: vec![],
        };

        let result = client.analyze_dispute(case_file).await.unwrap();

        assert_eq!(result.winner, "split");
        mock_fail.assert_async().await;
        mock_success.assert_async().await;
    }
}
