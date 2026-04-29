pub use crate::indexer_metrics::metrics;

use reqwest::Client;
use sqlx::PgPool;
use tracing::info;

use crate::ledger_follower::{LedgerFollower, LedgerFollowerConfig};
use crate::soroban_rpc::{RpcClientConfig, SorobanRpcClient};

pub async fn run_indexer_worker(pool: PgPool) {
    let rpc_config = RpcClientConfig::from_env();
    let follower_config = LedgerFollowerConfig::from_env();

    info!(
        rpc_url = %rpc_config.url,
        idle_poll_ms = follower_config.idle_poll_interval.as_millis() as u64,
        rpc_rate_limit_ms = rpc_config.rate_limit_interval.as_millis() as u64,
        rpc_retry_max_attempts = rpc_config.retry_policy.max_attempts,
        "starting Soroban indexer worker",
    );

    let rpc = SorobanRpcClient::new(Client::new(), rpc_config);
    let mut follower = LedgerFollower::new(pool, rpc, follower_config);
    follower.run().await;
}
