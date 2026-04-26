use axum::Router;
use sqlx::postgres::PgPoolOptions;
use std::net::SocketAddr;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod db;
mod env_config;
mod error;
mod indexer;
mod middleware;
mod models;
mod routes;
mod services;
mod tx_metadata_cache;
mod tx_queue;
mod worker;

pub use db::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let env_bootstrap = env_config::load_backend_environment()?;

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "backend=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!(
        app_env = %env_bootstrap.app_env,
        loaded_env_files = ?env_bootstrap.loaded_files,
        "backend environment initialized",
    );

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    let state = AppState::new(pool.clone());
    tokio::spawn(worker::run_judge_worker(pool.clone()));
    tokio::spawn(indexer::run_indexer_worker(pool));

    let app = build_router(state);

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "3001".to_string())
        .parse()?;
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("🚀 Backend listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}

fn build_router(state: AppState) -> Router {
    let limiter = middleware::build_limiter();

    Router::new()
        .nest("/api", routes::api_router())
        .layer(middleware::RateLimitLayer::new(limiter))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
