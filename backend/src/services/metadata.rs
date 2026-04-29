//! IPFS metadata storage service for job and bid metadata.
//!
//! This module provides utilities for serializing, pinning, and retrieving
//! structured metadata (job details, bid proposals) to/from IPFS via Pinata.

use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::ipfs;

/// Job metadata structure stored on IPFS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobMetadata {
    pub job_id: Uuid,
    pub title: String,
    pub description: String,
    pub budget_usdc: i64,
    pub milestones: i32,
    pub client_address: String,
    pub tags: Vec<String>,
    pub skills_required: Vec<String>,
    pub estimated_duration_days: Option<i32>,
}

/// Bid metadata structure stored on IPFS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BidMetadata {
    pub bid_id: Uuid,
    pub job_id: Uuid,
    pub freelancer_address: String,
    pub proposal: String,
    pub proposed_rate_usdc_per_day: Option<i64>,
    pub estimated_hours: Option<i32>,
    pub portfolio_links: Vec<String>,
    pub cover_letter: String,
}

/// Pin job metadata to IPFS and return the CID.
///
/// Serializes the provided metadata to JSON, pins it to IPFS,
/// and returns the content identifier (CID) for retrieval.
pub async fn store_job_metadata(client: &Client, metadata: &JobMetadata) -> Result<String> {
    let json = serde_json::to_vec(&metadata).context("failed to serialize job metadata to JSON")?;

    let filename = format!("job-{}-metadata.json", metadata.job_id);
    ipfs::pin_to_ipfs(client, json, &filename, "application/json")
        .await
        .context("failed to pin job metadata to IPFS")
}

/// Pin bid metadata to IPFS and return the CID.
pub async fn store_bid_metadata(client: &Client, metadata: &BidMetadata) -> Result<String> {
    let json = serde_json::to_vec(&metadata).context("failed to serialize bid metadata to JSON")?;

    let filename = format!("bid-{}-metadata.json", metadata.bid_id);
    ipfs::pin_to_ipfs(client, json, &filename, "application/json")
        .await
        .context("failed to pin bid metadata to IPFS")
}

/// Retrieve job metadata from IPFS by CID.
///
/// Fetches the JSON file from IPFS via a public gateway and deserializes it.
pub async fn retrieve_job_metadata(client: &Client, cid: &str) -> Result<JobMetadata> {
    let url = format!("https://gateway.pinata.cloud/ipfs/{cid}");

    let response = client
        .get(&url)
        .send()
        .await
        .context("failed to fetch metadata from IPFS gateway")?;

    if !response.status().is_success() {
        anyhow::bail!(
            "IPFS gateway returned {}: {}",
            response.status(),
            response.text().await?
        );
    }

    response
        .json::<JobMetadata>()
        .await
        .context("failed to parse job metadata from IPFS")
}

/// Retrieve bid metadata from IPFS by CID.
pub async fn retrieve_bid_metadata(client: &Client, cid: &str) -> Result<BidMetadata> {
    let url = format!("https://gateway.pinata.cloud/ipfs/{cid}");

    let response = client
        .get(&url)
        .send()
        .await
        .context("failed to fetch metadata from IPFS gateway")?;

    if !response.status().is_success() {
        anyhow::bail!(
            "IPFS gateway returned {}: {}",
            response.status(),
            response.text().await?
        );
    }

    response
        .json::<BidMetadata>()
        .await
        .context("failed to parse bid metadata from IPFS")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_job_metadata_serialization() {
        let metadata = JobMetadata {
            job_id: Uuid::new_v4(),
            title: "Build a landing page".to_string(),
            description: "Need a modern landing page for my startup".to_string(),
            budget_usdc: 5_000_000,
            milestones: 2,
            client_address: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                .to_string(),
            tags: vec!["web".to_string(), "react".to_string()],
            skills_required: vec!["React".to_string(), "TypeScript".to_string()],
            estimated_duration_days: Some(14),
        };

        let json = serde_json::to_string(&metadata).expect("serialization should succeed");
        assert!(json.contains("Build a landing page"));
        assert!(json.contains("web"));
    }

    #[test]
    fn test_bid_metadata_serialization() {
        let metadata = BidMetadata {
            bid_id: Uuid::new_v4(),
            job_id: Uuid::new_v4(),
            freelancer_address: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                .to_string(),
            proposal: "I can build this in 10 days with a pixel-perfect design.".to_string(),
            proposed_rate_usdc_per_day: Some(500_000),
            estimated_hours: Some(80),
            portfolio_links: vec!["https://example.com/portfolio".to_string()],
            cover_letter: "I'm excited to work on this project!".to_string(),
        };

        let json = serde_json::to_string(&metadata).expect("serialization should succeed");
        assert!(json.contains("pixel-perfect design"));
        assert!(json.contains("portfolio"));
    }

    #[test]
    fn test_job_metadata_deserialization() {
        let json = r#"{
            "job_id": "550e8400-e29b-41d4-a716-446655440000",
            "title": "Build a landing page",
            "description": "Need a modern landing page",
            "budget_usdc": 5000000,
            "milestones": 2,
            "client_address": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
            "tags": ["web", "react"],
            "skills_required": ["React", "TypeScript"],
            "estimated_duration_days": 14
        }"#;

        let metadata: JobMetadata =
            serde_json::from_str(json).expect("deserialization should succeed");
        assert_eq!(metadata.title, "Build a landing page");
        assert_eq!(metadata.milestones, 2);
        assert_eq!(metadata.skills_required.len(), 2);
    }

    #[test]
    fn test_bid_metadata_deserialization() {
        let json = r#"{
            "bid_id": "550e8400-e29b-41d4-a716-446655440000",
            "job_id": "550e8400-e29b-41d4-a716-446655440001",
            "freelancer_address": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
            "proposal": "I can build this",
            "proposed_rate_usdc_per_day": 500000,
            "estimated_hours": 80,
            "portfolio_links": ["https://example.com"],
            "cover_letter": "I'm excited!"
        }"#;

        let metadata: BidMetadata =
            serde_json::from_str(json).expect("deserialization should succeed");
        assert_eq!(
            metadata.freelancer_address,
            "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
        );
        assert_eq!(metadata.estimated_hours, Some(80));
    }
}
