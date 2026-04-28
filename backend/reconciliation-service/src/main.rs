mod config;
mod db;
mod metrics;
mod models;
mod repository;
mod routes;
mod rpc;
mod worker;

use crate::{config::Config, metrics::Metrics, models::SyncSnapshot, repository::Repository, rpc::{RetryConfig, StellarRpcClient}, worker::{spawn, WorkerContext}};
use axum::Router;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{fmt, EnvFilter};

#[derive(Clone, Debug)]
pub struct AppState {
    pub repository: Repository,
    pub rpc: StellarRpcClient,
    pub metrics: Arc<Metrics>,
    pub snapshot: Arc<RwLock<SyncSnapshot>>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::from_env()?;
    init_tracing(&config.service_name);

    let pool = db::connect(&config.database_url).await?;
    db::run_migrations(&pool).await?;

    let repository = Repository::new(pool);
    repository.ensure_checkpoint_row().await?;

    let checkpoint = repository.load_checkpoint().await?;
    let metrics = Arc::new(Metrics::new()?);
    let rpc = StellarRpcClient::new(
        config.rpc_url.clone(),
        RetryConfig {
            max_attempts: config.retry.max_attempts,
            initial_backoff: config.retry.initial_backoff,
            max_backoff: config.retry.max_backoff,
        },
    )?;
    let snapshot = Arc::new(RwLock::new(SyncSnapshot::new(checkpoint)));

    let state = Arc::new(AppState {
        repository: repository.clone(),
        rpc: rpc.clone(),
        metrics: Arc::clone(&metrics),
        snapshot: Arc::clone(&snapshot),
    });

    let worker_context = WorkerContext {
        repository,
        rpc,
        metrics,
        snapshot,
        poll_interval: config.poll_interval,
    };

    let worker_handle = spawn(worker_context);

    let app = Router::new()
        .merge(routes::router(Arc::clone(&state)))
        .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;
    tracing::info!(address = %config.bind_addr, service = %config.service_name, "reconciliation service listening");

    let server = axum::serve(listener, app).with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
        tracing::info!("shutdown signal received");
    });

    let result = server.await;
    worker_handle.abort();

    result?;
    Ok(())
}

fn init_tracing(service_name: &str) {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let subscriber = fmt()
        .json()
        .with_env_filter(filter)
        .with_target(true)
        .with_thread_ids(true)
        .with_thread_names(true)
        .with_span_events(tracing_subscriber::fmt::format::FmtSpan::CLOSE)
        .with_current_span(true)
        .with_ansi(false)
        .with_writer(std::io::stdout)
        .with_level(true)
        .finish();

    let _ = tracing::subscriber::set_global_default(subscriber);

    tracing::info!(service = service_name, "initializing structured logging");
}