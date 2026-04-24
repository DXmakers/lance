use crate::{db::AppState, error::{AppError, Result}};
use axum::{extract::State, routing::{get, post}, Json, Router};
use ed25519_dalek::{Signature, VerifyingKey};
use jsonwebtoken::{encode, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use stellar_strkey::ed25519::PublicKey as StrKey;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/nonce", get(get_nonce))
        .route("/verify", post(verify_signature))
}

// ── GET /nonce ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct NonceResponse {
    nonce: String,
}

async fn get_nonce(State(state): State<AppState>) -> Result<Json<NonceResponse>> {
    let nonce = Uuid::new_v4().to_string();
    state.nonces.insert(&nonce);
    Ok(Json(NonceResponse { nonce }))
}

// ── POST /verify ──────────────────────────────────────────────────────────────

/// The frontend must sign exactly this message (UTF-8 bytes):
///   "lance:auth:<nonce>"
#[derive(Deserialize)]
struct VerifyRequest {
    /// Stellar G… address of the signer.
    address: String,
    /// The nonce obtained from GET /nonce.
    nonce: String,
    /// Hex-encoded 64-byte ed25519 signature over "lance:auth:<nonce>".
    signature: String,
}

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: String, // Stellar address
    exp: usize,
}

#[derive(Serialize)]
struct VerifyResponse {
    token: String,
}

async fn verify_signature(
    State(state): State<AppState>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>> {
    // 1. Consume nonce (one-time, TTL-checked).
    if !state.nonces.consume(&req.nonce) {
        return Err(AppError::Unauthorized("invalid or expired nonce".into()));
    }

    // 2. Decode Stellar G… address → raw 32-byte public key.
    let strkey = StrKey::from_string(&req.address)
        .map_err(|_| AppError::BadRequest("invalid Stellar address".into()))?;
    let verifying_key = VerifyingKey::from_bytes(&strkey.0)
        .map_err(|_| AppError::BadRequest("invalid public key bytes".into()))?;

    // 3. Decode hex signature → 64 bytes.
    let sig_bytes = hex::decode(&req.signature)
        .map_err(|_| AppError::BadRequest("signature must be hex-encoded".into()))?;
    let sig_array: [u8; 64] = sig_bytes
        .try_into()
        .map_err(|_| AppError::BadRequest("signature must be 64 bytes".into()))?;
    let signature = Signature::from_bytes(&sig_array);

    // 4. Verify ed25519 signature over canonical message.
    let message = format!("lance:auth:{}", req.nonce);
    verifying_key
        .verify_strict(message.as_bytes(), &signature)
        .map_err(|_| AppError::Unauthorized("signature verification failed".into()))?;

    // 5. Issue JWT (24-hour expiry).
    let exp = (chrono::Utc::now() + chrono::Duration::hours(24)).timestamp() as usize;
    let claims = Claims { sub: req.address, exp };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    Ok(Json(VerifyResponse { token }))
}
