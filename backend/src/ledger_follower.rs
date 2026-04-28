use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use serde_json::Value;
use sqlx::{PgPool, Postgres, Transaction};
use tracing::{debug, error, info, warn, instrument, Span};

use crate::indexer_metrics::metrics;
use crate::soroban_rpc::{parse_i64, CircuitBreakerConfig, RetryPolicy, SorobanRpcClient};

const DEFAULT_IDLE_POLL_MS: u64 = 1_000;
const DEFAULT_ACTIVE_POLL_MS: u64 = 500;
const DEFAULT_WORKER_RETRY_ATTEMPTS: u32 = 4;
const DEFAULT_WORKER_RETRY_INITIAL_BACKOFF_MS: u64 = 1_000;
const DEFAULT_WORKER_RETRY_MAX_BACKOFF_MS: u64 = 60_000;
const WORKER_VERSION: &str = "v1.2.0";
const TARGET_PROCESSING_TIME_MS: u64 = 5_000;

#[derive(Clone, Debug)]
pub struct LedgerFollowerConfig {
    pub idle_poll_interval: Duration,
    pub active_poll_interval: Duration,
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
            active_poll_interval: Duration::from_millis(
                std::env::var("INDEXER_ACTIVE_POLL_MS")
                    .ok()
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(DEFAULT_ACTIVE_POLL_MS),
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
    pub processing_time_ms: u64,
}

impl LedgerCycle {
    pub fn caught_up(&self) -> bool {
        self.checkpoint >= self.latest_network_ledger
    }

