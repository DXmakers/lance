use axum::{extract::State, http::StatusCode, Json, response::IntoResponse};
use serde_json::{json, Value};

use crate::AppState;

const DEFAULT_SOROBAN_RPC_URL: &str = "https://soroban-testnet.stellar.org";
const DEFAULT_MAX_LEDGER_LAG: i64 = 5;

fn soroban_rpc_url() -> String {
    std::env::var("SOROBAN_RPC_URL")
        .or_else(|_| std::env::var("STELLAR_RPC_URL"))
        .unwrap_or_else(|_| DEFAULT_SOROBAN_RPC_URL.to_string())
}

fn max_ledger_lag() -> i64 {
    std::env::var("INDEXER_MAX_LEDGER_LAG")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(DEFAULT_MAX_LEDGER_LAG)
}

pub async fn liveness() -> (StatusCode, Json<Value>) {
    (
        StatusCode::OK,
        Json(json!({
            "status": "alive"
        })),
    )
}

pub async fn readiness(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({
                "status": "ready",
                "db": "connected"
            })),
        ),
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "status": "not_ready",
                "db": e.to_string()
            })),
        ),
    }
}

pub async fn health(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => {
            let (code, Json(sync_status_payload)) = sync_status(State(state.clone())).await;
            (
                code,
                Json(json!({
                    "status": sync_status_payload["status"].clone(),
                    "db": "connected",
                    "indexer_sync_status": sync_status_payload
                })),
            )
        }
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "status": "degraded", "db": e.to_string() })),
        ),
    }
}

pub async fn sync_status(State(state): State<AppState>) -> impl IntoResponse {
    let indexer_state = state.indexer_state.read().await;
    
    let network_ledger = get_network_ledger().await.unwrap_or(0);
    let lag = if network_ledger > indexer_state.last_ledger {
        network_ledger - indexer_state.last_ledger
    } else {
        0
    };
    
    let status = if indexer_state.status == "error" {
        "unhealthy"
    } else if lag > 10 {
        "lagging"
    } else if lag > 0 {
        "syncing"
    } else {
        "synced"
    };
    
    Json(json!({
        "status": status,
        "last_ledger": indexer_state.last_ledger,
        "network_ledger": network_ledger,
        "lag": lag,
        "indexer_status": indexer_state.status,
        "error_message": indexer_state.error_message,
    }))
}

async fn get_network_ledger() -> Option<u32> {
    let horizon_url = std::env::var("HORIZON_URL")
        .unwrap_or_else(|_| "https://horizon-testnet.stellar.org".to_string());
    
    let url = format!("{}/ledgers?limit=1&order=desc", horizon_url);
    
    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await.ok()?;
    
    #[derive(serde::Deserialize)]
    struct Response {
        _embedded: Embedded,
    }
    
    #[derive(serde::Deserialize)]
    struct Embedded {
        records: Vec<Ledger>,
    }
    
    #[derive(serde::Deserialize)]
    struct Ledger {
        sequence: u32,
    }
    
    let body: Response = resp.json().await.ok()?;
    body._embedded.records.into_iter().next().map(|r| r.sequence)
}

pub mod indexer {
    use axum::{extract::State, http::StatusCode, Json};
    use serde_json::{json, Value};
    
    use crate::AppState;
    
    pub async fn rescan(
        State(state): State<AppState>,
        axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
    ) -> (StatusCode, Json<Value>) {
        let from_ledger = params
            .get("from")
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(1);
        
        tracing::info!("Manual rescan triggered from ledger {}", from_ledger);
        
        let mut indexer_state = state.indexer_state.write().await;
        indexer_state.last_ledger = from_ledger.saturating_sub(1);
        indexer_state.status = "rescanning".to_string();
        indexer_state.error_message = None;
        
        let _ = sqlx::query("DELETE FROM ledger_events WHERE ledger_seq >= $1")
            .bind(from_ledger as i64)
            .execute(&state.pool)
            .await;
        
        (
            StatusCode::OK,
            Json(json!({
                "status": "rescan_started",
                "from_ledger": from_ledger,
            })),
        )
    }
}
