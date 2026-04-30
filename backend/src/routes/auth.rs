//! SIWS (Sign-In With Stellar) authentication routes.
//!
//! Flow:
//!   1. `GET  /api/v1/auth/nonce?address=G…`  → `{ nonce }`
//!   2. `POST /api/v1/auth/verify`             → `{ token, expires_at }`
//!
//! Freighter v5+ (freighter-api ≥ 5.0.0) signs:
//!   SHA-256("Stellar Signed Message:\n" + utf8(message))
//! This prefix is enforced by the Freighter extension background script.

use axum::{
    extract::{FromRequestParts, Query, State},
    http::request::Parts,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::{Duration, Utc};
use ed25519_dalek::{Signature, VerifyingKey};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Instant;

use crate::{
    db::{AppState, NONCE_TTL_SECS},
    error::{AppError, Result},
};

// ── JWT Claims ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    /// Subject: the Stellar G… address.
    sub: String,
    /// Issued-at (Unix seconds).
    iat: i64,
    /// Expiry (Unix seconds).
    exp: i64,
    /// Issuer.
    iss: String,
    /// Stellar network the user authenticated on.
    network: String,
}

// ── Request / Response shapes ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct NonceQuery {
    address: String,
}

#[derive(Debug, Serialize)]
struct NonceResponse {
    nonce: String,
}

#[derive(Debug, Deserialize)]
struct VerifyRequest {
    /// Stellar G… public address.
    address: String,
    /// The full SIWS message that was signed (reconstructed and compared server-side).
    message: String,
    /// Base64-encoded Ed25519 signature over SHA-256("Stellar Signed Message:\n" + message).
    signature: String,
}

#[derive(Debug, Serialize)]
struct AuthResponse {
    /// Signed JWT.
    token: String,
    /// ISO 8601 expiry timestamp.
    expires_at: String,
}

// ── Authenticated-user extractor ──────────────────────────────────────────────

/// Axum extractor that validates `Authorization: Bearer <jwt>`.
/// Add this as the first parameter to any handler that requires auth.
#[derive(Debug)]
pub struct AuthenticatedUser {
    /// The Stellar G… address embedded as the JWT subject.
    pub address: String,
    /// The Stellar network the token was issued for.
    pub network: String,
}

#[axum::async_trait]
impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self> {
        let auth_header = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| AppError::Unauthorized("missing Authorization header".into()))?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or_else(|| {
                AppError::Unauthorized("Authorization header must be 'Bearer <token>'".into())
            })?;

        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_issuer(&["lance-api"]);

        let data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
            &validation,
        )
        .map_err(|e| AppError::Unauthorized(format!("invalid token: {e}")))?;

        Ok(AuthenticatedUser {
            address: data.claims.sub,
            network: data.claims.network,
        })
    }
}

// ── Router ────────────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/nonce", get(get_nonce))
        .route("/verify", post(verify_siws))
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// `GET /api/v1/auth/nonce?address=<G…>`
///
/// Generates a cryptographically-random nonce, stores it in the in-memory map
/// (keyed by wallet address, TTL = 5 min), and returns it to the client.
async fn get_nonce(
    State(state): State<AppState>,
    Query(params): Query<NonceQuery>,
) -> Result<Json<NonceResponse>> {
    let address = params.address.trim().to_string();
    validate_stellar_address(&address)?;

    // Evict any expired entries opportunistically.
    evict_expired_nonces(&state);

    // Generate a 32-byte random nonce, hex-encoded.
    let nonce: String = {
        let bytes: [u8; 32] = rand::thread_rng().gen();
        hex::encode(bytes)
    };

    state
        .nonces
        .insert(address, (nonce.clone(), Instant::now()));

    Ok(Json(NonceResponse { nonce }))
}

