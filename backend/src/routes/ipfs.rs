use axum::{
    extract::{Multipart, State},
    routing::post,
    Json, Router,
};
use serde::Serialize;
use crate::db::AppState;
use crate::error::Result;
use sha2::{Digest, Sha256};
use base64::{engine::general_purpose::STANDARD as B64, Engine};

#[derive(Serialize)]
pub struct UploadResponse {
    pub cid: String,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/upload", post(upload_to_ipfs))
}

pub async fn upload_to_ipfs(
    _state: State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>> {
    let mut data = Vec::new();

    while let Some(field) = multipart.next_field().await.map_err(|e| crate::error::AppError::BadRequest(e.to_string()))? {
        let field_data = field.bytes().await.map_err(|e| crate::error::AppError::BadRequest(e.to_string()))?;
        data.extend_from_slice(&field_data);
    }

    if data.is_empty() {
        return Err(crate::error::AppError::BadRequest("No data provided".into()));
    }

    let mut hasher = Sha256::new();
    hasher.update(&data);
    let result = hasher.finalize();
    
    // Create a mock CID-like string
    let cid = format!("Qm{}", B64.encode(&result[0..32]).replace('+', "v").replace('/', "u").trim_end_matches('='));

    Ok(Json(UploadResponse { cid }))
}
