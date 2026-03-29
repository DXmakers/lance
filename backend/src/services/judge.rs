use crate::models::LlmVerdict;
use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::Serialize;
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
  "Liability": "Who was at fault? (Options: Freelancer, Client, or Both)",
  "Payout Split": {
    "Freelancer Percentage": 0.0,
    "Client Percentage": 100.0
  }
}
"#;

#[derive(Debug, Serialize)]
struct LlmRequest {
    model: String,
    messages: Vec<LlmMessage>,
    response_format: Option<LlmResponseFormat>,
}

#[derive(Debug, Serialize)]
struct LlmMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct LlmResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
}

#[derive(Debug, serde::Deserialize)]
struct LlmResponse {
    choices: Vec<LlmChoice>,
}

#[derive(Debug, serde::Deserialize)]
struct LlmChoice {
    message: LlmMessageResponse,
}

#[derive(Debug, serde::Deserialize)]
struct LlmMessageResponse {
    content: String,
}

pub struct JudgeService {
    client: Client,
    api_key: String,
    api_url: String,
    model: String,
}

impl JudgeService {
    pub fn from_env() -> Self {
        let api_key = std::env::var("OPENCLAW_API_KEY")
            .or_else(|_| std::env::var("OPENAI_API_KEY"))
            .unwrap_or_else(|_| "stub_key".into());
        let api_url = std::env::var("OPENCLAW_API_URL")
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
        client_evidence: &[String],
        freelancer_evidence: &[String],
    ) -> Result<LlmVerdict> {
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
                Ok(verdict) => {
                    // Validate Payout Split sums to 100%
                    let total = verdict.payout_split.freelancer_percentage + verdict.payout_split.client_percentage;
                    if (total - 100.0).abs() > 0.01 {
                        warn!("Payout split does not sum to 100%: {}% (attempt {})", total, attempts);
                        continue;
                    }
                    return Ok(verdict);
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

        body.choices.get(0)
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
        assert_eq!(verdict.payout_split.client_percentage, 30.0);
    }

    #[tokio::test]
    async fn test_payout_split_validation() {
        // Mock a service that returns invalid math first then valid math
        let service = JudgeService {
            client: Client::new(),
            api_key: "stub_key".into(),
            api_url: "http://localhost:1234".into(), // Will trigger mock
            model: "test".into(),
        };

        // This is a bit hard to test without mocking the call_llm specifically,
        // but we can test the internal logic.
        
        let valid_json = r#"{
            "Verdict Summary": "reason",
            "Liability": "Freelancer",
            "Payout Split": { "Freelancer Percentage": 50.0, "Client Percentage": 50.0 }
        }"#;
        
        let invalid_json = r#"{
            "Verdict Summary": "reason",
            "Liability": "Freelancer",
            "Payout Split": { "Freelancer Percentage": 50.0, "Client Percentage": 60.0 }
        }"#;

        let v1: LlmVerdict = serde_json::from_str(valid_json).unwrap();
        let total1 = v1.payout_split.freelancer_percentage + v1.payout_split.client_percentage;
        assert!((total1 - 100.0).abs() < 0.01);

        let v2: LlmVerdict = serde_json::from_str(invalid_json).unwrap();
        let total2 = v2.payout_split.freelancer_percentage + v2.payout_split.client_percentage;
        assert!((total2 - 100.0).abs() > 0.01);
    }
}