/// `POST /api/v1/auth/verify`
///
/// Verifies the Ed25519 signature over SHA-256(SIWS message), then issues a JWT.
async fn verify_siws(
    State(state): State<AppState>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<AuthResponse>> {
    let address = req.address.trim().to_string();
    validate_stellar_address(&address)?;

    // 1. Look up the stored nonce for this address.
    let (stored_nonce, created_at) = state
        .nonces
        .get(&address)
        .map(|e| (e.0.clone(), e.1))
        .ok_or_else(|| {
            AppError::BadRequest("no nonce found for this address — request a new one".into())
        })?;

    // 2. Check nonce TTL.
    if created_at.elapsed().as_secs() > NONCE_TTL_SECS {
        state.nonces.remove(&address);
        return Err(AppError::BadRequest(
            "nonce has expired — request a new one".into(),
        ));
    }

    // 3. Verify message structure: must contain the address, the stored nonce,
    //    the expected network, and start with the canonical prefix.
    if !req.message.contains(&address) {
        tracing::error!("SIWS message does not contain the correct address");
        return Err(AppError::Unauthorized(
            "SIWS message does not contain the correct address".into(),
        ));
    }

    let expected_nonce_str = format!("Nonce: {}", stored_nonce);
    if !req.message.contains(&expected_nonce_str) {
        tracing::error!("SIWS message does not contain the correct nonce");
        return Err(AppError::Unauthorized(
            "SIWS message does not contain the correct nonce".into(),
        ));
    }

    let expected_network = determine_network();
    let expected_chain_str = format!("Chain ID: {}", expected_network);
    if !req.message.contains(&expected_chain_str) {
        tracing::error!("SIWS message does not contain the correct network");
        return Err(AppError::Unauthorized(format!(
            "SIWS message does not contain the correct network (expected {})",
            expected_network
        )));
    }

    if !req.message.starts_with("Lance wants you to sign in") {
        tracing::error!("SIWS message format invalid");
        return Err(AppError::Unauthorized(
            "SIWS message format invalid".into(),
        ));
    }

    // 3b. Parse and enforce the Expiration Time embedded in the SIWS message.
    let expiry_str = req
        .message
        .lines()
        .find_map(|line| line.strip_prefix("Expiration Time: "))
        .ok_or_else(|| {
            AppError::Unauthorized("SIWS message missing Expiration Time".into())
        })?;
    let expiry = chrono::DateTime::parse_from_rfc3339(expiry_str).map_err(|_| {
        AppError::Unauthorized("SIWS message has invalid Expiration Time format".into())
    })?;
    if Utc::now() > expiry.with_timezone(&Utc) {
        tracing::error!("SIWS message has expired");
        return Err(AppError::Unauthorized("SIWS message has expired".into()));
    }

    // 4. Decode the wallet's public key from the Stellar G… address.
    let pub_key_bytes = decode_stellar_address(&address)
        .map_err(|_| AppError::BadRequest("invalid Stellar address".into()))?;

    let verifying_key = VerifyingKey::from_bytes(&pub_key_bytes).map_err(|_| {
        tracing::error!("could not reconstruct Ed25519 public key");
        AppError::Unauthorized("could not reconstruct Ed25519 public key".into())
    })?;

    // 5. Decode and verify the signature.
    //    Freighter (API v5+) signs SHA-256("Stellar Signed Message:\n" + utf8(message)).
    //    This prefix is hard-coded in the Freighter extension background script.
    let sig_bytes = B64.decode(&req.signature).map_err(|e| {
        tracing::error!("signature is not valid base64: {}", e);
        AppError::Unauthorized("signature is not valid base64".into())
    })?;

    if sig_bytes.len() != 64 {
        tracing::error!("signature must be 64 bytes, got {}", sig_bytes.len());
        return Err(AppError::Unauthorized("signature must be 64 bytes".into()));
    }

    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(&sig_bytes);
    let signature = Signature::from_bytes(&sig_arr);

    // Build the preimage: "Stellar Signed Message:\n" + message (UTF-8)
    use ed25519_dalek::Verifier;
    let prefix = b"Stellar Signed Message:\n";
    let msg_bytes = req.message.as_bytes();
    let mut preimage = Vec::with_capacity(prefix.len() + msg_bytes.len());
    preimage.extend_from_slice(prefix);
    preimage.extend_from_slice(msg_bytes);
    let hash = Sha256::digest(&preimage);

    verifying_key.verify(&hash, &signature).map_err(|e| {
        tracing::error!("SIWS signature verification failed: {}", e);
        AppError::Unauthorized("signature verification failed".into())
    })?;

    // 6. Nonce is single-use — consume it immediately.
    state.nonces.remove(&address);

    // 7. Issue JWT (24-hour TTL).
    let now = Utc::now();
    let expires_at = now + Duration::hours(24);
    let claims = Claims {
        sub: address.clone(),
        iat: now.timestamp(),
        exp: expires_at.timestamp(),
        iss: "lance-api".to_string(),
        network: determine_network(),
    };

    let token = encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(state.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(anyhow::anyhow!("JWT encoding error: {e}")))?;

    tracing::info!(address = %address, "SIWS authentication successful — JWT issued");

    Ok(Json(AuthResponse {
        token,
        expires_at: expires_at.to_rfc3339(),
    }))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Build the canonical SIWS message that both client and server must agree on.
pub fn build_siws_message(address: &str, nonce: &str) -> String {
    let now = Utc::now();
    let expiry = now + Duration::minutes(5);
    let network = determine_network();

    format!(
        "Lance wants you to sign in with your Stellar account:\n\
         {address}\n\
         \n\
         Sign this message to authenticate with Lance.\n\
         This does not initiate any on-chain transaction or cost any fees.\n\
         \n\
         Nonce: {nonce}\n\
         Issued At: {issued}\n\
         Expiration Time: {expiry}\n\
         Chain ID: {network}",
        address = address,
        nonce = nonce,
        issued = now.to_rfc3339(),
        expiry = expiry.to_rfc3339(),
        network = network,
    )
}

/// Determine which network string to embed in tokens.
fn determine_network() -> String {
    let passphrase = std::env::var("STELLAR_NETWORK_PASSPHRASE")
        .unwrap_or_else(|_| "Test SDF Network ; September 2015".to_string());
    if passphrase.contains("Public Global") {
        "mainnet".to_string()
    } else {
        "testnet".to_string()
    }
}

/// Validate a Stellar public address: must start with 'G' and be 56 chars.
fn validate_stellar_address(address: &str) -> Result<()> {
    if address.len() == 56 && address.starts_with('G') {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!(
            "'{address}' is not a valid Stellar address (must start with G, 56 chars)"
        )))
    }
}

