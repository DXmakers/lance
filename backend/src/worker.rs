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
            tracing::error!(error = %e, "judge worker cycle failed");
        }
        tokio::time::sleep(Duration::from_secs(30)).await;
    }
}

async fn process_open_disputes(
    pool: &PgPool,
    judge: &JudgeService,
    stellar: Option<&StellarService>,
) -> anyhow::Result<()> {
    let disputes: Vec<(Uuid, Uuid)> =
        sqlx::query_as("SELECT id, job_id FROM disputes WHERE status = 'open'")
            .fetch_all(pool)
            .await?;

    for (dispute_id, job_id) in disputes {
        if let Err(e) = process_dispute(pool, judge, stellar, dispute_id, job_id).await {
            tracing::error!(
                %dispute_id,
                %job_id,
                error = %e,
                "dispute processing failed",
            );
            if let Err(e2) = sqlx::query("UPDATE disputes SET status = 'open' WHERE id = $1")
                .bind(dispute_id)
                .execute(pool)
                .await
            {
                tracing::error!(
                    %dispute_id,
                    error = %e2,
                    "dispute status reset failed",
                );
            }
        }
    }
    Ok(())
}

#[tracing::instrument(skip(pool, judge, stellar), fields(%dispute_id, %job_id))]
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
        on_chain_job_id: Option<i64>,
    }

    let job = sqlx::query_as::<_, JobRow>("SELECT on_chain_job_id FROM jobs WHERE id = $1")
        .bind(job_id)
        .fetch_one(pool)
        .await?;

    let verdict = judge.judge(pool, dispute_id).await?;

    let freelancer_share_bps = verdict.freelancer_share_bps.clamp(0, 10_000) as i128;

    let remaining_amount_usdc: i64 = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(amount_usdc), 0)
           FROM milestones
           WHERE job_id = $1 AND status = 'pending'"#,
    )
    .bind(job_id)
    .fetch_one(pool)
    .await?;

    let remaining_i128 = i128::from(remaining_amount_usdc);
    let freelancer_amount = (remaining_i128 * freelancer_share_bps) / 10_000;
    let client_amount = remaining_i128 - freelancer_amount;

    let on_chain_tx: Option<String> = if let Some(s) = stellar {
        let on_chain_job_id = job
            .on_chain_job_id
            .ok_or_else(|| anyhow::anyhow!("job {job_id} missing on_chain_job_id"))?;
        let on_chain_job_id = u64::try_from(on_chain_job_id)
            .map_err(|_| anyhow::anyhow!("job {job_id} has invalid negative on_chain_job_id"))?;

        Some(
            s.resolve_dispute(on_chain_job_id, freelancer_amount, client_amount)
                .await?,
        )
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
        %dispute_id,
        winner = %verdict.winner,
        on_chain_tx = ?on_chain_tx,
        "dispute resolved",
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::judge::{CaseFile, JobContext};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn test_judge_service_mocked() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/analyze"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "winner": "freelancer",
                "freelancer_share_bps": 10000,
                "reasoning": "deliverables met"
            })))
            .mount(&mock_server)
            .await;

        std::env::set_var("OPENCLAW_API_URL", mock_server.uri());
        let judge = JudgeService::from_env();

        let case_file = CaseFile {
            dispute_id: Uuid::new_v4(),
            job_context: JobContext {
                title: "Test".to_string(),
                description: "Test".to_string(),
                budget_usdc: 1000,
                milestones: vec![],
            },
            evidence: vec![],
        };

        let verdict = judge.judge_case_file(case_file).await.unwrap();

        assert_eq!(verdict.winner, "freelancer");
        assert_eq!(verdict.freelancer_share_bps, 10000);
        assert_eq!(verdict.reasoning, "deliverables met");
    }
}
