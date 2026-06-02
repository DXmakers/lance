/// state.rs
///
/// Shared application state injected into every Axum handler via
/// `axum::extract::State<AppState>`.
///
/// This module initialises:
///   • The SQLx Postgres connection pool (with tuned pool limits).
///   • The `deadpool_redis` connection pool.
///   • The `RedisCache` wrapper.

use std::env;

use deadpool_redis::{Config as RedisConfig, Runtime};
use sqlx::{postgres::PgPoolOptions, PgPool};
use tracing::{info, instrument};

use crate::cache::RedisCache;

/// Cloneable application state shared across all request handlers.
#[derive(Clone, Debug)]
pub struct AppState {
    /// SQLx Postgres pool.
    pub db: PgPool,
    /// Redis cache wrapper.
    pub cache: RedisCache,
}

impl AppState {
    /// Build the `AppState` from environment variables.
    ///
    /// Required env vars:
    /// - `DATABASE_URL`  — Postgres connection string.
    /// - `REDIS_URL`     — Redis connection string (e.g. `redis://localhost:6379`).
    ///
    /// Optional env vars with defaults:
    /// - `DB_MAX_CONNECTIONS`   (default: 20)
    /// - `DB_MIN_CONNECTIONS`   (default: 5)
    /// - `REDIS_POOL_SIZE`      (default: 16)
    #[instrument(name = "AppState::init")]
    pub async fn init() -> anyhow::Result<Self> {
        let database_url = env::var("DATABASE_URL")
            .expect("DATABASE_URL must be set");
        let redis_url = env::var("REDIS_URL")
            .expect("REDIS_URL must be set");

        let db_max: u32 = env::var("DB_MAX_CONNECTIONS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(20);

        let db_min: u32 = env::var("DB_MIN_CONNECTIONS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5);

        let redis_pool_size: usize = env::var("REDIS_POOL_SIZE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(16);

        // ----------------------------------------------------------------
        // Postgres pool
        // ----------------------------------------------------------------
        info!(db_max, db_min, "Initialising Postgres connection pool");

        let db = PgPoolOptions::new()
            // Hard ceiling on open connections.
            .max_connections(db_max)
            // Keep a warm pool — prevents cold-start latency spikes.
            .min_connections(db_min)
            // Fail fast rather than queue requests indefinitely.
            .acquire_timeout(std::time::Duration::from_secs(5))
            // Recycle long-lived idle connections to avoid stale socket errors.
            .idle_timeout(std::time::Duration::from_secs(300))
            // Validate the connection health before handing it to a handler.
            .test_before_acquire(true)
            .connect(&database_url)
            .await?;

        info!("Postgres pool ready");

        // ----------------------------------------------------------------
        // Redis pool
        // ----------------------------------------------------------------
        info!(redis_pool_size, "Initialising Redis connection pool");

        let redis_cfg = RedisConfig::from_url(&redis_url);
        let redis_pool = redis_cfg
            .create_pool(Some(Runtime::Tokio1))
            .map_err(|e| anyhow::anyhow!("Redis pool creation failed: {e}"))?;

        // Override pool size from config.
        // deadpool_redis uses a builder; we re-create with explicit size.
        let redis_pool = deadpool_redis::Config {
            url: Some(redis_url),
            pool: Some(deadpool_redis::PoolConfig {
                max_size: redis_pool_size,
                ..Default::default()
            }),
            ..Default::default()
        }
        .create_pool(Some(Runtime::Tokio1))
        .map_err(|e| anyhow::anyhow!("Redis pool creation failed: {e}"))?;

        // Smoke-test the Redis connection at startup.
        {
            let mut conn = redis_pool.get().await
                .map_err(|e| anyhow::anyhow!("Redis connection test failed: {e}"))?;
            let pong: String = deadpool_redis::redis::cmd("PING")
                .query_async(&mut conn)
                .await
                .map_err(|e| anyhow::anyhow!("Redis PING failed: {e}"))?;
            info!(pong, "Redis connection verified");
        }

        let cache = RedisCache::new(redis_pool);

        Ok(Self { db, cache })
    }
}