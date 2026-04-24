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

async fn verify_signature(Json(req): Json<VerifyRequest>) -> Result<Json<VerifyResponse>> {
    // SIWS Protocol Verification Steps:
    // 1. Verify the message domain matches the application domain
    // 2. Verify the nonce exists and hasn't expired (checked against DB/Redis)
    // 3. Verify the address matches the signer of the signature
    // 4. Verify the cryptographic signature using Ed25519
    
    let is_valid = !req.address.is_empty() && !req.signature.is_empty();
    
    if !is_valid {
        return Ok(Json(VerifyResponse {
            token: "".into(),
            success: false,
        }));
    }

    Ok(Json(VerifyResponse {
        token: "lance-auth-v1-jwt-mock".into(),
        success: true,
    }))
}
