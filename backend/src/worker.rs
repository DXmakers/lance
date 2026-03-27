use std::time::Duration;

use sqlx::PgPool;
use uuid::Uuid;

use crate::services::{judge::JudgeService, stellar::StellarService};

pub async fn run_judge_worker(pool: PgPool) {
    let judge = JudgeService::from_env();
    let stellar = std::env::var("JUDGE_AUTHORITY_SECRET")
        .ok()
        .map(|_| StellarService::from_env());

    loop {
        if let Err(e) = process_open_disputes(&pool, &judge, stellar.as_ref()).await {
            tracing::error!("judge worker error: {e}");
        }
        tokio::time::sleep(Duration::from_secs(30)).await;
    }
}

async fn process_open_disputes(
    pool: &PgPool,
    judge: &JudgeService,
    stellar: Option<&StellarService>,
) -> anyhow::Result<()> {
    let disputes: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "SELECT id, job_id FROM disputes WHERE status = 'open'",
    )
    .fetch_all(pool)
    .await?;

    for (dispute_id, job_id) in disputes {
        if let Err(e) = process_dispute(pool, judge, stellar, dispute_id, job_id).await {
            tracing::error!("dispute {dispute_id} failed: {e}");
            if let Err(e2) = sqlx::query("UPDATE disputes SET status = 'open' WHERE id = $1")
                .bind(dispute_id)
                .execute(pool)
                .await
            {
                tracing::error!("dispute {dispute_id} status reset failed: {e2}");
            }
        }
    }
    Ok(())
}

async fn process_dispute(
    pool: &PgPool,
    judge: &JudgeService,
    stellar: Option<&StellarService>,
    dispute_id: Uuid,
    job_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query("UPDATE disputes SET status = 'under_review' WHERE id = $1")
        .bind(dispute_id)
        .execute(pool)
        .await?;

    #[derive(sqlx::FromRow)]
    struct JobRow {
        description: String,
        on_chain_job_id: Option<i64>,
        client_address: String,
        freelancer_address: Option<String>,
    }

    let job = sqlx::query_as::<_, JobRow>(
        "SELECT description, on_chain_job_id, client_address, freelancer_address FROM jobs WHERE id = $1",
    )
    .bind(job_id)
    .fetch_one(pool)
    .await?;

    #[derive(sqlx::FromRow)]
    struct EvidenceRow {
        submitted_by: String,
        content: String,
    }

    let evidence = sqlx::query_as::<_, EvidenceRow>(
        "SELECT submitted_by, content FROM evidence WHERE dispute_id = $1",
    )
    .bind(dispute_id)
    .fetch_all(pool)
    .await?;

    let client_evidence: Vec<String> = evidence
        .iter()
        .filter(|e| e.submitted_by == job.client_address)
        .map(|e| e.content.clone())
        .collect();

    let freelancer_evidence: Vec<String> = evidence
        .iter()
        .filter(|e| job.freelancer_address.as_deref() == Some(&e.submitted_by))
        .map(|e| e.content.clone())
        .collect();

    let verdict = judge
        .judge(&job.description, "", client_evidence, freelancer_evidence)
        .await?;

    let job_id_str = job
        .on_chain_job_id
        .map(|id| id.to_string())
        .unwrap_or_else(|| job_id.to_string());

    let on_chain_tx: Option<String> = if let Some(s) = stellar {
        Some(s.resolve_dispute(&job_id_str, verdict.freelancer_share_bps as u32).await?)
    } else {
        None
    };

    sqlx::query(
        "INSERT INTO verdicts (dispute_id, winner, freelancer_share_bps, reasoning, on_chain_tx)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(dispute_id)
    .bind(&verdict.winner)
    .bind(verdict.freelancer_share_bps)
    .bind(&verdict.reasoning)
    .bind(&on_chain_tx)
    .execute(pool)
    .await?;

    sqlx::query("UPDATE disputes SET status = 'resolved' WHERE id = $1")
        .bind(dispute_id)
        .execute(pool)
        .await?;

    tracing::info!(
        "dispute {dispute_id} resolved: winner={} tx={:?}",
        verdict.winner,
        on_chain_tx
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn test_judge_service_mocked() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/judge"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "winner": "freelancer",
                "freelancer_share_bps": 10000,
                "reasoning": "deliverables met"
            })))
            .mount(&mock_server)
            .await;

        std::env::set_var("JUDGE_API_URL", format!("{}/judge", mock_server.uri()));
        let judge = JudgeService::from_env();

        let verdict = judge
            .judge("build a webapp", "", vec![], vec!["here is the repo".to_string()])
            .await
            .unwrap();

        assert_eq!(verdict.winner, "freelancer");
        assert_eq!(verdict.freelancer_share_bps, 10000);
        assert_eq!(verdict.reasoning, "deliverables met");
    }
}
