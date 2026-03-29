//! POST /api/v1/uploads — multipart file upload → IPFS pin → return CID.

use axum::{
    extract::{Multipart, State},
    http::StatusCode,
    routing::post,
    Json, Router,
};
use reqwest::Client;
use serde_json::{json, Value};

use crate::{db::AppState, error::AppError, services::ipfs};

pub fn router() -> Router<AppState> {
    Router::new().route("/", post(upload_file))
}

async fn upload_file(
    State(_state): State<AppState>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let client = Client::new();

    if let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        let filename = field
            .file_name()
            .unwrap_or("upload")
            .to_owned();
        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_owned();

        let data: Vec<u8> = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(e.to_string()))?
            .to_vec();

        if data.len() > ipfs::MAX_UPLOAD_BYTES {
            return Err(AppError::BadRequest(format!(
                "file exceeds {} MiB limit",
                ipfs::MAX_UPLOAD_BYTES / 1024 / 1024
            )));
        }

        let cid = ipfs::pin_to_ipfs(&client, data, &filename, &content_type)
            .await
            .map_err(|e| AppError::BadRequest(e.to_string()))?;

        return Ok((
            StatusCode::CREATED,
            Json(json!({ "cid": cid, "filename": filename })),
        ));
    }

    Err(AppError::BadRequest("no file field found in multipart body".into()))
}