/// Decode a Stellar G… address to its raw 32-byte Ed25519 public key.
///
/// Stellar addresses are: version_byte(1) + pubkey(32) + crc16(2), base32-encoded.
/// The CRC16-XModem checksum covers the version byte and pubkey bytes.
fn decode_stellar_address(address: &str) -> anyhow::Result<[u8; 32]> {
    use anyhow::bail;

    let decoded = base32_decode(address).ok_or_else(|| anyhow::anyhow!("invalid base32"))?;
    if decoded.len() != 35 {
        bail!("unexpected decoded length: {}", decoded.len());
    }
    // Version byte for Ed25519 public keys = 6 << 3 = 48 (0x30)
    if decoded[0] != (6 << 3) {
        bail!("wrong version byte: {:#x}", decoded[0]);
    }
    // Validate CRC16-XModem checksum (last 2 bytes, little-endian).
    let expected_crc = u16::from_le_bytes([decoded[33], decoded[34]]);
    let actual_crc = crc16_xmodem(&decoded[..33]);
    if expected_crc != actual_crc {
        bail!(
            "address checksum mismatch (expected {:#06x}, got {:#06x})",
            expected_crc,
            actual_crc
        );
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&decoded[1..33]);
    Ok(key)
}

/// Evict nonce entries older than [`NONCE_TTL_SECS`].
fn evict_expired_nonces(state: &AppState) {
    state
        .nonces
        .retain(|_, (_, created_at)| created_at.elapsed().as_secs() <= NONCE_TTL_SECS);
}

