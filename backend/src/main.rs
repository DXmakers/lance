use axum::Router;
use dotenvy::dotenv;
use prometheus::Registry;
use sqlx::postgres::PgPoolOptions;
use std::net::SocketAddr;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod db;
mod error;
mod models;
mod routes;
mod services;
mod worker;

pub use db::AppState;
use worker::IndexerState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv().ok();
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "backend=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    let registry = Registry::new();
    let prometheus_registry = registry.clone();
    
    let indexer_state = IndexerState {
        last_ledger: 0,
        last_ledger_hash: String::new(),
        status: "idle".to_string(),
        error_message: None,
    };
    
    let state = AppState::new(pool.clone(), registry, indexer_state.clone());
    
    tokio::spawn(worker::run_judge_worker(pool.clone()));
    tokio::spawn(worker::run_indexer_worker(pool.clone(), prometheus_registry.clone()));
    
    let app = build_router(state);

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "3001".to_string())
        .parse()?;
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("🚀 Backend listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn build_router(state: AppState) -> Router {
    Router::new()
        .nest("/api", routes::api_router())
        .route("/metrics", axum::routing::get(metrics_handler))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn metrics_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::response::Response {
    use prometheus::Encoder;
    let encoder = prometheus::TextEncoder::new();
    let metric_families = state.prometheus_registry.gather();
    let mut buffer = Vec::new();
    encoder.encode(&metric_families, &mut buffer).unwrap();
    axum::response::Response::builder()
        .header(axum::http::header::CONTENT_TYPE, "text/plain")
        .body(axum::body::Full::from(buffer))
        .unwrap()
}
