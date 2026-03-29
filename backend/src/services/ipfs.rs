//! IPFS pinning service via Pinata REST API.
//!
//! Set `PINATA_JWT` to your Pinata JWT bearer token.
//! Uploads are capped at `MAX_UPLOAD_BYTES` (10 MiB) and MIME-type checked
//! against an allowlist before being sent to Pinata.

use anyhow::{bail, Context, Result};
use reqwest::multipart::{Form, Part};
use reqwest::Client;
use serde::Deserialize;

/// 10 MiB hard cap on incoming uploads.
pub const MAX_UPLOAD_BYTES: usize = 10 * 1024 * 1024;

/// Allowed MIME types for uploaded files.
const ALLOWED_MIME_TYPES: &[&str] = &[
    "application/pdf",
    "application/zip",
    "application/json",
    "text/plain",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
];

#[derive(Deserialize, Debug)]
struct PinataResponse {
    #[serde(rename = "IpfsHash")]
    ipfs_hash: String,
}

/// Pin `data` to IPFS via Pinata and return the resulting CID.
///
/// `filename` — original filename (used as the Pinata metadata name).
/// `mime_type` — content-type declared by the uploader; validated against the allowlist.
pub async fn pin_to_ipfs(
    client: &Client,
    data: Vec<u8>,
    filename: &str,
    mime_type: &str,
) -> Result<String> {
    // 1. Size guard
    if data.len() > MAX_UPLOAD_BYTES {
        bail!(
            "upload too large: {} bytes (max {} bytes)",
            data.len(),
            MAX_UPLOAD_BYTES
        );
    }

    // 2. MIME allowlist
    let base_mime = mime_type.split(';').next().unwrap_or("").trim();
    if !ALLOWED_MIME_TYPES.contains(&base_mime) {
        bail!("file type '{}' is not permitted", base_mime);
    }

    let jwt = std::env::var("PINATA_JWT")
        .context("PINATA_JWT environment variable not set")?;

    // 3. Build multipart body for Pinata
    let file_part = Part::bytes(data)
        .file_name(filename.to_owned())
        .mime_str(mime_type)?;

    let form = Form::new().part("file", file_part);

    // 4. POST to Pinata pinFileToIPFS
    let res = client
        .post("https://api.pinata.cloud/pinning/pinFileToIPFS")
        .bearer_auth(jwt)
        .multipart(form)
        .send()
        .await
        .context("failed to reach Pinata API")?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        bail!("Pinata returned {status}: {body}");
    }

    let pinata: PinataResponse = res.json().await.context("failed to parse Pinata response")?;
    Ok(pinata.ipfs_hash)
}
