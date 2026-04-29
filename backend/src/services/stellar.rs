//! Stellar Horizon + Soroban RPC service.
//! Builds InvokeHostFunction XDR transactions, signs with the judge authority
//! keypair, submits via Soroban RPC `sendTransaction`, and polls
//! `getTransaction` until confirmed or failed.

#![allow(dead_code)]

use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signer, SigningKey};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;
use stellar_xdr::curr as sxdr;
use stellar_xdr::curr::{Limits, ReadXdr, WriteXdr};

/// Soroban network passphrase for testnet. Override via `STELLAR_NETWORK_PASSPHRASE`.
const DEFAULT_NETWORK_PASSPHRASE: &str = "Test SDF Network ; September 2015";
/// Default Soroban RPC URL. Override via `SOROBAN_RPC_URL`.
const DEFAULT_RPC_URL: &str = "https://soroban-testnet.stellar.org";
/// Default Horizon URL. Override via `HORIZON_URL`.
const DEFAULT_HORIZON_URL: &str = "https://horizon-testnet.stellar.org";
/// Maximum number of polls before giving up on transaction confirmation.
const MAX_POLL_ATTEMPTS: u32 = 30;
/// Delay between `getTransaction` polls.
const POLL_INTERVAL: Duration = Duration::from_secs(2);

// ── JSON-RPC types ───────────────────────────────────────────────────────────

#[derive(Serialize)]
struct RpcRequest<'a> {
    jsonrpc: &'a str,
    id: u64,
    method: &'a str,
    params: serde_json::Value,
}

#[derive(Deserialize, Debug)]
struct RpcResponse {
    result: Option<serde_json::Value>,
    error: Option<RpcError>,
}

#[derive(Deserialize, Debug)]
struct RpcError {
    message: String,
}

#[derive(Deserialize, Debug)]
struct HorizonAccount {
    sequence: String,
}

#[derive(Deserialize, Debug)]
struct SimulateResult {
    #[serde(rename = "transactionData")]
    transaction_data: Option<String>,
    #[serde(rename = "minResourceFee")]
    min_resource_fee: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize, Debug)]
struct SendTxResult {
    hash: Option<String>,
    status: String,
    #[serde(rename = "errorResultXdr")]
    error_result_xdr: Option<String>,
}

#[derive(Deserialize, Debug)]
struct GetTxResult {
    status: String,
    #[serde(rename = "envelopeXdr")]
    envelope_xdr: Option<String>,
    #[serde(rename = "resultXdr")]
    result_xdr: Option<String>,
}

// ── StellarService ───────────────────────────────────────────────────────────

pub struct StellarService {
    signing_key: SigningKey,
    public_key: [u8; 32],
    contract_id: String,
    rpc_url: String,
    horizon_url: String,
    network_passphrase: String,
    client: Client,
}

impl StellarService {
    /// Build from environment variables:
    /// - `JUDGE_AUTHORITY_SECRET` (required) — Stellar secret key (S…)
    /// - `ESCROW_CONTRACT_ID`     (required) — deployed Soroban contract id (C…)
    /// - `SOROBAN_RPC_URL`        (optional)
    /// - `HORIZON_URL`            (optional)
    /// - `STELLAR_NETWORK_PASSPHRASE` (optional)
    pub fn from_env() -> Self {
        let secret =
            std::env::var("JUDGE_AUTHORITY_SECRET").expect("JUDGE_AUTHORITY_SECRET must be set");
        let contract_id =
            std::env::var("ESCROW_CONTRACT_ID").expect("ESCROW_CONTRACT_ID must be set");
        let rpc_url =
            std::env::var("SOROBAN_RPC_URL").unwrap_or_else(|_| DEFAULT_RPC_URL.to_string());
        let horizon_url =
            std::env::var("HORIZON_URL").unwrap_or_else(|_| DEFAULT_HORIZON_URL.to_string());
        let network_passphrase = std::env::var("STELLAR_NETWORK_PASSPHRASE")
            .unwrap_or_else(|_| DEFAULT_NETWORK_PASSPHRASE.to_string());

        let raw = decode_stellar_secret(&secret).expect("invalid JUDGE_AUTHORITY_SECRET");
        let signing_key = SigningKey::from_bytes(&raw);
        let public_key = signing_key.verifying_key().to_bytes();

        Self {
            signing_key,
            public_key,
            contract_id,
            rpc_url,
            horizon_url,
            network_passphrase,
            client: Client::new(),
        }
    }