    pub fn is_lagging(&self) -> bool {
        self.latest_network_ledger - self.checkpoint > 10
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

    #[instrument(skip(self), fields(worker_version = WORKER_VERSION))]
    pub async fn run(&mut self) {
        let mut worker_retry_attempt = 0u32;

        info!(
            worker_version = WORKER_VERSION,
            target_processing_time_ms = TARGET_PROCESSING_TIME_MS,
            idle_poll_ms = self.config.idle_poll_interval.as_millis() as u64,
            active_poll_ms = self.config.active_poll_interval.as_millis() as u64,
            "ledger follower worker started"
        );

        loop {
            let loop_started_at = Instant::now();
            let cycle_span = tracing::info_span!(
                "indexer_cycle",
                attempt = worker_retry_attempt
            );
            let _enter = cycle_span.enter();

            match self.next_cycle().await {
                Ok(cycle) => {
                    worker_retry_attempt = 0;

                    let elapsed_ms = loop_started_at.elapsed().as_millis() as u64;
                    let rate_per_second = if elapsed_ms == 0 {
                        cycle.inserted_events
                    } else {
                        cycle.inserted_events.saturating_mul(1_000) / elapsed_ms.max(1)
                    };

                    // Record metrics
                    metrics().record_cycle_success(elapsed_ms, cycle.inserted_events);
                    metrics()
                        .last_loop_duration_ms
                        .store(elapsed_ms, Ordering::Relaxed);
                    metrics()
                        .last_batch_events_processed
                        .store(cycle.inserted_events, Ordering::Relaxed);
                    metrics()
                        .last_batch_rate_per_second
                        .store(rate_per_second, Ordering::Relaxed);

                    // Structured logging for cycle completion
                    info!(
                        checkpoint = cycle.checkpoint,
                        latest_network_ledger = cycle.latest_network_ledger,
                        ledger_lag = cycle.latest_network_ledger - cycle.checkpoint,
                        inserted_events = cycle.inserted_events,
                        processing_time_ms = cycle.processing_time_ms,
                        total_cycle_time_ms = elapsed_ms,
                        events_per_second = rate_per_second,
                        caught_up = cycle.caught_up(),
                        is_lagging = cycle.is_lagging(),
                        "indexer cycle completed successfully"
                    );

                    // Warn if processing took longer than target
                    if cycle.processing_time_ms > TARGET_PROCESSING_TIME_MS {
                        warn!(
                            processing_time_ms = cycle.processing_time_ms,
                            target_ms = TARGET_PROCESSING_TIME_MS,
                            checkpoint = cycle.checkpoint,
                            events = cycle.inserted_events,
                            overage_ms = cycle.processing_time_ms - TARGET_PROCESSING_TIME_MS,
                            "ledger processing exceeded target time"
                        );
                    }

                    if cycle.caught_up() {
                        debug!(
                            checkpoint = cycle.checkpoint,
                            latest_network_ledger = cycle.latest_network_ledger,
                            sleep_ms = self.config.idle_poll_interval.as_millis() as u64,
                            "indexer caught up; idling",
                        );
                        tokio::time::sleep(self.config.idle_poll_interval).await;
                    } else if cycle.is_lagging() {
                        // When lagging, use shorter poll interval to catch up faster
                        debug!(
                            checkpoint = cycle.checkpoint,
                            latest_network_ledger = cycle.latest_network_ledger,
                            lag = cycle.latest_network_ledger - cycle.checkpoint,
                            sleep_ms = self.config.active_poll_interval.as_millis() as u64,
                            "indexer lagging; using active poll interval",
                        );
                        tokio::time::sleep(self.config.active_poll_interval).await;
                    } else {
                        // Close to caught up, use idle interval
                        tokio::time::sleep(self.config.idle_poll_interval).await;
                    }
                }
                Err(err) => {
                    worker_retry_attempt = worker_retry_attempt.saturating_add(1);
                    
                    // Record failure metrics
                    metrics().record_cycle_failure();
                    
                    // Record recovery attempt
                    if worker_retry_attempt > 1 {
                        metrics().record_recovery_attempt();
                    }

                    // Structured error logging
                    error!(
                        error = %err,
                        error_debug = ?err,
                        attempt = worker_retry_attempt,
                        max_attempts = self.config.worker_retry_policy.max_attempts,
                        "indexer worker cycle failed"
                    );

                    // Record error in database for monitoring
                    if let Err(db_err) = self.record_error(&err.to_string()).await {
                        error!(
                            error = %db_err,
                            original_error = %err,
                            "failed to record indexer error in database"
                        );
                        metrics().record_database_error();
                    }

                    let backoff = self
                        .config
                        .worker_retry_policy
                        .delay_for_attempt(worker_retry_attempt.saturating_sub(1));

                    warn!(
                        attempt = worker_retry_attempt,
                        backoff_ms = backoff.as_millis() as u64,
                        next_retry_at = ?std::time::SystemTime::now() + backoff,
                        "retrying indexer worker cycle after backoff",
                    );

                    tokio::time::sleep(backoff).await;
                }
            }
        }
    }

    #[instrument(skip(self), fields(cycle_id = tracing::field::Empty))]
    pub async fn next_cycle(&mut self) -> Result<LedgerCycle> {
        let cycle_started_at = Instant::now();
        Span::current().record("cycle_id", format!("{:?}", cycle_started_at));
        
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
                worker_version = WORKER_VERSION,
                "indexer initialized checkpoint from latest network ledger",
            );

            return Ok(LedgerCycle {
                checkpoint: latest_network_ledger,
                latest_network_ledger,
                inserted_events: 0,
                processing_time_ms: cycle_started_at.elapsed().as_millis() as u64,
            });
        }

        let start_ledger = last_processed_ledger + 1;
        
        debug!(
            start_ledger,
            last_processed_ledger,
            "fetching events from RPC"
        );
        
        let events_response = self.rpc.get_events(start_ledger).await?;

        debug!(
            start_ledger,
            latest_network_ledger = events_response.latest_network_ledger,
            events_count = events_response.events.len(),
            ledger_lag = events_response.latest_network_ledger - last_processed_ledger,
            "received events from RPC"
        );

        if events_response.latest_network_ledger < start_ledger {
            metrics()
                .last_processed_ledger
                .store(last_processed_ledger, Ordering::Relaxed);

            debug!(
                start_ledger,
                latest_network_ledger = events_response.latest_network_ledger,
                "network ledger behind start ledger, skipping"
            );

            return Ok(LedgerCycle {
                checkpoint: last_processed_ledger,
                latest_network_ledger: events_response.latest_network_ledger,
                inserted_events: 0,
                processing_time_ms: cycle_started_at.elapsed().as_millis() as u64,
            });
        }

