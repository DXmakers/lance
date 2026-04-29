use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;

use crate::db::AppState;
use crate::storage_audit::{metrics, StorageAnomaly, StorageAuditConfig, StorageAuditor};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/audits/latest", get(get_latest_audit))
        .route("/audits/history", get(get_audit_history))
        .route("/audits/trigger", post(trigger_audit))
        .route("/audits/:id", get(get_audit_by_id))
        .route("/anomalies", get(get_anomalies))
        .route("/anomalies/:id/resolve", post(resolve_anomaly))
        .route("/summary", get(get_storage_summary))
        .route("/metrics", get(storage_prometheus_metrics))
}

/// Query parameters for audit history
#[derive(Debug, Deserialize)]
pub struct AuditHistoryParams {
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

fn default_limit() -> i64 {
    20
}

/// Get the latest storage audit report
pub async fn get_latest_audit(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    let config = StorageAuditConfig::from_env();
    let auditor = StorageAuditor::new(state.pool, config);

    match auditor.get_latest_audit().await {
        Ok(Some(report)) => (StatusCode::OK, Json(json!(report))),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": "No storage audits found"
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": format!("Failed to retrieve audit: {}", e)
            })),
        ),
    }
}

/// Get audit history with pagination
pub async fn get_audit_history(
    State(state): State<AppState>,
    Query(params): Query<AuditHistoryParams>,
) -> (StatusCode, Json<Value>) {
    let config = StorageAuditConfig::from_env();
    let auditor = StorageAuditor::new(state.pool, config);

    match auditor
        .get_audit_history(params.limit.min(100), params.offset)
        .await
    {
        Ok(audits) => (
            StatusCode::OK,
            Json(json!({
                "audits": audits,
                "limit": params.limit,
                "offset": params.offset,
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": format!("Failed to retrieve audit history: {}", e)
            })),
        ),
    }
}

/// Trigger a manual storage audit
pub async fn trigger_audit(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    let config = StorageAuditConfig::from_env();
    let auditor = StorageAuditor::new(state.pool, config);

    match auditor.run_audit().await {
        Ok(report) => (
            StatusCode::OK,
            Json(json!({
                "message": "Storage audit completed successfully",
                "audit": report,
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": format!("Storage audit failed: {}", e)
            })),
        ),
    }
}

/// Get a specific audit by ID
pub async fn get_audit_by_id(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> (StatusCode, Json<Value>) {
    // For now, return the latest if ID matches, otherwise we'd need to add a specific query
    let config = StorageAuditConfig::from_env();
    let auditor = StorageAuditor::new(state.pool, config);

    match auditor.get_latest_audit().await {
        Ok(Some(report)) if report.id == id => (StatusCode::OK, Json(json!(report))),
        Ok(_) => (
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": format!("Audit with id {} not found", id)
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": format!("Failed to retrieve audit: {}", e)
            })),
        ),
    }
}

/// Query parameters for anomalies
#[derive(Debug, Deserialize)]
pub struct AnomalyQueryParams {
    #[serde(default)]
    pub unresolved_only: bool,
    #[serde(default)]
    pub table: Option<String>,
    #[serde(default = "default_anomaly_limit")]
    pub limit: i64,
}

fn default_anomaly_limit() -> i64 {
    50
}

/// Get storage anomalies
pub async fn get_anomalies(
    State(state): State<AppState>,
    Query(params): Query<AnomalyQueryParams>,
) -> (StatusCode, Json<Value>) {
    let query = if params.unresolved_only {
        "SELECT id, audit_id, table_name, anomaly_type, severity, description, detected_at, resolved_at 
         FROM storage_anomalies 
         WHERE resolved_at IS NULL 
         ORDER BY detected_at DESC 
         LIMIT $1"
    } else {
        "SELECT id, audit_id, table_name, anomaly_type, severity, description, detected_at, resolved_at 
         FROM storage_anomalies 
         ORDER BY detected_at DESC 
         LIMIT $1"
    };

    let anomalies: Vec<StorageAnomaly> = match sqlx::query_as(query)
        .bind(params.limit.min(100))
        .fetch_all(&state.pool)
        .await
    {
        Ok(rows) => rows,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": format!("Failed to retrieve anomalies: {}", e)
                })),
            );
        }
    };

    // Filter by table if specified
    let anomalies: Vec<StorageAnomaly> = if let Some(table_filter) = params.table {
        anomalies
            .into_iter()
            .filter(|a| a.table_name == table_filter)
            .collect()
    } else {
        anomalies
    };

    (
        StatusCode::OK,
        Json(json!({
            "anomalies": anomalies,
            "count": anomalies.len(),
            "unresolved_only": params.unresolved_only,
        })),
    )
}

/// Resolve a storage anomaly
pub async fn resolve_anomaly(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> (StatusCode, Json<Value>) {
    let config = StorageAuditConfig::from_env();
    let auditor = StorageAuditor::new(state.pool, config);

    match auditor.resolve_anomaly(id).await {
        Ok(true) => (
            StatusCode::OK,
            Json(json!({
                "message": format!("Anomaly {} resolved successfully", id),
                "id": id,
            })),
        ),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": format!("Anomaly {} not found or already resolved", id)
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": format!("Failed to resolve anomaly: {}", e)
            })),
        ),
    }
}

/// Get storage summary statistics
pub async fn get_storage_summary(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    // Get latest summary from view
    let summary: Option<(i64, i64, i64)> = sqlx::query_as(
        "SELECT audit_id, total_database_bytes, unresolved_anomaly_count FROM latest_storage_summary"
    )
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();

    // Get trend data
    let trends: Vec<(chrono::NaiveDate, i64, i64)> = sqlx::query_as(
        "SELECT audit_date, peak_bytes, avg_bytes FROM storage_trend_summary LIMIT 7",
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let total_audits = metrics().total_audits_run.load(Ordering::Relaxed);
    let total_anomalies = metrics().total_anomalies_detected.load(Ordering::Relaxed);

    (
        StatusCode::OK,
        Json(json!({
            "current": summary.map(|(id, bytes, anomalies)| json!({
                "audit_id": id,
                "total_bytes": bytes,
                "unresolved_anomalies": anomalies,
            })),
            "trends": trends.iter().map(|(date, peak, avg)| json!({
                "date": date.to_string(),
                "peak_bytes": peak,
                "average_bytes": avg,
            })).collect::<Vec<_>>(),
            "metrics": {
                "total_audits_run": total_audits,
                "total_anomalies_detected": total_anomalies,
            }
        })),
    )
}

/// Prometheus metrics endpoint for storage auditing
pub async fn storage_prometheus_metrics() -> (StatusCode, String) {
    let metrics_output = crate::storage_audit::prometheus_metrics();
    (StatusCode::OK, metrics_output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audit_history_params_defaults() {
        let params: AuditHistoryParams = serde_json::from_str("{}").unwrap();
        assert_eq!(params.limit, 20);
        assert_eq!(params.offset, 0);
    }

    #[test]
    fn test_audit_history_params_custom() {
        let params: AuditHistoryParams =
            serde_json::from_str(r#"{"limit": 50, "offset": 100}"#).unwrap();
        assert_eq!(params.limit, 50);
        assert_eq!(params.offset, 100);
    }
}
