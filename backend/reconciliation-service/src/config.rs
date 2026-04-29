use std::{env, net::SocketAddr, time::Duration};

#[derive(Clone, Debug)]
pub struct Config {
    pub bind_addr: SocketAddr,
    pub database_url: String,
    pub rpc_url: String,
    pub service_name: String,
    pub poll_interval: Duration,
    pub retry: RetryConfig,
}

#[derive(Clone, Debug)]
pub struct RetryConfig {
    pub max_attempts: u32,
    pub initial_backoff: Duration,
    pub max_backoff: Duration,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        dotenvy::dotenv().ok();

        Ok(Self {
            bind_addr: parse_socket_addr("BIND_ADDR", "0.0.0.0:3000")?,
            database_url: required("DATABASE_URL")?,
            rpc_url: required("STELLAR_RPC_URL")?,
            service_name: env::var("SERVICE_NAME")
                .unwrap_or_else(|_| "reconciliation-service".to_string()),
            poll_interval: Duration::from_secs(parse_u64("POLL_INTERVAL_SECS", 5)?),
            retry: RetryConfig {
                max_attempts: parse_u32("RPC_MAX_ATTEMPTS", 5)?,
                initial_backoff: Duration::from_millis(parse_u64("RPC_INITIAL_BACKOFF_MS", 250)?),
                max_backoff: Duration::from_secs(parse_u64("RPC_MAX_BACKOFF_SECS", 5)?),
            },
        })
    }
}

fn required(name: &str) -> anyhow::Result<String> {
    env::var(name)
        .map_err(|_| anyhow::anyhow!("missing required environment variable: {name}"))

fn parse_socket_addr(name: &str, default: &str) -> anyhow::Result<SocketAddr> {
    let value = env::var(name).unwrap_or_else(|_| default.to_string());
    Ok(value.parse()?)
}

fn parse_u64(name: &str, default: u64) -> anyhow::Result<u64> {
    match env::var(name) {
        Ok(raw) => Ok(raw
            .parse::<u64>()
            .map_err(|error| anyhow::anyhow!("invalid {name}: {error}"))?),
        Err(_) => Ok(default),
    }
}

fn parse_u32(name: &str, default: u32) -> anyhow::Result<u32> {
    match env::var(name) {
        Ok(raw) => Ok(raw
            .parse::<u32>()
            .map_err(|error| anyhow::anyhow!("invalid {name}: {error}"))?),
        Err(_) => Ok(default),
    }
}
