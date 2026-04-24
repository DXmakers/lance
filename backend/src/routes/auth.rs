//! SIWS authentication routes.
//!
//! POST /api/v1/auth/nonce  — issue a one-time nonce for an address
//! POST /api/v1/auth/verify — verify a signed SIWS message, return a session token

use axum::{extract::State, Json};
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::{
    db::AppState,
    error::{AppError, Result},
    services::siws,
};

// ── Request / Response types ─────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct NonceRequest {
    pub address: String,
}

#[derive(Serialize)]
pub struct NonceResponse {
    pub nonce: String,
    pub issued_at: String,
}

#[derive(Deserialize)]
pub struct VerifyRequest {
    pub address: String,
    pub signature: String, // hex-encoded 64-byte ed25519 signature
}

#[derive(Serialize)]
pub struct VerifyResponse {
    pub token: String, // opaque session token (hex-encoded random bytes)
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/// Issue a fresh nonce for the given Stellar address.
/// Replaces any previously stored nonce for that address.
pub async fn nonce(
    State(state): State<AppState>,
    Json(req): Json<NonceRequest>,
) -> Result<Json<NonceResponse>> {
    if req.address.is_empty() {
        return Err(AppError::BadRequest("address is required".into()));
    }

    let nonce = siws::generate_nonce();
    let issued_at = Utc::now().to_rfc3339();

    state
        .nonces
        .lock()
        .unwrap()
        .insert(req.address.clone(), (nonce.clone(), issued_at.clone()));

    Ok(Json(NonceResponse { nonce, issued_at }))
}

/// Verify a SIWS signature.
/// Consumes the stored nonce (one-time use) and returns a session token on success.
pub async fn verify(
    State(state): State<AppState>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>> {
    // Consume the nonce — remove it regardless of outcome to prevent replay.
    let entry = state
        .nonces
        .lock()
        .unwrap()
        .remove(&req.address);

    let (nonce, issued_at) = entry
        .ok_or_else(|| AppError::BadRequest("no pending nonce for this address".into()))?;

    let domain = std::env::var("APP_DOMAIN").unwrap_or_else(|_| "lance.app".into());
    let message = siws::build_message(&domain, &req.address, &nonce, &issued_at);

    siws::verify(&req.address, &message, &req.signature)
        .map_err(|e| AppError::BadRequest(e.to_string()))?;

    // Issue a simple random session token.
    // In production, replace with a signed JWT or encrypted cookie.
    let token = siws::generate_nonce(); // reuse the 32-byte random hex generator

    Ok(Json(VerifyResponse { token }))
}

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router() -> axum::Router<AppState> {
    use axum::routing::post;
    axum::Router::new()
        .route("/nonce", post(nonce))
        .route("/verify", post(verify))
}
