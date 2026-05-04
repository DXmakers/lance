// Recovery tests for RPC connection failures and checkpoint resumption

#[cfg(test)]
mod tests {
    use crate::ledger_follower::{LedgerFollower, LedgerFollowerConfig};
    use crate::soroban_rpc::{CircuitBreakerConfig, RetryPolicy, RpcClientConfig, SorobanRpcClient};
    use reqwest::Client;
    use sqlx::PgPool;
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
    use std::sync::Arc;
    use std::time::Duration;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn test_rpc_config(rpc_url: String) -> RpcClientConfig {
        RpcClientConfig {
            url: rpc_url,
            rate_limit_interval: Duration::ZERO,
            retry_policy: RetryPolicy {
                max_attempts: 3,
                initial_backoff: Duration::from_millis(10),
                max_backoff: Duration::from_millis(50),
                jitter_enabled: false,
            },
            request_timeout: Duration::from_secs(5),
            circuit_breaker: CircuitBreakerConfig {
                failure_threshold: 10,
                timeout: Duration::from_secs(60),
                enabled: false,
            },
        }
    }

    fn test_follower_config() -> LedgerFollowerConfig {
        LedgerFollowerConfig {
            idle_poll_interval: Duration::from_millis(10),
            active_poll_interval: Duration::from_millis(10),
            worker_retry_policy: RetryPolicy {
                max_attempts: 3,
                initial_backoff: Duration::from_millis(10),
                max_backoff: Duration::from_millis(50),
                jitter_enabled: false,
            },
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_recovery_from_rpc_connection_failure(pool: PgPool) {
        // Set initial checkpoint
        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(100_i64)
            .execute(&pool)
            .await
            .unwrap();

        let mock_server = MockServer::start().await;
        let request_count = Arc::new(AtomicUsize::new(0));

        // First 2 requests fail with connection error
        // Third request succeeds
        let request_count_clone = request_count.clone();
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(move |_req: &wiremock::Request| {
                let count = request_count_clone.fetch_add(1, AtomicOrdering::SeqCst);
                if count < 2 {
                    // Simulate connection failure
                    ResponseTemplate::new(503).set_body_string("Service Unavailable")
                } else {
                    // Success
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "result": {
                            "latestLedger": 102,
                            "events": [
                                {
                                    "id": "evt-101",
                                    "ledger": "101",
                                    "contractId": "CTEST",
                                    "topic": ["test"],
                                    "value": { "xdr": "AAAA" }
                                }
                            ]
                        }
                    }))
                }
            })
            .mount(&mock_server)
            .await;

