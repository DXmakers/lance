use axum::{extract::State, routing::post, Json, Router};
use base64::Engine;
use chrono::{Duration, Utc};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use uuid::Uuid;

use crate::{
    db::AppState,
    error::{AppError, Result},
    models::{AuthChallengeRequest, AuthChallengeResponse, AuthVerifyRequest, AuthVerifyResponse},
    services::stellar::{base32_decode, crc16_xmodem},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/challenge", post(get_challenge))
        .route("/verify", post(verify_signature))
}

async fn get_challenge(
    State(state): State<AppState>,
    Json(req): Json<AuthChallengeRequest>,
) -> Result<Json<AuthChallengeResponse>> {
    let challenge = format!(
        "Lance wants you to sign in with your Stellar account:\n{}\n\nNonce: {}",
        req.address,
        Uuid::new_v4()
    );

    let expires_at = Utc::now() + Duration::minutes(5);

    sqlx::query(
        "INSERT INTO auth_challenges (address, challenge, expires_at) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (address) DO UPDATE SET challenge = EXCLUDED.challenge, expires_at = EXCLUDED.expires_at"
    )
    .bind(&req.address)
    .bind(&challenge)
    .bind(expires_at)
    .execute(&state.pool)
    .await?;

    Ok(Json(AuthChallengeResponse {
        address: req.address,
        challenge,
    }))
}

async fn verify_signature(
    State(state): State<AppState>,
    Json(req): Json<AuthVerifyRequest>,
) -> Result<Json<AuthVerifyResponse>> {
    // 1. Fetch challenge
    let challenge_row = sqlx::query_as::<_, (String, chrono::DateTime<Utc>)>(
        "SELECT challenge, expires_at FROM auth_challenges WHERE address = $1",
    )
    .bind(&req.address)
    .fetch_optional(&state.pool)
    .await?;

    let challenge = match challenge_row {
        Some((challenge, expires_at)) if expires_at > Utc::now() => challenge,
        _ => {
            return Err(AppError::BadRequest(
                "Challenge expired or not found".into(),
            ))
        }
    };

    // 2. Verify signature
    let public_key_bytes = decode_stellar_public_key(&req.address)?;
    let verifying_key = VerifyingKey::from_bytes(&public_key_bytes)
        .map_err(|_| AppError::BadRequest("Invalid public key".into()))?;

    let sig_bytes = hex::decode(&req.signature)
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(&req.signature))
        .map_err(|_| AppError::BadRequest("Invalid signature format".into()))?;

    let signature = Signature::from_slice(&sig_bytes)
        .map_err(|_| AppError::BadRequest("Invalid signature length".into()))?;

    verifying_key
        .verify(challenge.as_bytes(), &signature)
        .map_err(|_| AppError::Unauthorized("Invalid signature".into()))?;

    // 3. Create session
    let token = Uuid::new_v4().to_string();
    let expires_at = Utc::now() + Duration::days(7);

    sqlx::query("INSERT INTO sessions (token, address, expires_at) VALUES ($1, $2, $3)")
        .bind(&token)
        .bind(&req.address)
        .bind(expires_at)
        .execute(&state.pool)
        .await?;

    // 4. Cleanup challenge
    sqlx::query("DELETE FROM auth_challenges WHERE address = $1")
        .bind(&req.address)
        .execute(&state.pool)
        .await?;

    Ok(Json(AuthVerifyResponse {
        token,
        address: req.address,
    }))
}

/// Helper to decode Stellar G... address to 32 bytes public key
fn decode_stellar_public_key(address: &str) -> Result<[u8; 32]> {
    let decoded =
        base32_decode(address).ok_or_else(|| AppError::BadRequest("Invalid base32".into()))?;
    if decoded.len() != 35 {
        return Err(AppError::BadRequest("Invalid address length".into()));
    }
    if decoded[0] != (6 << 3) {
        return Err(AppError::BadRequest("Not a Stellar public key".into()));
    }

    // Verify checksum
    let payload = &decoded[0..33];
    let checksum = &decoded[33..35];
    let expected_crc = crc16_xmodem(payload);
    let actual_crc = (checksum[0] as u16) | ((checksum[1] as u16) << 8);

    if expected_crc != actual_crc {
        return Err(AppError::BadRequest("Invalid checksum".into()));
    }

    let mut key = [0u8; 32];
    key.copy_from_slice(&decoded[1..33]);
    Ok(key)
}
