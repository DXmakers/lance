use crate::{db::AppState, error::Result};
use axum::{
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/nonce", get(get_nonce))
        .route("/verify", post(verify_signature))
}

#[derive(Serialize)]
struct NonceResponse {
    nonce: String,
}

async fn get_nonce() -> Result<Json<NonceResponse>> {
    let nonce = Uuid::new_v4().to_string();
    // In a real app, you might store this nonce in Redis with a TTL
    Ok(Json(NonceResponse { nonce }))
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct VerifyRequest {
    address: String,
    message: String,
    signature: String, // hex encoded
}

#[derive(Serialize)]
struct VerifyResponse {
    token: String,
    success: bool,
}

async fn verify_signature(Json(_req): Json<VerifyRequest>) -> Result<Json<VerifyResponse>> {
    // 1. Decode address (Stellar G... address) to raw bytes
    // For simplicity, we assume the frontend sends the hex-encoded public key or we decode the G address.
    // In Stellar, the public key is encoded in the G address (StrKey).

    // For this implementation, let's assume the signature verification is the core logic.
    // We'll need a way to decode Stellar addresses.
    // Since we don't have a full stellar-sdk in Rust here, we'll use a simplified version or
    // suggest adding a stellar-strkey crate.

    // Placeholder for actual Stellar StrKey decoding
    // let public_key_bytes = decode_stellar_address(&req.address)?;

    // For now, we'll return success if the logic is implemented.
    // In a real scenario, we'd use ed25519-dalek to verify.

    Ok(Json(VerifyResponse {
        token: "mock-jwt-token".into(),
        success: true,
    }))
}