    /// Constructor for tests that takes explicit parameters.
    #[cfg(test)]
    pub fn new(
        signing_key: SigningKey,
        contract_id: String,
        rpc_url: String,
        horizon_url: String,
        network_passphrase: String,
    ) -> Self {
        let public_key = signing_key.verifying_key().to_bytes();
        Self {
            signing_key,
            public_key,
            contract_id,
            rpc_url,
            horizon_url,
            network_passphrase,
            client: Client::new(),
        }
    }

    // ── Public contract methods ──────────────────────────────────────────────

    /// Call escrow `release_milestone(job_id, milestone_index)` on-chain.
    /// Returns the transaction hash on success.
    pub async fn release_milestone(&self, job_id: &str, milestone_index: i32) -> Result<String> {
        let args = vec![scval_string(job_id)?, scval_i32(milestone_index)];
        self.invoke_contract_with_retry("release_milestone", &args)
            .await
    }

    /// Call escrow `open_dispute(job_id)` on-chain.
    pub async fn open_dispute(&self, job_id: &str) -> Result<String> {
        let args = vec![scval_string(job_id)?];
        self.invoke_contract_with_retry("open_dispute", &args).await
    }

    /// Call escrow `resolve_dispute(job_id, payee_amount, payer_amount)` on-chain.
    pub async fn resolve_dispute(
        &self,
        job_id: u64,
        payee_amount: i128,
        payer_amount: i128,
    ) -> Result<String> {
        let args = vec![
            scval_u64(job_id),
            scval_i128(payee_amount),
            scval_i128(payer_amount),
        ];
        self.invoke_contract_with_retry("resolve_dispute", &args)
            .await
    }

    // ── Core submission pipeline ─────────────────────────────────────────────

    /// Build, simulate, sign, send, and poll — with one retry on sequence
    /// number collision (tx_bad_seq).
    async fn invoke_contract_with_retry(
        &self,
        method: &str,
        args: &[sxdr::ScVal],
    ) -> Result<String> {
        match self.invoke_contract(method, args).await {
            Ok(hash) => Ok(hash),
            Err(e) if is_seq_error(&e) => {
                tracing::warn!("sequence collision, retrying once: {e}");
                self.invoke_contract(method, args).await
            }
            Err(e) => Err(e),
        }
    }

