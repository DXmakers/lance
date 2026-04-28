use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use serde_json::Value;
use sqlx::PgPool;
use tracing::{debug, error, info, warn};

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

        loop {
            let loop_started_at = Instant::now();

            match self.next_cycle().await {
                Ok(cycle) => {
                    worker_retry_attempt = 0;

                    let elapsed_ms = loop_started_at.elapsed().as_millis() as u64;
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

                    let backoff = self
                        .config
                        .worker_retry_policy
                        .delay_for_attempt(worker_retry_attempt.saturating_sub(1));

                    error!(
                        attempt = worker_retry_attempt,
                        backoff_ms = backoff.as_millis() as u64,
                        error = %err,
                        "indexer worker cycle failed",
                    );

                    tokio::time::sleep(backoff).await;
                }
            }
        }
    }

    pub async fn next_cycle(&mut self) -> Result<LedgerCycle> {
        let mut last_processed_ledger: i64 =
            sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state WHERE id = 1")
                .fetch_optional(&self.pool)
                .await?
                .unwrap_or(0);

        if last_processed_ledger == 0 {
            let latest_network_ledger = self.rpc.get_latest_ledger().await?;

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
        let events_response = self.rpc.get_events(start_ledger).await?;

        if events_response.latest_network_ledger < start_ledger {
            metrics()
                .last_processed_ledger
                .store(last_processed_ledger, Ordering::Relaxed);

            return Ok(LedgerCycle {
                checkpoint: last_processed_ledger,
                latest_network_ledger: events_response.latest_network_ledger,
                inserted_events: 0,
            });
        }

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

            process_event_side_effects(&mut transaction, event)
                .await
                .with_context(|| format!("processing side effects for event {event_id}"))?;
        }

        let next_checkpoint = if max_seen_ledger >= start_ledger {
            max_seen_ledger
        } else {
            start_ledger
        };

        sqlx::query(
            "INSERT INTO indexer_state (id, last_processed_ledger, updated_at)
             VALUES (1, $1, NOW())
             ON CONFLICT (id)
             DO UPDATE SET last_processed_ledger = EXCLUDED.last_processed_ledger, updated_at = NOW()",
        )
        .bind(next_checkpoint)
        .execute(&mut *transaction)
        .await?;

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

async fn process_event_side_effects(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    event: &Value,
) -> Result<()> {
    let topics = event.get("topic").and_then(Value::as_array);
    let first_topic = topics
        .and_then(|items| items.first())
        .and_then(Value::as_str)
        .unwrap_or("");

    match first_topic {
        "jobpost" | "jobauto" => {
            let job_id = topics
                .and_then(|items| items.get(1))
                .and_then(Value::as_str)
                .unwrap_or("0")
                .parse::<i64>()
                .unwrap_or(0);

            info!(job_id, "indexed job creation event");
        }
        "bid" => {
            info!("indexed bid submission event");
        }
        "accept" => {
            info!("indexed bid acceptance event");
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

            info!(
                event_id,
                ledger, contract_id, sender, token, amount, "indexed deposit event"
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

            info!(
                event_id,
                ledger, contract_id, job_id, opened_by, "indexed DisputeOpened event"
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
            .bind(opened_by)
            .bind("DisputeOpened")
            .execute(&mut **tx)
            .await?;
        }
        _ => {}
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
}
