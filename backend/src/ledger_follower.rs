use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use serde_json::Value;
use sqlx::PgPool;
use tracing::{debug, error, info, trace, warn};

use crate::indexer_metrics::metrics;
use crate::soroban_rpc::{parse_i64, RetryPolicy, SorobanRpcClient};

const DEFAULT_IDLE_POLL_MS: u64 = 2_000;
const DEFAULT_WORKER_RETRY_ATTEMPTS: u32 = 4;
const DEFAULT_WORKER_RETRY_INITIAL_BACKOFF_MS: u64 = 1_000;
const DEFAULT_WORKER_RETRY_MAX_BACKOFF_MS: u64 = 60_000;

#[derive(Clone, Debug)]
pub struct LedgerFollowerConfig {
    pub idle_poll_interval: Duration,
    pub worker_retry_policy: RetryPolicy,
}

impl LedgerFollowerConfig {
    pub fn from_env() -> Self {
        Self {
            idle_poll_interval: Duration::from_millis(
                std::env::var("INDEXER_IDLE_POLL_MS")
                    .ok()
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(DEFAULT_IDLE_POLL_MS),
            ),
            worker_retry_policy: RetryPolicy::from_env(
                "INDEXER_WORKER_RETRY",
                DEFAULT_WORKER_RETRY_ATTEMPTS,
                DEFAULT_WORKER_RETRY_INITIAL_BACKOFF_MS,
                DEFAULT_WORKER_RETRY_MAX_BACKOFF_MS,
            ),
        }
    }
}

pub struct LedgerCycle {
    pub checkpoint: i64,
    pub latest_network_ledger: i64,
    pub inserted_events: u64,
}

impl LedgerCycle {
    pub fn caught_up(&self) -> bool {
        self.checkpoint >= self.latest_network_ledger
    }
}

pub struct LedgerFollower {
    pool: PgPool,
    rpc: SorobanRpcClient,
    config: LedgerFollowerConfig,
}

impl LedgerFollower {
    pub fn new(pool: PgPool, rpc: SorobanRpcClient, config: LedgerFollowerConfig) -> Self {
        Self { pool, rpc, config }
    }

    pub async fn run(&mut self) {
        let mut worker_retry_attempt = 0u32;

        info!("indexer worker started; entering main processing loop");

        loop {
            let loop_started_at = Instant::now();

            trace!(worker_retry_attempt, "starting indexer cycle");

            match self.next_cycle().await {
                Ok(cycle) => {
                    worker_retry_attempt = 0;

                    let elapsed_ms = loop_started_at.elapsed().as_millis() as u64;
                    let elapsed_seconds = loop_started_at.elapsed().as_secs_f64();
                    let rate_per_second = if elapsed_ms == 0 {
                        cycle.inserted_events
                    } else {
                        cycle.inserted_events.saturating_mul(1_000) / elapsed_ms.max(1)
                    };

                    metrics()
                        .last_loop_duration_ms
                        .store(elapsed_ms, Ordering::Relaxed);
                    metrics()
                        .last_batch_events_processed
                        .store(cycle.inserted_events, Ordering::Relaxed);
                    metrics()
                        .last_batch_rate_per_second
                        .store(rate_per_second, Ordering::Relaxed);

                    use crate::indexer_metrics::{
                        LAST_PROCESSED_LEDGER_GAUGE, LEDGER_LAG_GAUGE, PROCESSING_LATENCY_HISTOGRAM,
                    };
                    PROCESSING_LATENCY_HISTOGRAM.observe(elapsed_seconds);
                    LAST_PROCESSED_LEDGER_GAUGE.set(cycle.checkpoint);
                    let lag = cycle.latest_network_ledger.saturating_sub(cycle.checkpoint);
                    LEDGER_LAG_GAUGE.set(lag);

                    info!(
                        checkpoint = cycle.checkpoint,
                        latest_network_ledger = cycle.latest_network_ledger,
                        ledger_lag = lag,
                        inserted_events = cycle.inserted_events,
                        elapsed_ms,
                        rate_per_second,
                        "indexer cycle completed successfully"
                    );

                    if cycle.caught_up() {
                        debug!(
                            checkpoint = cycle.checkpoint,
                            latest_network_ledger = cycle.latest_network_ledger,
                            sleep_ms = self.config.idle_poll_interval.as_millis() as u64,
                            "indexer caught up; idling",
                        );
                        tokio::time::sleep(self.config.idle_poll_interval).await;
                    }
                }
                Err(err) => {
                    worker_retry_attempt = worker_retry_attempt.saturating_add(1);
                    metrics().total_errors.fetch_add(1, Ordering::Relaxed);

                    use crate::indexer_metrics::ERROR_COUNTER;
                    ERROR_COUNTER.inc();

                    let backoff = self
                        .config
                        .worker_retry_policy
                        .delay_for_attempt(worker_retry_attempt.saturating_sub(1));

                    error!(
                        attempt = worker_retry_attempt,
                        max_attempts = self.config.worker_retry_policy.max_attempts,
                        backoff_ms = backoff.as_millis() as u64,
                        error = %err,
                        error_debug = ?err,
                        "indexer worker cycle failed",
                    );

                    tokio::time::sleep(backoff).await;
                }
            }
        }
    }

