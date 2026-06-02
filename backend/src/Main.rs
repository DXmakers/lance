// backend/src/main.rs
//
// Lance — Freelancer Platform with AI Agent Judge
// BE-API-083: Async Processing Queue for Dispute File Analysis
//
// Bootstraps the Axum HTTP server, SQLx connection pool, tracing infrastructure,
// and the background worker pool that processes dispute file analysis tasks.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{middleware, Router};
use sqlx::postgres::PgPoolOptions;
use tower_http::{
    cors::{Any, CorsLayer},
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    timeout::TimeoutLayer,
    trace::TraceLayer,
};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

mod db;
mod error;
mod models;
mod queue;
mod routes;
mod state;

use queue::worker::spawn_dispute_workers;
use state::AppState;

/// Application entry point.
///
/// Initialisation order:
/// 1. Tracing subscriber (JSON in production, pretty in dev)
/// 2. Database pool (with validated pool limits for stability under load)
/// 3. Async dispute queue + worker pool
/// 4. Axum router with all middleware layers
/// 5. TCP listener + graceful shutdown signal
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // ── 1. Tracing ──────────────────────────────────────────────────────────
    dotenvy::dotenv().ok();

    let log_format = std::env::var("LOG_FORMAT").unwrap_or_else(|_| "pretty".into());

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "backend=debug,tower_http=debug,sqlx=warn".into());

    if log_format == "json" {
        tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer().json())
            .init();
    } else {
        tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer().pretty())
            .init();
    }

    info!(
        version = env!("CARGO_PKG_VERSION"),
        "Lance backend starting"
    );

    // ── 2. Database pool ────────────────────────────────────────────────────
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");

    // Pool tuning: keep max connections bounded so that concurrent load tests
    // never exhaust the PostgreSQL max_connections limit (acceptance criterion).
    let max_connections: u32 = std::env::var("DB_MAX_CONNECTIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(20);

    let min_connections: u32 = std::env::var("DB_MIN_CONNECTIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2);

    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .min_connections(min_connections)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .idle_timeout(std::time::Duration::from_secs(600))
        .max_lifetime(std::time::Duration::from_secs(1800))
        .connect(&database_url)
        .await
        .expect("Failed to create database pool");

    // Run any pending migrations on startup.
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Database migration failed");

    info!(
        max_connections,
        min_connections,
        "Database pool initialised"
    );

    // ── 3. Async queue + workers ────────────────────────────────────────────
    let worker_count: usize = std::env::var("DISPUTE_WORKER_COUNT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(4);

    let queue_capacity: usize = std::env::var("DISPUTE_QUEUE_CAPACITY")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(256);

    let (queue_tx, queue_rx) = async_channel::bounded(queue_capacity);

    // Spawn N background workers that drain the queue concurrently.
    spawn_dispute_workers(worker_count, queue_rx.clone(), pool.clone());

    info!(
        worker_count,
        queue_capacity,
        "Dispute file analysis queue initialised"
    );

    // ── 4. Application state ────────────────────────────────────────────────
    let state = Arc::new(AppState {
        db: pool,
        dispute_queue: queue_tx,
    });

    // ── 5. Router ───────────────────────────────────────────────────────────
    let app = build_router(state);

    // ── 6. Serve ────────────────────────────────────────────────────────────
    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8080);

    let addr: SocketAddr = format!("{host}:{port}").parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;

    info!(%addr, "Listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

/// Constructs the full Axum `Router` with all middleware layers attached.
///
/// Middleware stack (outermost → innermost):
///   SetRequestId → PropagateRequestId → TraceLayer → TimeoutLayer → CorsLayer
fn build_router(state: Arc<AppState>) -> Router {
    let x_request_id = axum::http::HeaderName::from_static("x-request-id");

    Router::new()
        .merge(routes::health::router())
        .merge(routes::disputes::router())
        .with_state(state)
        // Emit structured per-request spans that include method, URI, status,
        // latency, and the propagated x-request-id.
        .layer(TraceLayer::new_for_http())
        // Hard request timeout — prevents slow DB queries from starving workers.
        .layer(TimeoutLayer::new(std::time::Duration::from_secs(30)))
        // CORS — tighten in production via ALLOWED_ORIGINS env var.
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        // Propagate request-id header through response so clients can correlate.
        .layer(PropagateRequestIdLayer::new(x_request_id.clone()))
        .layer(SetRequestIdLayer::new(
            x_request_id,
            MakeRequestUuid,
        ))
}

/// Listens for SIGTERM (Docker/k8s) and Ctrl-C and resolves when either fires.
async fn shutdown_signal() {
    use tokio::signal;

    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => { info!("Received Ctrl-C, shutting down") },
        _ = terminate => { info!("Received SIGTERM, shutting down") },
    }
}