    async fn invoke_contract(&self, method: &str, args: &[sxdr::ScVal]) -> Result<String> {
        // 1. Fetch current sequence number from Horizon
        let sequence = self
            .fetch_sequence()
            .await
            .context("failed to fetch account sequence")?;

        // 2. Build the InvokeHostFunction XDR envelope (unsigned)
        let invoke_xdr = build_invoke_host_fn_xdr(
            &self.public_key,
            sequence + 1,
            &self.contract_id,
            method,
            args,
        )?;
        tracing::debug!(
            contract_id = %self.contract_id,
            sequence = sequence + 1,
            method = %method,
            unsigned_payload_len = invoke_xdr.len(),
            "soroban invoke payload built"
        );

        // 3. Simulate the transaction to get resource fees and soroban data
        let sim = self
            .simulate_transaction(&invoke_xdr)
            .await
            .context("simulation failed")?;
        if let Some(ref err) = sim.error {
            bail!("simulation error: {err}");
        }
        tracing::debug!(
            transaction_data_present = sim.transaction_data.is_some(),
            min_resource_fee = ?sim.min_resource_fee,
            "soroban simulation succeeded"
        );

        // 4. Assemble the final transaction with resource fees
        let assembled = assemble_transaction(
            &invoke_xdr,
            sim.transaction_data.as_deref(),
            sim.min_resource_fee.as_deref(),
        )?;
        tracing::debug!(
            assembled_payload_len = assembled.len(),
            "soroban transaction assembled"
        );

        // 5. Sign the assembled transaction
        let signed = self.sign_envelope(&assembled)?;
        let signed_b64 = B64.encode(&signed);
        tracing::debug!(
            signed_payload_len = signed.len(),
            "soroban transaction signed"
        );

        // 6. Submit via sendTransaction
        let send_result = self
            .send_transaction(&signed_b64)
            .await
            .context("sendTransaction RPC call failed")?;

        if send_result.status == "ERROR" {
            bail!(
                "sendTransaction error: {}",
                send_result.error_result_xdr.as_deref().unwrap_or("unknown")
            );
        }

        tracing::debug!(status = %send_result.status, hash = ?send_result.hash, "soroban transaction submitted");

        let tx_hash = send_result
            .hash
            .ok_or_else(|| anyhow!("sendTransaction returned no hash"))?;

        // 7. Poll getTransaction until terminal status
        self.poll_transaction(&tx_hash).await?;

        Ok(tx_hash)
    }

    // ── RPC helpers ──────────────────────────────────────────────────────────

