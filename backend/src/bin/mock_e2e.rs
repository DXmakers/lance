use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex},
};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;

const SEEDED_DISPUTE_ID: &str = "11111111-1111-4111-8111-111111111111";
const SEEDED_JOB_ID: &str = "22222222-2222-4222-8222-222222222222";

#[derive(Clone)]
struct AppState {
    store: Arc<Mutex<Store>>,
}

#[derive(Default)]
struct Store {
    jobs: Vec<Job>,
    disputes: HashMap<Uuid, Dispute>,
    verdicts: HashMap<Uuid, Verdict>,
    evidence: Vec<Evidence>,
}

#[derive(Clone, Serialize)]
struct Job {
    id: Uuid,
    title: String,
    description: String,
    budget_usdc: i64,
    milestones: i32,
    client_address: String,
    freelancer_address: Option<String>,
    status: String,
    metadata_hash: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct CreateJobRequest {
    title: String,
    description: String,
    budget_usdc: i64,
    milestones: i32,
    client_address: String,
}

#[derive(Clone, Serialize)]
struct Dispute {
    id: Uuid,
    job_id: Uuid,
    opened_by: String,
    status: String,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Serialize)]
struct Verdict {
    id: Uuid,
    dispute_id: Uuid,
    winner: String,
    freelancer_share_bps: i32,
    reasoning: String,
    on_chain_tx: String,
    created_at: DateTime<Utc>,
}

#[derive(Clone, Serialize)]
struct Evidence {
    id: Uuid,
    dispute_id: Uuid,
    submitted_by: String,
    content: String,
    file_hash: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct SubmitEvidenceRequest {
    submitted_by: String,
    content: String,
    file_hash: Option<String>,
}

#[tokio::main]
async fn main() {
    let state = AppState {
        store: Arc::new(Mutex::new(seed_store())),
    };

    let app = Router::new()
        .route("/api/jobs", get(list_jobs).post(create_job))
        .route("/api/jobs/:id", get(get_job))
        .route("/api/disputes/:id", get(get_dispute))
        .route("/api/disputes/:id/verdict", get(get_verdict))
        .route("/api/disputes/:id/evidence", post(submit_evidence))
        .with_state(state)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    let port = std::env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(3001);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    println!("Mock Axum backend listening on http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind mock Axum listener");
    axum::serve(listener, app)
        .await
        .expect("serve mock Axum backend");
}

fn seed_store() -> Store {
    let now = Utc::now();
    let seeded_job_id = Uuid::parse_str(SEEDED_JOB_ID).expect("valid seeded job id");
    let seeded_dispute_id = Uuid::parse_str(SEEDED_DISPUTE_ID).expect("valid seeded dispute id");

    let seeded_job = Job {
        id: seeded_job_id,
        title: "Escrow release audit".to_string(),
        description: "Validate dispute and milestone release logic for a Testnet deployment."
            .to_string(),
        budget_usdc: 2_750_000_000,
        milestones: 2,
        client_address: "GCLIENTSEEDEDPUBLICKEY1234567890ABCDE".to_string(),
        freelancer_address: Some("GFREELANCERSEEDEDPUBLICKEY123456789".to_string()),
        status: "in_progress".to_string(),
        metadata_hash: None,
        created_at: now,
        updated_at: now,
    };

    let seeded_dispute = Dispute {
        id: seeded_dispute_id,
        job_id: seeded_job_id,
        opened_by: "GFREELANCERSEEDEDPUBLICKEY123456789".to_string(),
        status: "open".to_string(),
        created_at: now,
    };

    let seeded_verdict = Verdict {
        id: Uuid::parse_str("33333333-3333-4333-8333-333333333333")
            .expect("valid seeded verdict id"),
        dispute_id: seeded_dispute_id,
        winner: "freelancer".to_string(),
        freelancer_share_bps: 8500,
        reasoning:
            "Evidence indicates the milestone deliverables were shipped and materially accepted before the dispute."
                .to_string(),
        on_chain_tx: "mock-verdict-tx-0001".to_string(),
        created_at: now,
    };

    let mut disputes = HashMap::new();
    disputes.insert(seeded_dispute_id, seeded_dispute);

    let mut verdicts = HashMap::new();
    verdicts.insert(seeded_dispute_id, seeded_verdict);

    Store {
        jobs: vec![seeded_job],
        disputes,
        verdicts,
        evidence: Vec::new(),
    }
}

async fn list_jobs(State(state): State<AppState>) -> Json<Vec<Job>> {
    let store = state.store.lock().expect("lock jobs");
    Json(store.jobs.clone())
}

async fn get_job(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Job>, StatusCode> {
    let store = state.store.lock().expect("lock jobs");
    store
        .jobs
        .iter()
        .find(|job| job.id == id)
        .cloned()
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn create_job(
    State(state): State<AppState>,
    Json(req): Json<CreateJobRequest>,
) -> Result<Json<Job>, (StatusCode, String)> {
    if req.title.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "title is required".to_string()));
    }

    let mut store = state.store.lock().expect("lock jobs");
    let now = Utc::now();
    let job = Job {
        id: Uuid::new_v4(),
        title: req.title,
        description: req.description,
        budget_usdc: req.budget_usdc,
        milestones: req.milestones,
        client_address: req.client_address,
        freelancer_address: None,
        status: "open".to_string(),
        metadata_hash: None,
        created_at: now,
        updated_at: now,
    };
    store.jobs.insert(0, job.clone());

    Ok(Json(job))
}

async fn get_dispute(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Dispute>, StatusCode> {
    let store = state.store.lock().expect("lock disputes");
    store
        .disputes
        .get(&id)
        .cloned()
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn get_verdict(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Verdict>, StatusCode> {
    let store = state.store.lock().expect("lock verdicts");
    store
        .verdicts
        .get(&id)
        .cloned()
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn submit_evidence(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<SubmitEvidenceRequest>,
) -> Json<Evidence> {
    let mut store = state.store.lock().expect("lock evidence");
    let evidence = Evidence {
        id: Uuid::new_v4(),
        dispute_id: id,
        submitted_by: req.submitted_by,
        content: req.content,
        file_hash: req.file_hash,
        created_at: Utc::now(),
    };
    store.evidence.push(evidence.clone());
    Json(evidence)
}
