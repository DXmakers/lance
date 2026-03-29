use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct JudgeVerdict {
    pub winner: String,           // "freelancer" | "client" | "split"
    pub freelancer_share_bps: i32,
    pub reasoning: String,
}

#[derive(Serialize)]
struct JudgeRequest<'a> {
    job_spec: &'a str,
    deliverable_hash: &'a str,
    client_evidence: Vec<String>,
    freelancer_evidence: Vec<String>,
}

pub struct JudgeService {
    client: Client,
    api_url: String,
}

impl JudgeService {
    pub fn from_env() -> Self {
        Self {
            client: Client::new(),
            api_url: std::env::var("JUDGE_API_URL")
                .unwrap_or_else(|_| "http://localhost:8080/judge".to_string()),
        }
    }

    pub async fn judge(
        &self,
        job_spec: &str,
        deliverable_hash: &str,
        client_evidence: Vec<String>,
        freelancer_evidence: Vec<String>,
    ) -> Result<JudgeVerdict> {
        let body = JudgeRequest { job_spec, deliverable_hash, client_evidence, freelancer_evidence };
        let verdict: JudgeVerdict = self.client
            .post(&self.api_url)
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(verdict)
    }
}
