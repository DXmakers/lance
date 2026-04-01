use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct JudgeVerdict {
    pub winner: String,
    pub freelancer_share_bps: i32,
    pub reasoning: String,
}

#[derive(Clone)]
pub struct JudgeService {
    mode: JudgeMode,
    client: Client,
    api_url: Option<String>,
    api_key: Option<String>,
}

#[derive(Clone)]
enum JudgeMode {
    Stub,
    Http,
}

#[derive(Serialize)]
struct JudgeRequest<'a> {
    job_spec: &'a str,
    deliverable_hash: &'a str,
    client_evidence: Vec<String>,
    freelancer_evidence: Vec<String>,
}

impl JudgeService {
    pub fn from_env() -> Self {
        let api_url = std::env::var("OPENCLAW_API_URL").ok();
        let mode = match std::env::var("OPENCLAW_MODE")
            .unwrap_or_else(|_| "stub".to_string())
            .to_lowercase()
            .as_str()
        {
            "http" if api_url.is_some() => JudgeMode::Http,
            _ => JudgeMode::Stub,
        };

        Self {
            mode,
            client: Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .expect("reqwest client should build"),
            api_url,
            api_key: std::env::var("OPENCLAW_API_KEY").ok(),
        }
    }

    pub async fn judge(
        &self,
        job_spec: &str,
        deliverable_hash: &str,
        client_evidence: Vec<String>,
        freelancer_evidence: Vec<String>,
    ) -> Result<JudgeVerdict> {
        match self.mode {
            JudgeMode::Stub => {
                Ok(self.stub_verdict(deliverable_hash, &client_evidence, &freelancer_evidence))
            }
            JudgeMode::Http => {
                self.http_verdict(
                    job_spec,
                    deliverable_hash,
                    client_evidence,
                    freelancer_evidence,
                )
                .await
            }
        }
    }

    async fn http_verdict(
        &self,
        job_spec: &str,
        deliverable_hash: &str,
        client_evidence: Vec<String>,
        freelancer_evidence: Vec<String>,
    ) -> Result<JudgeVerdict> {
        let api_url = self
            .api_url
            .as_deref()
            .context("OPENCLAW_API_URL must be configured in http mode")?;
        let endpoint = format!("{}/judge", api_url.trim_end_matches('/'));
        let payload = JudgeRequest {
            job_spec,
            deliverable_hash,
            client_evidence,
            freelancer_evidence,
        };

        let mut request = self.client.post(endpoint).json(&payload);
        if let Some(api_key) = &self.api_key {
            request = request.bearer_auth(api_key);
        }

        let verdict = request
            .send()
            .await?
            .error_for_status()?
            .json::<JudgeVerdict>()
            .await
            .context("failed to decode OpenClaw verdict response")?;

        Ok(verdict)
    }

    fn stub_verdict(
        &self,
        deliverable_hash: &str,
        client_evidence: &[String],
        freelancer_evidence: &[String],
    ) -> JudgeVerdict {
        if let Ok(raw) = std::env::var("OPENCLAW_STUB_VERDICT_BPS") {
            if let Ok(bps) = raw.parse::<i32>() {
                return verdict_from_bps(
                    bps.clamp(0, 10_000),
                    format!(
                        "Stubbed OpenClaw verdict from OPENCLAW_STUB_VERDICT_BPS for deliverable {deliverable_hash}"
                    ),
                );
            }
        }

        let client_weight = score_evidence(client_evidence);
        let freelancer_weight = score_evidence(freelancer_evidence);
        let total_weight = client_weight + freelancer_weight;

        let bps = if total_weight == 0 {
            5_000
        } else {
            ((freelancer_weight as f64 / total_weight as f64) * 10_000.0).round() as i32
        }
        .clamp(0, 10_000);

        verdict_from_bps(
            bps,
            format!(
                "Stubbed OpenClaw verdict for deliverable {deliverable_hash}; weighted client evidence={client_weight}, freelancer evidence={freelancer_weight}"
            ),
        )
    }
}

fn score_evidence(entries: &[String]) -> usize {
    entries
        .iter()
        .map(|entry| {
            let lower = entry.to_lowercase();
            let mut score = entry.len().max(1);
            if lower.contains("complete")
                || lower.contains("delivered")
                || lower.contains("approved")
            {
                score += 100;
            }
            if lower.contains("refund") || lower.contains("breach") || lower.contains("failed") {
                score += 100;
            }
            score
        })
        .sum()
}

fn verdict_from_bps(freelancer_share_bps: i32, reasoning: String) -> JudgeVerdict {
    let winner = match freelancer_share_bps {
        0 => "client",
        10_000 => "freelancer",
        _ => "split",
    }
    .to_string();

    JudgeVerdict {
        winner,
        freelancer_share_bps,
        reasoning,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stub_verdict_override() {
        std::env::set_var("OPENCLAW_STUB_VERDICT_BPS", "2500");
        let service = JudgeService::from_env();
        let verdict = service.stub_verdict("cid", &[], &[]);
        assert_eq!(verdict.freelancer_share_bps, 2500);
        assert_eq!(verdict.winner, "split");
        std::env::remove_var("OPENCLAW_STUB_VERDICT_BPS");
    }

    #[test]
    fn test_stub_verdict_scores_freelancer_evidence() {
        let service = JudgeService::from_env();
        let verdict = service.stub_verdict(
            "cid",
            &[String::from("refund requested after failed delivery")],
            &[String::from("work complete and approved by milestones")],
        );
        assert!(verdict.freelancer_share_bps > 0);
        assert!(verdict.freelancer_share_bps < 10_000);
    }
}