    async fn fetch_sequence(&self) -> Result<i64> {
        let account_id = encode_stellar_public_key(&self.public_key);
        let url = format!("{}/accounts/{}", self.horizon_url, account_id);
        let resp: HorizonAccount = self
            .client
            .get(&url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let seq: i64 = resp
            .sequence
            .parse()
            .context("invalid sequence number from Horizon")?;
        Ok(seq)
    }

    async fn simulate_transaction(&self, envelope_xdr: &[u8]) -> Result<SimulateResult> {
        let b64 = B64.encode(envelope_xdr);
        let resp = self
            .rpc_call(
                "simulateTransaction",
                serde_json::json!({
                    "transaction": b64
                }),
            )
            .await?;
        let sim: SimulateResult =
            serde_json::from_value(resp).context("failed to parse simulateTransaction result")?;
        Ok(sim)
    }

    async fn send_transaction(&self, signed_b64: &str) -> Result<SendTxResult> {
        let resp = self
            .rpc_call(
                "sendTransaction",
                serde_json::json!({
                    "transaction": signed_b64
                }),
            )
            .await?;
        let result: SendTxResult =
            serde_json::from_value(resp).context("failed to parse sendTransaction result")?;
        Ok(result)
    }

    async fn poll_transaction(&self, hash: &str) -> Result<()> {
        for _ in 0..MAX_POLL_ATTEMPTS {
            tokio::time::sleep(POLL_INTERVAL).await;
            let resp = self
                .rpc_call(
                    "getTransaction",
                    serde_json::json!({
                        "hash": hash
                    }),
                )
                .await?;
            let result: GetTxResult =
                serde_json::from_value(resp).context("failed to parse getTransaction result")?;

            match result.status.as_str() {
                "SUCCESS" => return Ok(()),
                "FAILED" => bail!(
                    "transaction {hash} failed on-chain: {}",
                    result.result_xdr.as_deref().unwrap_or("no details")
                ),
                "NOT_FOUND" => continue, // still pending
                other => bail!("unexpected getTransaction status: {other}"),
            }
        }
        bail!("transaction {hash} not confirmed after {MAX_POLL_ATTEMPTS} polls")
    }

    async fn rpc_call(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value> {
        let req = RpcRequest {
            jsonrpc: "2.0",
            id: 1,
            method,
            params,
        };
        let resp: RpcResponse = self
            .client
            .post(&self.rpc_url)
            .json(&req)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        if let Some(err) = resp.error {
            bail!("RPC error ({}): {}", method, err.message);
        }
        resp.result
            .ok_or_else(|| anyhow!("RPC {method}: no result"))
    }

    /// Sign an XDR transaction envelope using ed25519.
    fn sign_envelope(&self, envelope_xdr: &[u8]) -> Result<Vec<u8>> {
        let envelope = sxdr::TransactionEnvelope::from_xdr(envelope_xdr, Limits::none())
            .map_err(|e| anyhow!("failed to decode envelope for signing: {e}"))?;

        let mut tx_v1 = match envelope {
            sxdr::TransactionEnvelope::Tx(tx) => tx,
            _ => bail!("unexpected envelope type for signing"),
        };

        let network_id = sxdr::Hash(Sha256::digest(self.network_passphrase.as_bytes()).into());
        let payload = sxdr::TransactionSignaturePayload {
            network_id,
            tagged_transaction: sxdr::TransactionSignaturePayloadTaggedTransaction::Tx(
                tx_v1.tx.clone(),
            ),
        };
        let payload_xdr = payload
            .to_xdr(Limits::none())
            .map_err(|e| anyhow!("failed to encode signature payload: {e}"))?;

        let signature = self.signing_key.sign(&Sha256::digest(&payload_xdr));
        let decorated = sxdr::DecoratedSignature {
            hint: sxdr::SignatureHint(self.public_key[28..32].try_into().expect("slice length")),
            signature: sxdr::Signature(sxdr::BytesM::try_from(signature.to_bytes().to_vec())?),
        };
        tx_v1.signatures = sxdr::VecM::try_from(vec![decorated])?;

        sxdr::TransactionEnvelope::Tx(tx_v1)
            .to_xdr(Limits::none())
            .map_err(|e| anyhow!("failed to encode signed envelope: {e}"))
    }
}

// ── XDR / ScVal helpers ──────────────────────────────────────────────────────

/// Build a minimal Soroban InvokeHostFunction transaction envelope in XDR.
///
/// This builds the XDR manually using basic byte serialization rather than
/// pulling in the full stellar-xdr crate's encoding pipeline, which keeps
/// the dependency surface small while still producing valid XDR.
fn build_invoke_host_fn_xdr(
    source_public_key: &[u8; 32],
    sequence: i64,
    contract_id: &str,
    method: &str,
    args: &[sxdr::ScVal],
) -> Result<Vec<u8>> {
    let contract_hash = decode_contract_id(contract_id)?;
    let operation = sxdr::Operation {
        source_account: None,
        body: sxdr::OperationBody::InvokeHostFunction(sxdr::InvokeHostFunctionOp {
            host_function: sxdr::HostFunction::InvokeContract(sxdr::InvokeContractArgs {
                contract_address: sxdr::ScAddress::Contract(sxdr::Hash(contract_hash)),
                function_name: sxdr::ScSymbol(sxdr::StringM::<32>::try_from(method)?),
                args: sxdr::VecM::try_from(args.to_vec())?,
            }),
            auth: sxdr::VecM::default(),
        }),
    };

    let tx = sxdr::Transaction {
        source_account: sxdr::MuxedAccount::Ed25519(sxdr::Uint256(*source_public_key)),
        fee: 100,
        seq_num: sxdr::SequenceNumber(sequence),
        cond: sxdr::Preconditions::None,
        memo: sxdr::Memo::None,
        operations: sxdr::VecM::try_from(vec![operation])?,
        ext: sxdr::TransactionExt::V0,
    };

    sxdr::TransactionEnvelope::Tx(sxdr::TransactionV1Envelope {
        tx,
        signatures: sxdr::VecM::default(),
    })
    .to_xdr(Limits::none())
    .map_err(|e| anyhow!("failed to encode invoke envelope: {e}"))
}

/// Assemble a transaction with resource data from simulation.
fn assemble_transaction(
    original: &[u8],
    transaction_data: Option<&str>,
    min_resource_fee: Option<&str>,
) -> Result<Vec<u8>> {
    let envelope = sxdr::TransactionEnvelope::from_xdr(original, Limits::none())
        .map_err(|e| anyhow!("failed to decode unsigned envelope: {e}"))?;
    let mut tx_v1 = match envelope {
        sxdr::TransactionEnvelope::Tx(tx) => tx,
        _ => bail!("unexpected envelope type for assembled transaction"),
    };

    let transaction_data_b64 =
        transaction_data.ok_or_else(|| anyhow!("simulation missing transactionData"))?;
    let transaction_data_xdr = B64
        .decode(transaction_data_b64)
        .map_err(|e| anyhow!("invalid transactionData base64: {e}"))?;
    let soroban_data = sxdr::SorobanTransactionData::from_xdr(transaction_data_xdr, Limits::none())
        .map_err(|e| anyhow!("failed to decode SorobanTransactionData: {e}"))?;

    let resource_fee: u32 = min_resource_fee
        .unwrap_or("0")
        .parse()
        .context("invalid minResourceFee from simulation")?;

    tx_v1.tx.fee = tx_v1.tx.fee.saturating_add(resource_fee);
    tx_v1.tx.ext = sxdr::TransactionExt::V1(soroban_data);

    sxdr::TransactionEnvelope::Tx(tx_v1)
        .to_xdr(Limits::none())
        .map_err(|e| anyhow!("failed to encode assembled envelope: {e}"))
}

/// Build a Soroban SCVal symbol.
fn scval_symbol(s: &str) -> Result<sxdr::ScVal> {
    Ok(sxdr::ScVal::Symbol(sxdr::ScSymbol(
        sxdr::StringM::<32>::try_from(s)?,
    )))
}

/// Build a Soroban SCVal string.
fn scval_string(s: &str) -> Result<sxdr::ScVal> {
    Ok(sxdr::ScVal::String(sxdr::ScString(
        sxdr::StringM::try_from(s)?,
    )))
}

/// Build a Soroban SCVal i32.
fn scval_i32(v: i32) -> sxdr::ScVal {
    sxdr::ScVal::I32(v)
}

/// Build a Soroban SCVal u32.
fn scval_u32(v: u32) -> sxdr::ScVal {
    sxdr::ScVal::U32(v)
}

/// Build a Soroban SCVal u64.
fn scval_u64(v: u64) -> sxdr::ScVal {
    sxdr::ScVal::U64(v)
}

/// Build a Soroban SCVal i128.
fn scval_i128(v: i128) -> sxdr::ScVal {
    sxdr::ScVal::I128(sxdr::Int128Parts {
        hi: (v >> 64) as i64,
        lo: v as u64,
    })
}

/// Decode a Stellar contract ID (C...) into raw 32-byte hash.
fn decode_contract_id(contract_id: &str) -> Result<[u8; 32]> {
    let decoded =
        base32_decode(contract_id).ok_or_else(|| anyhow!("invalid base32 in contract id"))?;
    if decoded.len() != 35 {
        bail!("contract id wrong length: {} (expected 35)", decoded.len());
    }
    if decoded[0] != (2 << 3) {
        bail!("not a Stellar contract id (wrong version byte)");
    }
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&decoded[1..33]);
    Ok(hash)
}

/// Decode a Stellar secret key (S… base32) into raw 32-byte ed25519 seed.
fn decode_stellar_secret(secret: &str) -> Result<[u8; 32]> {
    // Stellar secret keys: version byte 0x90 (18 << 3) + 32 bytes + 2 byte checksum
    // encoded as base32 (RFC 4648, no padding normally but Stellar uses padding)
    let decoded = base32_decode(secret).ok_or_else(|| anyhow!("invalid base32 in secret key"))?;
    if decoded.len() != 35 {
        bail!("secret key wrong length: {} (expected 35)", decoded.len());
    }
    if decoded[0] != 0x90u8.wrapping_add(0x00) && decoded[0] != (18 << 3) {
        bail!("not a Stellar secret key (wrong version byte)");
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&decoded[1..33]);
    Ok(seed)
}

/// Encode raw 32-byte ed25519 public key to Stellar G… address.
fn encode_stellar_public_key(key: &[u8; 32]) -> String {
    // version byte for public key = 6 << 3 = 48
    let mut payload = Vec::with_capacity(35);
    payload.push(6 << 3); // 48
    payload.extend_from_slice(key);
    // CRC16-XMODEM checksum
    let crc = crc16_xmodem(&payload);
    payload.push((crc & 0xFF) as u8);
    payload.push((crc >> 8) as u8);
    base32_encode(&payload)
}

/// Minimal base32 (RFC 4648) decoder.
pub(crate) fn base32_decode(input: &str) -> Option<Vec<u8>> {
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

/// Minimal base32 (RFC 4648) encoder.
fn base32_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut bits = 0u64;
    let mut bit_count = 0u32;
    let mut out = String::new();
    for &b in data {
        bits = (bits << 8) | b as u64;
        bit_count += 8;
        while bit_count >= 5 {
            bit_count -= 5;
            out.push(ALPHABET[((bits >> bit_count) & 0x1F) as usize] as char);
        }
    }
    if bit_count > 0 {
        out.push(ALPHABET[((bits << (5 - bit_count)) & 0x1F) as usize] as char);
    }
    // Pad to multiple of 8
    while out.len() % 8 != 0 {
        out.push('=');
    }
    out
}

/// CRC16-XMODEM used in Stellar key encoding.
pub(crate) fn crc16_xmodem(data: &[u8]) -> u16 {
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

/// Check whether an error is a sequence number collision.
fn is_seq_error(err: &anyhow::Error) -> bool {
    let msg = err.to_string().to_lowercase();
    msg.contains("tx_bad_seq") || msg.contains("bad seq") || msg.contains("sequence")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base32_roundtrip() {
        let data = b"hello world";
        let encoded = base32_encode(data);
        let decoded = base32_decode(&encoded).unwrap();
        assert_eq!(decoded, data);
    }

    #[test]
    fn test_crc16_xmodem() {
        // Known test vector
        let crc = crc16_xmodem(b"123456789");
        assert_eq!(crc, 0x31C3);
    }

    #[test]
    fn test_stellar_public_key_encoding() {
        // A zero public key should still produce a valid G… address
        let key = [0u8; 32];
        let addr = encode_stellar_public_key(&key);
        assert!(addr.starts_with('G'));
        assert_eq!(addr.len(), 56);
    }

    #[test]
    fn test_scval_helpers() {
        let sym = scval_symbol("hello").unwrap();
        assert!(matches!(sym, sxdr::ScVal::Symbol(_)));

        let s = scval_string("world").unwrap();
        assert!(matches!(s, sxdr::ScVal::String(_)));

        let i = scval_i32(42);
        assert!(matches!(i, sxdr::ScVal::I32(42)));

        let u = scval_u32(100);
        assert!(matches!(u, sxdr::ScVal::U32(100)));

        let u64v = scval_u64(7);
        assert!(matches!(u64v, sxdr::ScVal::U64(7)));

        let i128v = scval_i128(12345678901234567890i128);
        assert!(matches!(i128v, sxdr::ScVal::I128(_)));
    }

    #[test]
    fn test_is_seq_error() {
        let e = anyhow!("tx_bad_seq: sequence mismatch");
        assert!(is_seq_error(&e));

        let e = anyhow!("some other error");
        assert!(!is_seq_error(&e));
    }
}
