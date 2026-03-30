use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

pub const AGENT_JUDGE_SYSTEM_PROMPT: &str = r#"
You are an impartial, strict, and logical arbitrator for Lance, a freelance platform. 
Your task is to judge a dispute between a freelancer and a client.

GOAL:
Evaluate the alignment between the initial job requirements and the final submitted work (or lack thereof), considering evidence from both parties.

INPUTS:
1. Job Specification (Requirements and Scope)
2. Deliverable (Hash/Description of work submitted)
3. Client Evidence (Arguments/Screenshots/Messages from the client)
4. Freelancer Evidence (Arguments/Screenshots/Messages from the freelancer)

RULES:
- Be impartial. Do not favor one party over the other without clear evidence.
- Be strict. If requirements were not met, note it. If the client is being unreasonable, note it.
- Your response MUST be a valid JSON object.
- The Payout Split percentages MUST sum to exactly 100%.

REQUIRED JSON SCHEMA:
{
  "Verdict Summary": "Detailed reasoning for your decision, explaining the logic behind the payout distribution.",
  "Liability": "Who was at fault? (Options: Freelancer, Client, Both, or None)",
  "Payout Split": {
    "Freelancer Percentage": 0.0,
    "Client Percentage": 100.0
  }
}
"#;
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

#[derive(Debug, Deserialize)]
struct LlmVerdict {
    #[serde(rename = "Verdict Summary")]
    summary: String,
    #[serde(rename = "Liability")]
    liability: String,
    #[serde(rename = "Payout Split")]
    payout_split: PayoutSplit,
}

#[derive(Debug, Deserialize)]
struct PayoutSplit {
    #[serde(rename = "Freelancer Percentage")]
    freelancer_percentage: f64,
    #[serde(rename = "Client Percentage")]
    client_percentage: f64,
}

#[derive(Debug, Serialize)]
struct LlmRequest {
    model: String,
    messages: Vec<LlmMessage>,
    response_format: Option<LlmResponseFormat>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LlmMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct LlmResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
}

#[derive(Debug, Deserialize)]
struct LlmResponse {
    choices: Vec<LlmChoice>,
}

#[derive(Debug, Deserialize)]
struct LlmChoice {
    message: LlmMessageResponse,
}

#[derive(Debug, Deserialize)]
struct LlmMessageResponse {
    content: String,
}
// ── OpenClaw API Client ───────────────────────────────────────────────────────

pub struct OpenClawClient {
    client: Client,
    api_key: String,
    api_url: String,
    model: String,
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
        let api_key = std::env::var("OPENAI_API_KEY")
            .or_else(|_| std::env::var("OPENCLAW_API_KEY"))
            .unwrap_or_else(|_| "stub_key".into());
        
        let api_url = std::env::var("JUDGE_API_URL")
            .unwrap_or_else(|_| "https://api.openai.com/v1/chat/completions".into());
        
        let model = std::env::var("AI_JUDGE_MODEL")
            .unwrap_or_else(|_| "gpt-4-turbo-preview".into());

        Self {
            client: Client::new(),
            api_key,
            api_url,
            model,
        }
    }

    pub async fn judge(
        &self,
        job_spec: &str,
        deliverable: &str,
        client_evidence: Vec<String>,
        freelancer_evidence: Vec<String>,
    ) -> Result<JudgeVerdict> {
        let user_prompt = format!(
            "### JOB SPECIFICATION:\n{}\n\n### DELIVERABLE:\n{}\n\n### CLIENT EVIDENCE:\n{}\n\n### FREELANCER EVIDENCE:\n{}",
            job_spec,
            deliverable,
            client_evidence.join("\n- "),
            freelancer_evidence.join("\n- ")
        );

        let max_attempts = 3;

        for attempts in 1..=max_attempts {
            info!("AI Judge attempt {}/{} for dispute", attempts, max_attempts);

            let res = self.call_llm(&user_prompt).await?;
            
            // Clean the response (sometimes LLMs wrap JSON in code blocks)
            let cleaned = res.trim()
                .trim_start_matches("```json")
                .trim_end_matches("```")
                .trim();

            match serde_json::from_str::<LlmVerdict>(cleaned) {
                Ok(llm_verdict) => {
                    // Validate Payout Split sums to 100%
                    let total = llm_verdict.payout_split.freelancer_percentage + llm_verdict.payout_split.client_percentage;
                    if (total - 100.0).abs() > 0.1 {
                        warn!("Payout split does not sum to 100%: {}% (attempt {})", total, attempts);
                        continue;
                    }

                    // Map AI response to JudgeVerdict
                    let winner = match llm_verdict.liability.to_lowercase().as_str() {
                        "freelancer" => "client", // If freelancer is liable, client is the winner
                        "client" => "freelancer",
                        _ => "split",
                    };

                    return Ok(JudgeVerdict {
                        winner: winner.to_string(),
                        freelancer_share_bps: (llm_verdict.payout_split.freelancer_percentage * 100.0) as i32,
                        reasoning: llm_verdict.summary,
                    });
                }
                Err(e) => {
                    warn!("Failed to parse LLM response as JSON: {} (attempt {})", e, attempts);
                }
            }
        }

        Err(anyhow!("Failed to get a valid parseable verdict from AI judge after {} attempts", max_attempts))
    }

    async fn call_llm(&self, user_prompt: &str) -> anyhow::Result<String> {
        if self.api_key == "stub_key" && self.api_url.contains("localhost") {
            // Mock response for testing if no key provided
            return Ok(r#"{
                "Verdict Summary": "The freelancer failed to meet the core requirement X.",
                "Liability": "Freelancer",
                "Payout Split": { "Freelancer Percentage": 20.0, "Client Percentage": 80.0 }
            }"#.into());
        }

        let resp = self.client.post(&self.api_url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&LlmRequest {
                model: self.model.clone(),
                messages: vec![
                    LlmMessage { role: "system".into(), content: AGENT_JUDGE_SYSTEM_PROMPT.into() },
                    LlmMessage { role: "user".into(), content: user_prompt.into() },
                ],
                response_format: Some(LlmResponseFormat { format_type: "json_object".into() }),
            })
            .send()
            .await
            .context("Failed to send request to LLM API")?;

        let body: LlmResponse = resp.json()
            .await
            .context("Failed to parse LLM API response body")?;

        body.choices.first()
            .map(|c| c.message.content.clone())
            .ok_or_else(|| anyhow!("Empty response from LLM"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_parse_valid_verdict() {
        let json = r#"{
            "Verdict Summary": "Good work but missing one detail.",
            "Liability": "Split",
            "Payout Split": { "Freelancer Percentage": 70.0, "Client Percentage": 30.0 }
        }"#;

        let verdict: LlmVerdict = serde_json::from_str(json).unwrap();
        assert_eq!(verdict.liability, "Split");
        assert_eq!(verdict.payout_split.freelancer_percentage, 70.0);
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