/// CRC16-XModem used by the Stellar address format to protect against typos.
fn crc16_xmodem(data: &[u8]) -> u16 {
    let mut crc: u16 = 0;
    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            if crc & 0x8000 != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

/// Minimal base32 (RFC 4648) decoder — mirrors the one in stellar.rs.
fn base32_decode(input: &str) -> Option<Vec<u8>> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let input = input.trim_end_matches('=');
    let mut bits = 0u64;
    let mut bit_count = 0u32;
    let mut out = Vec::new();
    for &c in input.as_bytes() {
        let val = ALPHABET.iter().position(|&a| a == c)? as u64;
        bits = (bits << 5) | val;
        bit_count += 5;
        if bit_count >= 8 {
            bit_count -= 8;
            out.push((bits >> bit_count) as u8);
            bits &= (1u64 << bit_count) - 1;
        }
    }
    Some(out)
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_stellar_address_valid() {
        let addr = "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR";
        assert!(validate_stellar_address(addr).is_ok());
    }

    #[test]
    fn test_validate_stellar_address_invalid() {
        assert!(validate_stellar_address("short").is_err());
        assert!(validate_stellar_address("SAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN").is_err());
    }

    #[test]
    fn test_siws_message_contains_required_fields() {
        let address = "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR";
        let nonce = "abc123";
        let msg = build_siws_message(address, nonce);
        assert!(msg.contains(address));
        assert!(msg.contains(nonce));
        assert!(msg.contains("Lance wants you to sign in"));
        assert!(msg.contains("Nonce:"));
        assert!(msg.contains("Chain ID:"));
        assert!(msg.contains("Expiration Time:"));
    }

    #[test]
    fn test_determine_network_testnet() {
        let network = determine_network();
        assert!(network == "testnet" || network == "mainnet");
    }

    #[test]
    fn test_crc16_xmodem_known_value() {
        // CRC16-XModem of empty slice is 0.
        assert_eq!(crc16_xmodem(&[]), 0x0000);
        // CRC16-XModem of [0x31] ('1') should be a well-known value.
        let result = crc16_xmodem(b"123456789");
        assert_eq!(result, 0x31C3); // standard test vector for XModem
    }

    #[test]
    fn test_siws_message_expiry_parseable() {
        let address = "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR";
        let msg = build_siws_message(address, "nonce123");
        let expiry_str = msg
            .lines()
            .find_map(|line| line.strip_prefix("Expiration Time: "))
            .expect("Expiration Time line must exist");
        chrono::DateTime::parse_from_rfc3339(expiry_str)
            .expect("Expiration Time must be valid RFC3339");
    }

    #[test]
    fn test_js_iso_string_expiry_parseable() {
        // JavaScript Date.toISOString() always returns this exact format with milliseconds.
        // Make sure chrono's parse_from_rfc3339 handles it — this was a latent failure
        // mode when SHA-256 and the expiry check were introduced together.
        let js_iso = "2026-04-25T07:33:25.020Z";
        let parsed = chrono::DateTime::parse_from_rfc3339(js_iso);
        assert!(parsed.is_ok(), "JS toISOString format must parse: {:?}", parsed);
    }

    #[test]
    fn test_siws_signature_scheme() {
        // Verify the exact signing scheme Freighter v5+ uses:
        // signature = ed25519_sign(sha256("Stellar Signed Message:\n" + message), secretKey)
        use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
        use sha2::{Digest, Sha256};

        // Deterministic test keypair (all-0x01 seed)
        let secret_bytes = [1u8; 32];
        let signing_key = SigningKey::from_bytes(&secret_bytes);
        let verifying_key: VerifyingKey = signing_key.verifying_key();

        let message = "test SIWS message";
        let prefix = b"Stellar Signed Message:\n";
        let mut preimage = Vec::new();
        preimage.extend_from_slice(prefix);
        preimage.extend_from_slice(message.as_bytes());
        let hash = Sha256::digest(&preimage);

        let signature: Signature = signing_key.sign(&hash);
        assert!(verifying_key.verify(&hash, &signature).is_ok(),
            "round-trip SIWS signature verification must succeed");

        // Ensure raw message bytes do NOT verify (wrong scheme)
        assert!(verifying_key.verify(message.as_bytes(), &signature).is_err(),
            "raw message bytes must not verify with the prefixed signature");
    }
}