        // Create ledger processing log entry
        let log_id = self.create_processing_log(start_ledger, events_response.events.len()).await?;

        debug!(
            log_id,
            start_ledger,
            events_count = events_response.events.len(),
            "created processing log entry"
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
                warn!(
                    ledger,
                    contract_id,
                    "skipping event with empty id"
                );
                continue;
            }

            max_seen_ledger = max_seen_ledger.max(ledger);

            // Idempotent insert - ON CONFLICT DO NOTHING ensures we never duplicate
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

            // Process side effects idempotently
            process_event_side_effects(&mut transaction, event)
                .await
                .with_context(|| format!("processing side effects for event {event_id}"))?;
        }

        let next_checkpoint = if max_seen_ledger >= start_ledger {
            max_seen_ledger
        } else {
            start_ledger
        };

        // Update checkpoint using the enhanced function
        sqlx::query("SELECT update_indexer_checkpoint($1, $2, $3)")
            .bind(next_checkpoint)
            .bind(inserted_events as i64)
            .bind(WORKER_VERSION)
            .execute(&mut *transaction)
            .await?;

        // Record checkpoint update metric
        metrics().record_checkpoint_update();

        // Mark processing log as completed
        let processing_duration_ms = cycle_started_at.elapsed().as_millis() as i64;
        self.complete_processing_log(&mut transaction, log_id, processing_duration_ms).await?;

        transaction.commit().await?;

        last_processed_ledger = next_checkpoint;
        metrics()
            .last_processed_ledger
            .store(last_processed_ledger, Ordering::Relaxed);

        info!(
            checkpoint = last_processed_ledger,
            latest_network_ledger = events_response.latest_network_ledger,
            inserted_events,
            processing_duration_ms,
            worker_version = WORKER_VERSION,
            "indexer cycle committed",
        );

        Ok(LedgerCycle {
            checkpoint: last_processed_ledger,
            latest_network_ledger: events_response.latest_network_ledger,
            inserted_events,
            processing_time_ms,
        })
    }

    /// Creates a processing log entry for audit trail
    async fn create_processing_log(&self, ledger_sequence: i64, events_count: usize) -> Result<i64> {
        let log_id: i64 = sqlx::query_scalar(
            "INSERT INTO ledger_processing_log (ledger_sequence, events_count, processing_started_at, status)
             VALUES ($1, $2, NOW(), 'processing')
             RETURNING id"
        )
        .bind(ledger_sequence)
        .bind(events_count as i32)
        .fetch_one(&self.pool)
        .await?;

        Ok(log_id)
    }

    /// Marks a processing log entry as completed
    async fn complete_processing_log(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        log_id: i64,
        duration_ms: i64,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE ledger_processing_log 
             SET status = 'completed', 
                 processing_completed_at = NOW(),
                 processing_duration_ms = $2
             WHERE id = $1"
        )
        .bind(log_id)
        .bind(duration_ms)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }

    /// Records an error in the indexer state for monitoring
    async fn record_error(&self, error_message: &str) -> Result<()> {
        sqlx::query("SELECT record_indexer_error($1)")
            .bind(error_message)
            .execute(&self.pool)
            .await?;

        Ok(())
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
                jitter_enabled: false,
            },
            request_timeout: Duration::from_secs(30),
            circuit_breaker: CircuitBreakerConfig {
                failure_threshold: 10,
                timeout: Duration::from_secs(60),
                enabled: false,
            },
        }
    }

    fn test_follower_config() -> LedgerFollowerConfig {
        LedgerFollowerConfig {
            idle_poll_interval: Duration::from_millis(1),
            active_poll_interval: Duration::from_millis(1),
            worker_retry_policy: RetryPolicy {
                max_attempts: 2,
                initial_backoff: Duration::from_millis(1),
                max_backoff: Duration::from_millis(2),
                jitter_enabled: false,
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
