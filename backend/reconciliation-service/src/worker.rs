use crate::{
    metrics::Metrics, models::IndexedEventRecord, repository::Repository, rpc::StellarRpcClient,
};
use std::{sync::Arc, time::Duration};
use tokio::sync::RwLock;
use tracing::{error, info, warn};

#[derive(Clone, Debug)]
pub struct WorkerContext {
    pub repository: Repository,
    pub rpc: StellarRpcClient,
    pub metrics: Arc<Metrics>,
    pub snapshot: Arc<RwLock<crate::models::SyncSnapshot>>,
    pub poll_interval: Duration,
}

pub fn spawn(context: WorkerContext) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(context.poll_interval);

        loop {
            interval.tick().await;

            if let Err(error) = run_once(&context).await {
                context.metrics.record_error();
                {
                    let mut snapshot = context.snapshot.write().await;
                    snapshot.record_error(error.to_string());
                }

                error!(error = %error, "worker iteration failed");
            }
        }
    })
}

pub async fn run_once(context: &WorkerContext) -> anyhow::Result<()> {
    let checkpoint = context.repository.load_checkpoint().await?;
    let latest = context.rpc.latest_ledger().await?;

    if latest < checkpoint {
        warn!(
            checkpoint,
            latest, "rpc returned a ledger lower than the stored checkpoint"
        );
    }

    if latest > checkpoint {
        info!(checkpoint, latest, "processing new ledgers");

        for ledger_sequence in (checkpoint + 1)..=latest {
            let raw_ledger = context.rpc.fetch_ledger(ledger_sequence).await?;
            let event = IndexedEventRecord {
                event_key: format!("ledger:{ledger_sequence}"),
                ledger_sequence,
                event_type: "ledger_snapshot".to_string(),
                payload: raw_ledger,
            };

            let _inserted = context.repository.insert_indexed_event(&event).await?;
            context.repository.store_checkpoint(ledger_sequence).await?;
            context.metrics.record_success(ledger_sequence, latest);

            let mut snapshot = context.snapshot.write().await;
            snapshot.update_success(ledger_sequence, latest);
        }
    } else {
        context.metrics.record_success(checkpoint, latest);

        let mut snapshot = context.snapshot.write().await;
        snapshot.update_success(checkpoint, latest);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db, repository::Repository, rpc::RetryConfig};
    use serde_json::json;
    use std::time::Duration;
    use tokio::time::sleep;
    use wiremock::matchers::{body_string_contains, method};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    // This test requires a real Postgres DATABASE_URL in the environment. If absent, skip.
    #[tokio::test]
    async fn worker_recovers_after_rpc_failures() -> anyhow::Result<()> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(v) => v,
            Err(_) => {
                eprintln!("DATABASE_URL not set; skipping integration test");
                return Ok(());
            }
        };

        // Start a mock RPC server
        let mock_server = MockServer::start().await;

        // Initial behaviour: latest ledger = 2, ledger 1 succeeds, ledger 2 fails (500)
        let latest_response = json!({"result": 2, "error": null});

        Mock::given(method("POST"))
            .and(body_string_contains("\"method\":\"getLatestLedger\""))
            .respond_with(ResponseTemplate::new(200).set_body_json(&latest_response))
            .mount(&mock_server)
            .await;

        let ledger1_payload = json!({"sequence": 1, "data": "ledger1"});
        Mock::given(method("POST"))
            .and(body_string_contains("\"method\":\"getLedger\""))
            .and(body_string_contains("\"sequence\": 1"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"result": ledger1_payload, "error": null})),
            )
            .mount(&mock_server)
            .await;

        // Ledger 2 will fail for the first run
        Mock::given(method("POST"))
            .and(body_string_contains("\"method\":\"getLedger\""))
            .and(body_string_contains("\"sequence\": 2"))
            .respond_with(ResponseTemplate::new(500).set_body_string("server error"))
            .mount(&mock_server)
            .await;

        // Connect DB and run migrations
        let pool = db::connect(&database_url).await?;
        db::run_migrations(&pool).await?;

        let repo = Repository::new(pool.clone());
        repo.ensure_checkpoint_row().await?;
        repo.store_checkpoint(0).await?;

        // Create client with fast retry/backoff for test speed
        let rpc_client = crate::rpc::StellarRpcClient::new(
            mock_server.uri(),
            RetryConfig {
                max_attempts: 2,
                initial_backoff: Duration::from_millis(10),
                max_backoff: Duration::from_millis(20),
            },
        )?;

        let metrics = std::sync::Arc::new(crate::metrics::Metrics::new()?);
        let snapshot = std::sync::Arc::new(tokio::sync::RwLock::new(
            crate::models::SyncSnapshot::new(0),
        ));

        let context = WorkerContext {
            repository: repo.clone(),
            rpc: rpc_client.clone(),
            metrics: metrics.clone(),
            snapshot: snapshot.clone(),
            poll_interval: Duration::from_millis(50),
        };

        // First run: ledger 1 should be processed; ledger 2 will fail, leaving checkpoint at 1
        let res = run_once(&context).await;
        assert!(
            res.is_err(),
            "expected run_once to return error due to ledger 2 failure"
        );

        let checkpoint = repo.load_checkpoint().await?;
        assert_eq!(
            checkpoint, 1,
            "checkpoint should have advanced to 1 after partial processing"
        );

        // Now reset mocks and make ledger 2 succeed
        mock_server.reset().await;

        Mock::given(method("POST"))
            .and(body_string_contains("\"method\":\"getLatestLedger\""))
            .respond_with(ResponseTemplate::new(200).set_body_json(&latest_response))
            .mount(&mock_server)
            .await;

        let ledger2_payload = json!({"sequence": 2, "data": "ledger2"});
        Mock::given(method("POST"))
            .and(body_string_contains("\"method\":\"getLedger\""))
            .and(body_string_contains("\"sequence\": 2"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"result": ledger2_payload, "error": null})),
            )
            .mount(&mock_server)
            .await;

        // Second run should succeed fully
        let res2 = run_once(&context).await;
        assert!(
            res2.is_ok(),
            "expected second run_once to succeed after RPC recovery"
        );

        let checkpoint2 = repo.load_checkpoint().await?;
        assert_eq!(
            checkpoint2, 2,
            "checkpoint should be 2 after processing ledger 2"
        );

        // Verify an indexed event for ledger:2 exists
        let found: Option<i64> =
            sqlx::query_scalar("SELECT id FROM indexed_events WHERE event_key = $1")
                .bind("ledger:2")
                .fetch_optional(&pool)
                .await?;

        assert!(found.is_some(), "indexed event for ledger:2 should exist");

        Ok(())
    }
}