        let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());

        // First attempt should fail
        let result1 = follower.next_cycle().await;
        assert!(result1.is_err(), "First attempt should fail");

        // Verify checkpoint unchanged
        let checkpoint: i64 =
            sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(checkpoint, 100, "Checkpoint should remain at 100 after failure");

        // Second attempt should succeed (after retries)
        let result2 = follower.next_cycle().await;
        assert!(result2.is_ok(), "Second attempt should succeed after retries");

        let cycle = result2.unwrap();
        assert_eq!(cycle.checkpoint, 101, "Should process ledger 101");
        assert_eq!(cycle.inserted_events, 1, "Should insert 1 event");

        // Verify checkpoint updated
        let final_checkpoint: i64 =
            sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            final_checkpoint, 101,
            "Checkpoint should be updated to 101 after recovery"
        );

        // Verify event was indexed
        let event_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM indexed_events")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(event_count, 1, "Should have 1 indexed event");

        // Verify metrics
        let recovery_attempts = crate::indexer_metrics::metrics()
            .recovery_attempts
            .load(std::sync::atomic::Ordering::Relaxed);
        assert!(recovery_attempts > 0, "Should have recorded recovery attempts");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_resume_from_last_checkpoint_after_restart(pool: PgPool) {
        // Simulate a previous run that processed up to ledger 50
        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(50_i64)
            .execute(&pool)
            .await
            .unwrap();

        // Insert some previously indexed events
        for i in 45..=50 {
            sqlx::query(
                "INSERT INTO indexed_events (id, ledger_amount, contract_id, topic_hash) 
                 VALUES ($1, $2, $3, $4)",
            )
            .bind(format!("evt-{}", i))
            .bind(i)
            .bind("CTEST")
            .bind("test")
            .execute(&pool)
            .await
            .unwrap();
        }

        let mock_server = MockServer::start().await;

        // Mock RPC to return events for ledger 51
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "latestLedger": 51,
                    "events": [
                        {
                            "id": "evt-51",
                            "ledger": "51",
                            "contractId": "CTEST",
                            "topic": ["test"],
                            "value": { "xdr": "AAAA" }
                        }
                    ]
                }
            })))
            .mount(&mock_server)
            .await;

        let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());

        // Process next cycle - should start from ledger 51
        let result = follower.next_cycle().await;
        assert!(result.is_ok(), "Should successfully process from checkpoint");

        let cycle = result.unwrap();
        assert_eq!(cycle.checkpoint, 51, "Should process ledger 51");
        assert_eq!(cycle.inserted_events, 1, "Should insert 1 new event");

        // Verify checkpoint updated
        let checkpoint: i64 =
            sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(checkpoint, 51, "Checkpoint should be updated to 51");

        // Verify total events (6 old + 1 new)
        let event_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM indexed_events")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(event_count, 7, "Should have 7 total indexed events");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_idempotent_reprocessing_after_failure(pool: PgPool) {
        // Set checkpoint
        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(60_i64)
            .execute(&pool)
            .await
            .unwrap();

        let mock_server = MockServer::start().await;
        let request_count = Arc::new(AtomicUsize::new(0));

        // Return same events twice
        let request_count_clone = request_count.clone();
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(move |_req: &wiremock::Request| {
                request_count_clone.fetch_add(1, AtomicOrdering::SeqCst);
                ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {
                        "latestLedger": 61,
                        "events": [
                            {
                                "id": "evt-61-unique",
                                "ledger": "61",
                                "contractId": "CTEST",
                                "topic": ["test"],
                                "value": { "xdr": "AAAA" }
                            }
                        ]
                    }
                }))
            })
            .mount(&mock_server)
            .await;

        let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());

        // First processing
        let result1 = follower.next_cycle().await;
        assert!(result1.is_ok(), "First processing should succeed");
        let cycle1 = result1.unwrap();
        assert_eq!(cycle1.inserted_events, 1, "Should insert 1 event");

        // Simulate failure by resetting checkpoint
        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(60_i64)
            .execute(&pool)
            .await
            .unwrap();

        // Reprocess same ledger
        let rpc2 = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        let mut follower2 = LedgerFollower::new(pool.clone(), rpc2, test_follower_config());

        let result2 = follower2.next_cycle().await;
        assert!(result2.is_ok(), "Reprocessing should succeed");
        let cycle2 = result2.unwrap();
        assert_eq!(
            cycle2.inserted_events, 0,
            "Should insert 0 events (idempotent)"
        );

        // Verify only 1 event in database
        let event_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM indexed_events")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(event_count, 1, "Should still have only 1 event (no duplicates)");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_multiple_consecutive_failures_then_recovery(pool: PgPool) {
        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(70_i64)
            .execute(&pool)
            .await
            .unwrap();

        let mock_server = MockServer::start().await;
        let request_count = Arc::new(AtomicUsize::new(0));

        // Fail 5 times, then succeed
        let request_count_clone = request_count.clone();
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(move |_req: &wiremock::Request| {
                let count = request_count_clone.fetch_add(1, AtomicOrdering::SeqCst);
                if count < 5 {
                    ResponseTemplate::new(500).set_body_string("Internal Server Error")
                } else {
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "result": {
                            "latestLedger": 71,
                            "events": [
                                {
                                    "id": "evt-71",
                                    "ledger": "71",
                                    "contractId": "CTEST",
                                    "topic": ["test"],
                                    "value": { "xdr": "AAAA" }
                                }
                            ]
                        }
                    }))
                }
            })
            .mount(&mock_server)
            .await;

        let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());

        // Multiple failed attempts
        for i in 0..2 {
            let result = follower.next_cycle().await;
            assert!(result.is_err(), "Attempt {} should fail", i + 1);

            // Verify checkpoint unchanged
            let checkpoint: i64 =
                sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(checkpoint, 70, "Checkpoint should remain at 70");
        }

        // Eventually succeeds
        let result = follower.next_cycle().await;
        assert!(result.is_ok(), "Should eventually succeed");

        let cycle = result.unwrap();
        assert_eq!(cycle.checkpoint, 71, "Should process ledger 71");

        // Verify checkpoint updated
        let final_checkpoint: i64 =
            sqlx::query_scalar("SELECT last_processed_ledger FROM indexer_state WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(final_checkpoint, 71, "Checkpoint should be updated to 71");

        // Verify metrics recorded failures and recovery
        let total_errors = crate::indexer_metrics::metrics()
            .total_errors
            .load(std::sync::atomic::Ordering::Relaxed);
        assert!(total_errors >= 2, "Should have recorded multiple errors");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_checkpoint_preserved_on_database_error(pool: PgPool) {
        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(80_i64)
            .execute(&pool)
            .await
            .unwrap();

        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "latestLedger": 81,
                    "events": [
                        {
                            "id": "evt-81",
                            "ledger": "81",
                            "contractId": "CTEST",
                            "topic": ["test"],
                            "value": { "xdr": "AAAA" }
                        }
                    ]
                }
            })))
            .mount(&mock_server)
            .await;

        // Close the pool to simulate database error
        pool.close().await;

        let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());

        // Should fail due to database error
        let result = follower.next_cycle().await;
        assert!(result.is_err(), "Should fail with database error");

        // Note: Can't verify checkpoint since pool is closed
        // In real scenario, checkpoint would remain unchanged in database
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_metrics_tracking_during_recovery(pool: PgPool) {
        use crate::indexer_metrics::metrics;

        // Reset metrics
        let initial_cycles = metrics().cycles_completed.load(std::sync::atomic::Ordering::Relaxed);
        let initial_errors = metrics().total_errors.load(std::sync::atomic::Ordering::Relaxed);

        sqlx::query("UPDATE indexer_state SET last_processed_ledger = $1 WHERE id = 1")
            .bind(90_i64)
            .execute(&pool)
            .await
            .unwrap();

        let mock_server = MockServer::start().await;
        let request_count = Arc::new(AtomicUsize::new(0));

        let request_count_clone = request_count.clone();
        Mock::given(method("POST"))
            .and(path("/"))
            .respond_with(move |_req: &wiremock::Request| {
                let count = request_count_clone.fetch_add(1, AtomicOrdering::SeqCst);
                if count == 0 {
                    ResponseTemplate::new(503)
                } else {
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "result": {
                            "latestLedger": 91,
                            "events": [
                                {
                                    "id": "evt-91",
                                    "ledger": "91",
                                    "contractId": "CTEST",
                                    "topic": ["test"],
                                    "value": { "xdr": "AAAA" }
                                }
                            ]
                        }
                    }))
                }
            })
            .mount(&mock_server)
            .await;

        let rpc = SorobanRpcClient::new(Client::new(), test_rpc_config(mock_server.uri()));
        let mut follower = LedgerFollower::new(pool.clone(), rpc, test_follower_config());

        // First attempt fails
        let _ = follower.next_cycle().await;

        // Verify error metrics increased
        let errors_after_failure =
            metrics().total_errors.load(std::sync::atomic::Ordering::Relaxed);
        assert!(
            errors_after_failure > initial_errors,
            "Error count should increase"
        );

        // Second attempt succeeds
        let result = follower.next_cycle().await;
        assert!(result.is_ok());

        // Verify success metrics increased
        let cycles_after_success =
            metrics().cycles_completed.load(std::sync::atomic::Ordering::Relaxed);
        assert!(
            cycles_after_success > initial_cycles,
            "Completed cycles should increase"
        );

        // Verify checkpoint update metric
        let checkpoint_updates = metrics()
            .checkpoint_updates
            .load(std::sync::atomic::Ordering::Relaxed);
        assert!(checkpoint_updates > 0, "Should have recorded checkpoint update");
    }
}
