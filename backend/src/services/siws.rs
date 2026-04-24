//! Sign-In With Stellar (SIWS) — nonce generation and signature verification.
//!
//! Message format (plain-text, signed by the wallet):
//! ```
//! <domain> wants you to sign in with your Stellar account:
//! <address>
//!
//! Nonce: <hex-nonce>
//! Issued At: <iso8601>
//! ```
//!
//! The wallet signs the UTF-8 bytes of this message with its ed25519 key.
//! The backend verifies the signature against the public key encoded in the
//! Stellar G-address (strkey, version byte 6 << 3 = 0x30).

use ed25519_dalek::{Signature, VerifyingKey};
use rand::RngCore;

const STRKEY_VERSION_ACCOUNT: u8 = 6 << 3; // 0x30

/// Generate a cryptographically random 32-byte hex nonce.
pub fn generate_nonce() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Build the canonical SIWS message that the wallet must sign.
pub fn build_message(domain: &str, address: &str, nonce: &str, issued_at: &str) -> String {
    format!(
        "{domain} wants you to sign in with your Stellar account:\n\
         {address}\n\
         \n\
         Nonce: {nonce}\n\
         Issued At: {issued_at}"
    )
}

/// Decode a Stellar G-address into its raw 32-byte ed25519 public key.
fn decode_stellar_address(address: &str) -> anyhow::Result<[u8; 32]> {
    // Stellar strkey: base32(version_byte || payload || crc16)
    let decoded = base32::decode(base32::Alphabet::RFC4648 { padding: false }, address)
        .ok_or_else(|| anyhow::anyhow!("invalid base32 in address"))?;

    // minimum: 1 version + 32 payload + 2 crc = 35 bytes
    if decoded.len() < 35 {
        anyhow::bail!("address too short");
    }
    if decoded[0] != STRKEY_VERSION_ACCOUNT {
        anyhow::bail!("not an account address (wrong version byte)");
    }

    let payload = &decoded[1..decoded.len() - 2];
    if payload.len() != 32 {
        anyhow::bail!("unexpected payload length");
    }

    let mut key = [0u8; 32];
    key.copy_from_slice(payload);
    Ok(key)
}

/// Verify a SIWS signature.
///
/// * `address`   — Stellar G-address of the signer
/// * `message`   — the canonical SIWS message (as produced by [`build_message`])
/// * `signature` — hex-encoded 64-byte ed25519 signature
pub fn verify(address: &str, message: &str, signature_hex: &str) -> anyhow::Result<()> {
    let key_bytes = decode_stellar_address(address)?;
    let verifying_key = VerifyingKey::from_bytes(&key_bytes)
        .map_err(|e| anyhow::anyhow!("invalid public key: {e}"))?;

    let sig_bytes = hex::decode(signature_hex)
        .map_err(|_| anyhow::anyhow!("signature is not valid hex"))?;
    if sig_bytes.len() != 64 {
        anyhow::bail!("signature must be 64 bytes");
    }
    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(&sig_bytes);
    let signature = Signature::from_bytes(&sig_arr);

    verifying_key
        .verify_strict(message.as_bytes(), &signature)
        .map_err(|_| anyhow::anyhow!("signature verification failed"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nonce_is_64_hex_chars() {
        let n = generate_nonce();
        assert_eq!(n.len(), 64);
        assert!(n.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn message_contains_expected_fields() {
        let msg = build_message("example.com", "GABC", "deadbeef", "2026-01-01T00:00:00Z");
        assert!(msg.contains("example.com wants you to sign in"));
        assert!(msg.contains("GABC"));
        assert!(msg.contains("Nonce: deadbeef"));
        assert!(msg.contains("Issued At: 2026-01-01T00:00:00Z"));
    }

    #[test]
    fn rejects_bad_signature_hex() {
        let result = verify("GABC", "msg", "not-hex");
        assert!(result.is_err());
    }
}