    #[tracing::instrument(skip(self))]
    pub async fn next_cycle(&mut self) -> Result<LedgerCycle> {
        debug!("reading checkpoint from database");
        let mut last_processed_ledger: i64 =
            sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state WHERE id = 1")
                .fetch_optional(&self.pool)
                .await?
                .unwrap_or(0);

        debug!(last_processed_ledger, "checkpoint read from database");

        if last_processed_ledger == 0 {
            info!("no checkpoint found; initializing from latest network ledger");
            let latest_network_ledger = self.rpc.get_latest_ledger().await?;

            debug!(
                latest_network_ledger,
                "writing initial checkpoint to database"
            );

            sqlx::query(
                "INSERT INTO indexer_state (id, last_processed_ledger, updated_at)
                 VALUES (1, $1, NOW())
                 ON CONFLICT (id)
                 DO UPDATE SET last_processed_ledger = EXCLUDED.last_processed_ledger, updated_at = NOW()",
            )
            .bind(latest_network_ledger)
            .execute(&self.pool)
            .await?;

            metrics()
                .last_processed_ledger
                .store(latest_network_ledger, Ordering::Relaxed);

            info!(
                checkpoint = latest_network_ledger,
                "indexer initialized checkpoint from latest network ledger",
            );

            return Ok(LedgerCycle {
                checkpoint: latest_network_ledger,
                latest_network_ledger,
                inserted_events: 0,
            });
        }

        let start_ledger = last_processed_ledger + 1;
        debug!(
            start_ledger,
            last_processed_ledger, "fetching events from RPC"
        );

        let events_response = self.rpc.get_events(start_ledger).await?;

        debug!(
            start_ledger,
            latest_network_ledger = events_response.latest_network_ledger,
            event_count = events_response.events.len(),
            "received events from RPC"
        );

        if events_response.latest_network_ledger < start_ledger {
            debug!(
                latest_network_ledger = events_response.latest_network_ledger,
                start_ledger, "network ledger behind start ledger; no events to process"
            );

            metrics()
                .last_processed_ledger
                .store(last_processed_ledger, Ordering::Relaxed);

            return Ok(LedgerCycle {
                checkpoint: last_processed_ledger,
                latest_network_ledger: events_response.latest_network_ledger,
                inserted_events: 0,
            });
        }

        debug!(
            event_count = events_response.events.len(),
            "beginning database transaction"
        );
        let mut transaction = self.pool.begin().await?;
        let mut inserted_events = 0u64;
        let mut max_seen_ledger = start_ledger.saturating_sub(1);

        for event in &events_response.events {
            let ledger = event
                .get("ledger")
                .and_then(parse_i64)
                .unwrap_or(start_ledger);
            let event_id = event.get("id").and_then(Value::as_str).unwrap_or_default();
            let contract_id = event
                .get("contractId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let topic_hash = event
                .get("topic")
                .and_then(Value::as_array)
                .and_then(|topics| topics.first())
                .and_then(Value::as_str)
                .unwrap_or_default();

            if event_id.is_empty() {
                warn!(ledger, "skipping event with empty id");
                continue;
            }

            max_seen_ledger = max_seen_ledger.max(ledger);

            trace!(
                event_id,
                ledger,
                contract_id,
                topic_hash,
                "processing event"
            );

            let inserted = sqlx::query(
                "INSERT INTO indexed_events (id, ledger_amount, contract_id, topic_hash)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (id) DO NOTHING",
            )
            .bind(event_id)
            .bind(ledger)
            .bind(contract_id)
            .bind(topic_hash)
            .execute(&mut *transaction)
            .await?;

            if inserted.rows_affected() == 0 {
                debug!(event_id, ledger, "skipping already-indexed event");
                continue;
            }

            inserted_events = inserted_events.saturating_add(1);
            metrics()
                .total_events_processed
                .fetch_add(1, Ordering::Relaxed);

            use crate::indexer_metrics::EVENT_PROCESSING_COUNTER;
            EVENT_PROCESSING_COUNTER.inc();

            trace!(event_id, ledger, "processing side effects for event");

            process_event_side_effects(&mut transaction, event)
                .await
                .with_context(|| format!("processing side effects for event {event_id}"))?;
        }

        let next_checkpoint = if max_seen_ledger >= start_ledger {
            max_seen_ledger
        } else {
            start_ledger
        };

        debug!(
            next_checkpoint,
            previous_checkpoint = last_processed_ledger,
            "updating checkpoint in database"
        );

        sqlx::query(
            "INSERT INTO indexer_state (id, last_processed_ledger, updated_at)
             VALUES (1, $1, NOW())
             ON CONFLICT (id)
             DO UPDATE SET last_processed_ledger = EXCLUDED.last_processed_ledger, updated_at = NOW()",
        )
        .bind(next_checkpoint)
        .execute(&mut *transaction)
        .await?;

        debug!(inserted_events, next_checkpoint, "committing transaction");
        transaction.commit().await?;

        last_processed_ledger = next_checkpoint;
        metrics()
            .last_processed_ledger
            .store(last_processed_ledger, Ordering::Relaxed);

        info!(
            checkpoint = last_processed_ledger,
            latest_network_ledger = events_response.latest_network_ledger,
            inserted_events,
            "indexer cycle committed",
        );

        Ok(LedgerCycle {
            checkpoint: last_processed_ledger,
            latest_network_ledger: events_response.latest_network_ledger,
            inserted_events,
        })
    }
}

#[tracing::instrument(skip(tx, event), fields(event_id = tracing::field::Empty))]
async fn process_event_side_effects(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    event: &Value,
) -> Result<()> {
    if let Some(id) = event.get("id").and_then(Value::as_str) {
        tracing::Span::current().record("event_id", id);
    }

    let topics = event.get("topic").and_then(Value::as_array);
    let first_topic = topics
        .and_then(|items| items.first())
        .and_then(Value::as_str)
        .unwrap_or("");

    trace!(event_type = first_topic, "processing event side effects");

    match first_topic {
        "jobpost" | "jobauto" => {
            let job_id = topics
                .and_then(|items| items.get(1))
                .and_then(Value::as_str)
                .unwrap_or("0")
                .parse::<i64>()
                .unwrap_or(0);

            info!(
                job_id,
                event_type = first_topic,
                "indexed job creation event"
            );
        }
        "bid" => {
            info!(event_type = "bid", "indexed bid submission event");
        }
        "accept" => {
            info!(event_type = "accept", "indexed bid acceptance event");
        }
        "deposit" => {
            let sender = topics
                .and_then(|items| items.get(1))
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let token = topics
                .and_then(|items| items.get(2))
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let amount = event
                .get("value")
                .and_then(|v| v.get("xdr"))
                .and_then(Value::as_str)
                .map(|_| 0i64)
                .unwrap_or(0);
            let event_id = event.get("id").and_then(Value::as_str).unwrap_or_default();
            let ledger = event.get("ledger").and_then(parse_i64).unwrap_or(0);
            let contract_id = event
                .get("contractId")
                .and_then(Value::as_str)
                .unwrap_or_default();

            debug!(
                event_id,
                ledger, contract_id, sender, token, amount, "inserting deposit record"
            );

            sqlx::query(
                "INSERT INTO deposits (id, ledger, contract_id, sender, amount, token)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (id) DO NOTHING",
            )
            .bind(event_id)
            .bind(ledger)
            .bind(contract_id)
            .bind(sender)
            .bind(amount)
            .bind(token)
            .execute(&mut **tx)
            .await
            .with_context(|| format!("failed to insert deposit record for event {event_id}"))?;

            info!(
                event_id,
                ledger, contract_id, sender, token, amount, "indexed deposit event"
            );
        }
        "releasemilestone" => {
            let event_id = event.get("id").and_then(Value::as_str).unwrap_or_default();
            let ledger = event.get("ledger").and_then(parse_i64).unwrap_or(0);
            let contract_id = event
                .get("contractId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let job_id = topics
                .and_then(|t| t.get(1))
                .and_then(Value::as_str)
                .unwrap_or("0")
                .parse::<i64>()
                .unwrap_or(0);
            let milestone_index = topics
                .and_then(|t| t.get(2))
                .and_then(Value::as_str)
                .unwrap_or("0")
                .parse::<i32>()
                .unwrap_or(0);
            let amount = topics
                .and_then(|t| t.get(3))
                .and_then(Value::as_str)
                .unwrap_or("0")
                .parse::<i64>()
                .unwrap_or(0);

            info!(
                event_id,
                ledger,
                contract_id,
                job_id,
                milestone_index,
                amount,
                "indexed ReleaseMilestone event",
            );

            sqlx::query(
                "INSERT INTO indexed_milestone_releases
                     (id, ledger, contract_id, job_id, milestone_index, amount)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (id) DO NOTHING",
            )
            .bind(event_id)
            .bind(ledger)
            .bind(contract_id)
            .bind(job_id)
            .bind(milestone_index)
            .bind(amount)
            .execute(&mut **tx)
            .await?;

            // Best-effort: sync the milestone status in our DB if we can match it.
            // The on_chain_job_id on jobs links the chain job_id to our UUID.
            sqlx::query(
                "UPDATE milestones m
                 SET status       = 'released',
                     released_at  = COALESCE(released_at, NOW()),
                     completed_at = COALESCE(completed_at, NOW())
                 FROM jobs j
                 WHERE j.id = m.job_id
                   AND j.on_chain_job_id = $1
                   AND m.index = $2
                   AND m.status = 'pending'",
            )
            .bind(job_id)
            .bind(milestone_index)
            .execute(&mut **tx)
            .await?;
        }
        "dispute" | "disputeopened" => {
            let event_id = event.get("id").and_then(Value::as_str).unwrap_or_default();
            let ledger = event.get("ledger").and_then(parse_i64).unwrap_or(0);
            let contract_id = event
                .get("contractId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let job_id = topics
                .and_then(|items| items.get(1))
                .and_then(Value::as_str)
                .unwrap_or("0")
                .parse::<i64>()
                .unwrap_or(0);
            let opened_by = topics
                .and_then(|items| items.get(2))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();

            debug!(
                event_id,
                ledger, contract_id, job_id, opened_by, "inserting dispute record"
            );

            sqlx::query(
                "INSERT INTO indexed_disputes (id, ledger, contract_id, job_id, opened_by, event_type)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (id) DO NOTHING",
            )
            .bind(event_id)
            .bind(ledger)
            .bind(contract_id)
            .bind(job_id)
            .bind(&opened_by)
            .bind("DisputeOpened")
            .execute(&mut **tx)
            .await
            .with_context(|| format!("failed to insert dispute record for event {event_id}"))?;

            info!(
                event_id,
                ledger, contract_id, job_id, opened_by, "indexed DisputeOpened event"
            );
        }
        _ => {
            trace!(event_type = first_topic, "no side effects for event type");
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use crate::soroban_rpc::{RetryPolicy, RpcClientConfig};
    use reqwest::Client;

    fn test_rpc_config(rpc_url: String) -> RpcClientConfig {
        RpcClientConfig {
            url: rpc_url,
            rate_limit_interval: Duration::ZERO,
            retry_policy: RetryPolicy {
                max_attempts: 2,
                initial_backoff: Duration::from_millis(1),
                max_backoff: Duration::from_millis(2),
            },
        }
    }

    fn test_follower_config() -> LedgerFollowerConfig {
        LedgerFollowerConfig {
            idle_poll_interval: Duration::from_millis(1),
            worker_retry_policy: RetryPolicy {
                max_attempts: 2,
                initial_backoff: Duration::from_millis(1),
                max_backoff: Duration::from_millis(2),
            },
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn indexer_recovers_from_rpc_failure_and_resumes_from_checkpoint(pool: PgPool) {
        let mock_server = MockServer::start().await;

        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(41_i64)
            .execute(&pool)
            .await
            .unwrap();

        {
            let _guard = Mock::given(method("POST"))
                .and(path("/"))
                .respond_with(ResponseTemplate::new(500))
                .mount_as_scoped(&mock_server)
                .await;

            let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
            let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());
            assert!(follower.next_cycle().await.is_err());
        }

        let checkpoint_after_failure: i64 =
            sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(checkpoint_after_failure, 41);

        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "latestLedger": 42,
                    "events": [
                        {
                            "id": "evt-42",
                            "ledger": "42",
                            "contractId": "CDUMMY",
                            "topic": ["deposit", "GABC123", "USDC"],
                            "value": { "xdr": "AAAA" }
                        }
                    ]
                }
            })))
            .mount(&mock_server)
            .await;

        let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());
        let cycle = follower.next_cycle().await.unwrap();

        assert_eq!(cycle.checkpoint, 42);
        assert_eq!(cycle.latest_network_ledger, 42);
        assert_eq!(cycle.inserted_events, 1);

        let checkpoint_after_recovery: i64 =
            sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(checkpoint_after_recovery, 42);

        let indexed_event_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM indexed_events")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(indexed_event_count, 1);

        use sqlx::Row;
        let deposit_row = sqlx::query("SELECT sender, token FROM deposits WHERE id = 'evt-42'")
            .fetch_one(&pool)
            .await
            .unwrap();

        assert_eq!(deposit_row.get::<String, _>("sender"), "GABC123");
        assert_eq!(deposit_row.get::<String, _>("token"), "USDC");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn indexer_advances_empty_ledger_checkpoints_without_skipping(pool: PgPool) {
        let mock_server = MockServer::start().await;

        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(9_i64)
            .execute(&pool)
            .await
            .unwrap();

        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "latestLedger": 11,
                    "events": []
                }
            })))
            .mount(&mock_server)
            .await;

        let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());
        let cycle = follower.next_cycle().await.unwrap();

        assert_eq!(cycle.checkpoint, 10);
        assert_eq!(cycle.latest_network_ledger, 11);
        assert_eq!(cycle.inserted_events, 0);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn indexer_processes_milestone_released_event(pool: PgPool) {
        let mock_server = MockServer::start().await;

        // Seed a job with on_chain_job_id=7 and one pending milestone at index 0
        let job_id: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO jobs (title, description, budget_usdc, milestones, client_address, on_chain_job_id)
             VALUES ('Test', '', 9000, 1, 'GCLIENT', 7) RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO milestones (job_id, index, title, amount_usdc, status)
             VALUES ($1, 0, 'M1', 3000, 'pending')",
        )
        .bind(job_id)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query("UPDATE indexer_state SET last_processed_ledger = 49 WHERE id = 1")
            .execute(&pool)
            .await
            .unwrap();

        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "latestLedger": 50,
                    "events": [{
                        "id": "evt-release-1",
                        "ledger": "50",
                        "contractId": "CESCROW",
                        "topic": ["releasemilestone", "7", "0", "3000"],
                        "value": { "xdr": "AAAA" }
                    }]
                }
            })))
            .mount(&mock_server)
            .await;

        let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());
        let cycle = follower.next_cycle().await.unwrap();

        assert_eq!(cycle.inserted_events, 1);

        // indexed_milestone_releases row created
        let release_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM indexed_milestone_releases WHERE id = 'evt-release-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(release_count, 1);

        // milestone status synced to released
        let status: String =
            sqlx::query_scalar("SELECT status FROM milestones WHERE job_id = $1 AND index = 0")
                .bind(job_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "released");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn indexer_is_idempotent_on_duplicate_events(pool: PgPool) {
        let mock_server = MockServer::start().await;

        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(99_i64)
            .execute(&pool)
            .await
            .unwrap();

        let event_payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "latestLedger": 100,
                "events": [
                    {
                        "id": "evt-dup",
                        "ledger": "100",
                        "contractId": "CDUMMY",
                        "topic": ["deposit", "GADDR", "USDC"],
                        "value": { "xdr": "AAAA" }
                    }
                ]
            }
        });

        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(event_payload.clone()))
            .expect(2)
            .mount(&mock_server)
            .await;

        let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());
        let cycle1 = follower.next_cycle().await.unwrap();
        assert_eq!(cycle1.inserted_events, 1);

        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(99_i64)
            .execute(&pool)
            .await
            .unwrap();

        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(event_payload))
            .mount(&mock_server)
            .await;

        let rpc2 = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        follower = LedgerFollower::new(pool.clone(), rpc2, test_follower_config());
        let cycle2 = follower.next_cycle().await.unwrap();
        assert_eq!(
            cycle2.inserted_events, 0,
            "re-processing should insert nothing"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn worker_recovers_from_multiple_rpc_failures_and_resumes(pool: PgPool) {
        let mock_server = MockServer::start().await;

        // Set initial checkpoint
        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(100_i64)
            .execute(&pool)
            .await
            .unwrap();

        // First attempt: RPC returns 500 error
        {
            let _guard = Mock::given(method("POST"))
                .and(path("/"))
                .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
                .mount_as_scoped(&mock_server)
                .await;

            let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
            let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());
            let result = follower.next_cycle().await;
            assert!(result.is_err(), "Should fail on RPC error");
        }

        // Verify checkpoint unchanged after failure
        let checkpoint_after_first_failure: i64 =
            sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            checkpoint_after_first_failure, 100,
            "Checkpoint should not advance on failure"
        );

        // Second attempt: RPC returns 429 rate limit
        {
            let _guard = Mock::given(method("POST"))
                .and(path("/"))
                .respond_with(ResponseTemplate::new(429).set_body_string("Too Many Requests"))
                .mount_as_scoped(&mock_server)
                .await;

            let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
            let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());
            let result = follower.next_cycle().await;
            assert!(result.is_err(), "Should fail on rate limit");
        }

        // Verify checkpoint still unchanged
        let checkpoint_after_second_failure: i64 =
            sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            checkpoint_after_second_failure, 100,
            "Checkpoint should remain unchanged"
        );

        // Third attempt: RPC succeeds
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "latestLedger": 103,
                    "events": [
                        {
                            "id": "evt-101",
                            "ledger": "101",
                            "contractId": "CTEST",
                            "topic": ["deposit", "GUSER", "XLM"],
                            "value": { "xdr": "AAAA" }
                        }
                    ]
                }
            })))
            .mount(&mock_server)
            .await;

        let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());
        let cycle = follower.next_cycle().await.unwrap();

        // Verify successful recovery
        assert_eq!(cycle.checkpoint, 101, "Should process ledger 101");
        assert_eq!(cycle.inserted_events, 1, "Should insert 1 event");

        let checkpoint_after_recovery: i64 =
            sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            checkpoint_after_recovery, 101,
            "Checkpoint should advance to 101"
        );

        // Verify event was indexed
        let event_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM indexed_events WHERE id = 'evt-101'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(event_count, 1, "Event should be indexed");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn idempotency_holds_for_multiple_event_types(pool: PgPool) {
        let mock_server = MockServer::start().await;

        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(199_i64)
            .execute(&pool)
            .await
            .unwrap();

        let event_payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "latestLedger": 200,
                "events": [
                    {
                        "id": "evt-deposit-200",
                        "ledger": "200",
                        "contractId": "CTEST",
                        "topic": ["deposit", "GUSER1", "USDC"],
                        "value": { "xdr": "AAAA" }
                    },
                    {
                        "id": "evt-dispute-200",
                        "ledger": "200",
                        "contractId": "CTEST",
                        "topic": ["disputeopened", "123", "GUSER2"],
                        "value": { "xdr": "BBBB" }
                    },
                    {
                        "id": "evt-job-200",
                        "ledger": "200",
                        "contractId": "CTEST",
                        "topic": ["jobpost", "456"],
                        "value": { "xdr": "CCCC" }
                    }
                ]
            }
        });

        // First processing
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(event_payload.clone()))
            .expect(2)
            .mount(&mock_server)
            .await;

        let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());
        let cycle1 = follower.next_cycle().await.unwrap();
        assert_eq!(
            cycle1.inserted_events, 3,
            "Should insert 3 events on first pass"
        );

        // Verify all events were indexed
        let indexed_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM indexed_events WHERE ledger_amount = 200")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(indexed_count, 3, "All 3 events should be in indexed_events");

        // Verify deposit side effect
        let deposit_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM deposits WHERE id = 'evt-deposit-200'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(deposit_count, 1, "Deposit should be recorded");

        // Verify dispute side effect
        let dispute_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM indexed_disputes WHERE id = 'evt-dispute-200'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(dispute_count, 1, "Dispute should be recorded");

        // Reset checkpoint to re-process same ledger
        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(199_i64)
            .execute(&pool)
            .await
            .unwrap();

        // Second processing (re-process same ledger)
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(event_payload))
            .mount(&mock_server)
            .await;

        let rpc2 = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        follower = LedgerFollower::new(pool.clone(), rpc2, test_follower_config());
        let cycle2 = follower.next_cycle().await.unwrap();
        assert_eq!(
            cycle2.inserted_events, 0,
            "Should insert 0 events on re-processing"
        );

        // Verify no duplicate events
        let indexed_count_after: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM indexed_events WHERE ledger_amount = 200")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(indexed_count_after, 3, "Should still have exactly 3 events");

        // Verify no duplicate deposits
        let deposit_count_after: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM deposits WHERE id = 'evt-deposit-200'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            deposit_count_after, 1,
            "Should still have exactly 1 deposit"
        );

        // Verify no duplicate disputes
        let dispute_count_after: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM indexed_disputes WHERE id = 'evt-dispute-200'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            dispute_count_after, 1,
            "Should still have exactly 1 dispute"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn idempotency_holds_across_transaction_boundaries(pool: PgPool) {
        let mock_server = MockServer::start().await;

        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(299_i64)
            .execute(&pool)
            .await
            .unwrap();

        let event_payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "latestLedger": 300,
                "events": [
                    {
                        "id": "evt-300-1",
                        "ledger": "300",
                        "contractId": "CTEST",
                        "topic": ["deposit", "GUSER", "USDC"],
                        "value": { "xdr": "AAAA" }
                    },
                    {
                        "id": "evt-300-2",
                        "ledger": "300",
                        "contractId": "CTEST",
                        "topic": ["deposit", "GUSER", "XLM"],
                        "value": { "xdr": "BBBB" }
                    }
                ]
            }
        });

        // Process first time
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(event_payload.clone()))
            .mount(&mock_server)
            .await;

        let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());
        let cycle1 = follower.next_cycle().await.unwrap();
        assert_eq!(cycle1.inserted_events, 2);

        // Manually insert one of the events again (simulating partial transaction)
        let manual_insert_result = sqlx::query(
            "INSERT INTO indexed_events (id, ledger_amount, contract_id, topic_hash)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO NOTHING",
        )
        .bind("evt-300-1")
        .bind(300_i64)
        .bind("CTEST")
        .bind("deposit")
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            manual_insert_result.rows_affected(),
            0,
            "Should not insert duplicate"
        );

        // Reset checkpoint and re-process
        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(299_i64)
            .execute(&pool)
            .await
            .unwrap();

        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(event_payload))
            .mount(&mock_server)
            .await;

        let rpc2 = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        follower = LedgerFollower::new(pool.clone(), rpc2, test_follower_config());
        let cycle2 = follower.next_cycle().await.unwrap();
        assert_eq!(
            cycle2.inserted_events, 0,
            "Should skip all duplicate events"
        );

        // Verify exactly 2 events exist
        let total_events: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM indexed_events WHERE ledger_amount = 300")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(total_events, 2, "Should have exactly 2 events");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn prometheus_metrics_update_after_successful_cycle(pool: PgPool) {
        use std::sync::atomic::Ordering;

        let mock_server = MockServer::start().await;

        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(499_i64)
            .execute(&pool)
            .await
            .unwrap();

        // Record initial metrics
        let initial_events = metrics().total_events_processed.load(Ordering::Relaxed);

        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "latestLedger": 502,
                    "events": [
                        {
                            "id": "evt-500-1",
                            "ledger": "500",
                            "contractId": "CTEST",
                            "topic": ["deposit", "GUSER", "USDC"],
                            "value": { "xdr": "AAAA" }
                        },
                        {
                            "id": "evt-500-2",
                            "ledger": "500",
                            "contractId": "CTEST",
                            "topic": ["deposit", "GUSER", "XLM"],
                            "value": { "xdr": "BBBB" }
                        },
                        {
                            "id": "evt-500-3",
                            "ledger": "500",
                            "contractId": "CTEST",
                            "topic": ["bid"],
                            "value": { "xdr": "CCCC" }
                        }
                    ]
                }
            })))
            .mount(&mock_server)
            .await;

        let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());
        let cycle = follower.next_cycle().await.unwrap();

        assert_eq!(cycle.inserted_events, 3);
        assert_eq!(cycle.checkpoint, 500);

        // Verify metrics updated
        let events_after = metrics().total_events_processed.load(Ordering::Relaxed);
        assert_eq!(
            events_after,
            initial_events + 3,
            "total_events_processed should increase by 3"
        );

        let last_processed = metrics().last_processed_ledger.load(Ordering::Relaxed);
        assert_eq!(
            last_processed, 500,
            "last_processed_ledger should be updated to 500"
        );

        let last_network = metrics().last_network_ledger.load(Ordering::Relaxed);
        assert_eq!(
            last_network, 502,
            "last_network_ledger should be updated to 502"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn prometheus_metrics_reflect_idempotent_reprocessing(pool: PgPool) {
        use std::sync::atomic::Ordering;

        let mock_server = MockServer::start().await;

        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(699_i64)
            .execute(&pool)
            .await
            .unwrap();

        let event_payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "latestLedger": 700,
                "events": [
                    {
                        "id": "evt-700",
                        "ledger": "700",
                        "contractId": "CTEST",
                        "topic": ["deposit", "GUSER", "USDC"],
                        "value": { "xdr": "AAAA" }
                    }
                ]
            }
        });

        // First processing
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(event_payload.clone()))
            .mount(&mock_server)
            .await;

        let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());
        let cycle1 = follower.next_cycle().await.unwrap();
        assert_eq!(cycle1.inserted_events, 1);

        let events_after_first = metrics().total_events_processed.load(Ordering::Relaxed);

        // Reset checkpoint to re-process
        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(699_i64)
            .execute(&pool)
            .await
            .unwrap();

        // Second processing (idempotent)
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(event_payload))
            .mount(&mock_server)
            .await;

        let rpc2 = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        follower = LedgerFollower::new(pool.clone(), rpc2, test_follower_config());
        let cycle2 = follower.next_cycle().await.unwrap();
        assert_eq!(
            cycle2.inserted_events, 0,
            "Should not insert duplicate events"
        );

        let events_after_second = metrics().total_events_processed.load(Ordering::Relaxed);
        assert_eq!(
            events_after_second, events_after_first,
            "total_events_processed should not increase when re-processing duplicates"
        );

        // Verify checkpoint still advances even with no new events
        let checkpoint = metrics().last_processed_ledger.load(Ordering::Relaxed);
        assert_eq!(
            checkpoint, 700,
            "checkpoint should advance even when skipping duplicates"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn worker_maintains_checkpoint_consistency_across_failures(pool: PgPool) {
        let mock_server = MockServer::start().await;

        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(799_i64)
            .execute(&pool)
            .await
            .unwrap();

        // Attempt 1: Fail during RPC call
        {
            let _guard = Mock::given(method("POST"))
                .and(path("/"))
                .respond_with(ResponseTemplate::new(503).set_body_string("Service Unavailable"))
                .mount_as_scoped(&mock_server)
                .await;

            let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
            let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());
            assert!(follower.next_cycle().await.is_err());
        }

        let checkpoint1: i64 =
            sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            checkpoint1, 799,
            "Checkpoint should not change on RPC failure"
        );

        // Attempt 2: Succeed
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "latestLedger": 802,
                    "events": [
                        {
                            "id": "evt-800",
                            "ledger": "800",
                            "contractId": "CTEST",
                            "topic": ["deposit", "GUSER", "USDC"],
                            "value": { "xdr": "AAAA" }
                        }
                    ]
                }
            })))
            .mount(&mock_server)
            .await;

        let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());
        let cycle = follower.next_cycle().await.unwrap();
        assert_eq!(cycle.checkpoint, 800);
        assert_eq!(cycle.inserted_events, 1);

        let checkpoint2: i64 =
            sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            checkpoint2, 800,
            "Checkpoint should advance to 800 after success"
        );

        // Verify event was indexed
        let event_exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM indexed_events WHERE id = 'evt-800')")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(event_exists, "Event should be indexed");

        // Attempt 3: Process next ledger
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "latestLedger": 803,
                    "events": [
                        {
                            "id": "evt-801",
                            "ledger": "801",
                            "contractId": "CTEST",
                            "topic": ["bid"],
                            "value": { "xdr": "BBBB" }
                        }
                    ]
                }
            })))
            .mount(&mock_server)
            .await;

        let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());
        let cycle = follower.next_cycle().await.unwrap();
        assert_eq!(cycle.checkpoint, 801);

        let checkpoint3: i64 =
            sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            checkpoint3, 801,
            "Checkpoint should continue advancing sequentially"
        );

        // Verify no ledgers were skipped
        let ledger_800_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM indexed_events WHERE ledger_amount = 800)",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let ledger_801_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM indexed_events WHERE ledger_amount = 801)",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(ledger_800_exists, "Ledger 800 should be indexed");
        assert!(ledger_801_exists, "Ledger 801 should be indexed");
    }
}
