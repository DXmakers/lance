use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use tracing::{debug, error, info, warn};

/// Metrics for storage auditing operations
#[derive(Default)]
pub struct StorageAuditMetrics {
    pub total_audits_run: AtomicU64,
    pub total_anomalies_detected: AtomicU64,
    pub last_audit_duration_ms: AtomicU64,
    pub last_audit_timestamp: AtomicU64,
    pub total_storage_bytes: AtomicU64,
}

static STORAGE_AUDIT_METRICS: OnceLock<StorageAuditMetrics> = OnceLock::new();

pub fn metrics() -> &'static StorageAuditMetrics {
    STORAGE_AUDIT_METRICS.get_or_init(StorageAuditMetrics::default)
}

/// Configuration for storage audit operations
#[derive(Clone, Debug)]
pub struct StorageAuditConfig {
    /// Interval between automated audits
    pub audit_interval: Duration,
    /// Maximum acceptable growth rate per audit cycle (percentage)
    pub max_growth_rate_percent: f64,
    /// Threshold for table size anomaly detection (bytes)
    pub anomaly_size_threshold_bytes: i64,
    /// Enable automatic anomaly alerting
    pub enable_anomaly_alerts: bool,
}

impl StorageAuditConfig {
    pub fn from_env() -> Self {
        Self {
            audit_interval: Duration::from_secs(
                std::env::var("STORAGE_AUDIT_INTERVAL_SECS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(3600), // Default: 1 hour
            ),
            max_growth_rate_percent: std::env::var("STORAGE_AUDIT_MAX_GROWTH_PERCENT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(50.0),
            anomaly_size_threshold_bytes: std::env::var("STORAGE_AUDIT_ANOMALY_THRESHOLD_BYTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(100_000_000), // 100MB default
            enable_anomaly_alerts: std::env::var("STORAGE_AUDIT_ENABLE_ALERTS")
                .ok()
                .map(|v| v.eq_ignore_ascii_case("true"))
                .unwrap_or(true),
        }
    }
}

/// Storage footprint data for a single table
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TableFootprint {
    pub table_name: String,
    pub total_bytes: i64,
    pub row_count: i64,
    pub index_bytes: i64,
    pub toast_bytes: i64,
    pub percent_of_total: f64,
}

/// Complete storage audit report
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageAuditReport {
    pub id: i64,
    pub created_at: DateTime<Utc>,
    pub total_database_bytes: i64,
    pub total_row_count: i64,
    pub table_footprints: Vec<TableFootprint>,
    pub anomalies: Vec<StorageAnomaly>,
    pub growth_stats: Option<StorageGrowthStats>,
    pub audit_duration_ms: i64,
}

/// Storage growth statistics comparing to previous audit
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageGrowthStats {
    pub bytes_growth: i64,
    pub percent_growth: f64,
    pub fastest_growing_table: String,
    pub fastest_growth_percent: f64,
}

/// Detected storage anomaly
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct StorageAnomaly {
    pub id: Option<i64>,
    pub audit_id: i64,
    pub table_name: String,
    pub anomaly_type: String,
    pub severity: String,
    pub description: String,
    pub detected_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

/// Storage auditor for regular footprint analysis
pub struct StorageAuditor {
    pool: PgPool,
    config: StorageAuditConfig,
}

impl StorageAuditor {
    pub fn new(pool: PgPool, config: StorageAuditConfig) -> Self {
        Self { pool, config }
    }

    /// Run a complete storage audit
    pub async fn run_audit(&self) -> Result<StorageAuditReport> {
        let start = Instant::now();
        let audit_timestamp = Utc::now();

        info!("starting storage footprint audit");

        // Get current table footprints
        let table_footprints = self.gather_table_footprints().await?;

        // Calculate totals
        let total_database_bytes: i64 = table_footprints.iter().map(|t| t.total_bytes).sum();
        let total_row_count: i64 = table_footprints.iter().map(|t| t.row_count).sum();

        // Update percentage for each table
        let table_footprints: Vec<TableFootprint> = table_footprints
            .into_iter()
            .map(|mut t| {
                if total_database_bytes > 0 {
                    t.percent_of_total = (t.total_bytes as f64 / total_database_bytes as f64) * 100.0;
                }
                t
            })
            .collect();

        // Detect anomalies
        let anomalies = self.detect_anomalies(&table_footprints, total_database_bytes).await?;

        // Calculate growth stats
        let growth_stats = self.calculate_growth_stats(total_database_bytes, &table_footprints).await?;

        // Store audit results
        let audit_id = self
            .store_audit_result(
                audit_timestamp,
                total_database_bytes,
                total_row_count,
                &table_footprints,
                &anomalies,
                start.elapsed().as_millis() as i64,
            )
            .await?;

        let duration_ms = start.elapsed().as_millis() as i64;

        // Update metrics
        metrics()
            .total_audits_run
            .fetch_add(1, Ordering::Relaxed);
        metrics()
            .total_anomalies_detected
            .fetch_add(anomalies.len() as u64, Ordering::Relaxed);
        metrics()
            .last_audit_duration_ms
            .store(duration_ms as u64, Ordering::Relaxed);
        metrics()
            .last_audit_timestamp
            .store(audit_timestamp.timestamp() as u64, Ordering::Relaxed);
        metrics()
            .total_storage_bytes
            .store(total_database_bytes as u64, Ordering::Relaxed);

        info!(
            audit_id,
            total_bytes = total_database_bytes,
            total_rows = total_row_count,
            table_count = table_footprints.len(),
            anomaly_count = anomalies.len(),
            duration_ms,
            "storage audit completed"
        );

        Ok(StorageAuditReport {
            id: audit_id,
            created_at: audit_timestamp,
            total_database_bytes,
            total_row_count,
            table_footprints,
            anomalies,
            growth_stats,
            audit_duration_ms: duration_ms,
        })
    }

    /// Gather storage footprint for all tables
    async fn gather_table_footprints(&self) -> Result<Vec<TableFootprint>> {
        let rows = sqlx::query(
            r#"
            SELECT 
                relname as table_name,
                pg_total_relation_size(c.oid) as total_bytes,
                n_live_tup as row_count,
                pg_relation_size(c.oid) - pg_relation_size(c.oid, 'vm') as index_bytes,
                COALESCE(pg_total_relation_size(c.oid) - pg_relation_size(c.oid), 0) as toast_bytes
            FROM pg_class c
            JOIN pg_stat_user_tables pst ON c.relname = pst.relname
            WHERE c.relkind = 'r'
            AND schemaname = 'public'
            ORDER BY pg_total_relation_size(c.oid) DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut footprints = Vec::new();
        for row in rows {
            footprints.push(TableFootprint {
                table_name: row.try_get("table_name")?,
                total_bytes: row.try_get("total_bytes")?,
                row_count: row.try_get("row_count")?,
                index_bytes: row.try_get("index_bytes")?,
                toast_bytes: row.try_get("toast_bytes")?,
                percent_of_total: 0.0,
            });
        }

        Ok(footprints)
    }

    /// Detect storage anomalies
    async fn detect_anomalies(
        &self,
        footprints: &[TableFootprint],
        total_bytes: i64,
    ) -> Result<Vec<StorageAnomaly>> {
        let mut anomalies = Vec::new();
        let now = Utc::now();

        // Get previous audit data for comparison
        let previous_footprints: Vec<(String, i64)> = sqlx::query_as(
            r#"
            SELECT table_name, total_bytes
            FROM storage_audit_tables sat
            JOIN storage_audits sa ON sat.audit_id = sa.id
            WHERE sa.id = (
                SELECT MAX(id) FROM storage_audits WHERE id < (
                    SELECT COALESCE(MAX(id), 0) FROM storage_audits
                )
            )
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default();

        let prev_map: std::collections::HashMap<String, i64> =
            previous_footprints.into_iter().collect();

        for footprint in footprints {
            // Check for large table size
            if footprint.total_bytes > self.config.anomaly_size_threshold_bytes {
                anomalies.push(StorageAnomaly {
                    id: None,
                    audit_id: 0, // Will be set when stored
                    table_name: footprint.table_name.clone(),
                    anomaly_type: "large_table".to_string(),
                    severity: "warning".to_string(),
                    description: format!(
                        "Table '{}' exceeds size threshold: {} bytes",
                        footprint.table_name, footprint.total_bytes
                    ),
                    detected_at: now,
                    resolved_at: None,
                });
            }

            // Check for rapid growth
            if let Some(&prev_bytes) = prev_map.get(&footprint.table_name) {
                if prev_bytes > 0 {
                    let growth_pct =
                        ((footprint.total_bytes - prev_bytes) as f64 / prev_bytes as f64) * 100.0;
                    if growth_pct > self.config.max_growth_rate_percent {
                        anomalies.push(StorageAnomaly {
                            id: None,
                            audit_id: 0,
                            table_name: footprint.table_name.clone(),
                            anomaly_type: "rapid_growth".to_string(),
                            severity: "critical".to_string(),
                            description: format!(
                                "Table '{}' grew by {:.1}% since last audit ({} -> {} bytes)",
                                footprint.table_name, growth_pct, prev_bytes, footprint.total_bytes
                            ),
                            detected_at: now,
                            resolved_at: None,
                        });
                    }
                }
            }

            // Check for bloat (high dead tuple ratio would be visible in pg_stat_user_tables)
            let dead_tuple_ratio: Option<f64> = sqlx::query_scalar(
                r#"
                SELECT 
                    CASE 
                        WHEN n_live_tup + n_dead_tup > 0 
                        THEN (n_dead_tup::float / (n_live_tup + n_dead_tup)::float) * 100
                        ELSE 0 
                    END
                FROM pg_stat_user_tables
                WHERE relname = $1
                "#,
            )
            .bind(&footprint.table_name)
            .fetch_optional(&self.pool)
            .await?;

            if let Some(ratio) = dead_tuple_ratio {
                if ratio > 20.0 {
                    // More than 20% dead tuples
                    anomalies.push(StorageAnomaly {
                        id: None,
                        audit_id: 0,
                        table_name: footprint.table_name.clone(),
                        anomaly_type: "table_bloat".to_string(),
                        severity: "warning".to_string(),
                        description: format!(
                            "Table '{}' has {:.1}% dead tuples, consider VACUUM",
                            footprint.table_name, ratio
                        ),
                        detected_at: now,
                        resolved_at: None,
                    });
                }
            }
        }

        if self.config.enable_anomaly_alerts && !anomalies.is_empty() {
            for anomaly in &anomalies {
                warn!(
                    table = %anomaly.table_name,
                    anomaly_type = %anomaly.anomaly_type,
                    severity = %anomaly.severity,
                    "storage anomaly detected: {}",
                    anomaly.description
                );
            }
        }

        Ok(anomalies)
    }

    /// Calculate growth statistics
    async fn calculate_growth_stats(
        &self,
        current_total_bytes: i64,
        _footprints: &[TableFootprint],
    ) -> Result<Option<StorageGrowthStats>> {
        let previous_total: Option<i64> = sqlx::query_scalar(
            "SELECT total_database_bytes FROM storage_audits ORDER BY id DESC LIMIT 1 OFFSET 1"
        )
        .fetch_optional(&self.pool)
        .await?;

        if let Some(prev_total) = previous_total {
            if prev_total > 0 {
                let bytes_growth = current_total_bytes - prev_total;
                let percent_growth = (bytes_growth as f64 / prev_total as f64) * 100.0;

                // Find fastest growing table
                let fastest: Option<(String, f64)> = sqlx::query_as(
                    r#"
                    WITH growth AS (
                        SELECT 
                            curr.table_name,
                            curr.total_bytes as current_bytes,
                            prev.total_bytes as previous_bytes,
                            CASE 
                                WHEN prev.total_bytes > 0 
                                THEN ((curr.total_bytes - prev.total_bytes)::float / prev.total_bytes::float) * 100
                                ELSE 0 
                            END as growth_percent
                        FROM storage_audit_tables curr
                        JOIN storage_audits curr_audit ON curr.audit_id = curr_audit.id
                        LEFT JOIN storage_audit_tables prev ON curr.table_name = prev.table_name
                        LEFT JOIN storage_audits prev_audit ON prev.audit_id = prev_audit.id
                            AND prev_audit.id = (
                                SELECT MAX(id) FROM storage_audits 
                                WHERE id < curr_audit.id
                            )
                        WHERE curr_audit.id = (SELECT MAX(id) FROM storage_audits)
                    )
                    SELECT table_name, growth_percent
                    FROM growth
                    ORDER BY growth_percent DESC
                    LIMIT 1
                    "#
                )
                .fetch_optional(&self.pool)
                .await?;

                return Ok(Some(StorageGrowthStats {
                    bytes_growth,
                    percent_growth,
                    fastest_growing_table: fastest.as_ref().map(|(n, _)| n.clone()).unwrap_or_default(),
                    fastest_growth_percent: fastest.map(|(_, g)| g).unwrap_or(0.0),
                }));
            }
        }

        Ok(None)
    }

    /// Store audit results in database
    async fn store_audit_result(
        &self,
        timestamp: DateTime<Utc>,
        total_bytes: i64,
        total_rows: i64,
        footprints: &[TableFootprint],
        anomalies: &[StorageAnomaly],
        duration_ms: i64,
    ) -> Result<i64> {
        let mut tx = self.pool.begin().await?;

        // Insert main audit record
        let audit_id: i64 = sqlx::query_scalar(
            r#"
            INSERT INTO storage_audits 
                (created_at, total_database_bytes, total_row_count, audit_duration_ms)
            VALUES ($1, $2, $3, $4)
            RETURNING id
            "#,
        )
        .bind(timestamp)
        .bind(total_bytes)
        .bind(total_rows)
        .bind(duration_ms)
        .fetch_one(&mut *tx)
        .await?;

        // Insert table footprints
        for footprint in footprints {
            sqlx::query(
                r#"
                INSERT INTO storage_audit_tables 
                    (audit_id, table_name, total_bytes, row_count, index_bytes, toast_bytes, percent_of_total)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                "#,
            )
            .bind(audit_id)
            .bind(&footprint.table_name)
            .bind(footprint.total_bytes)
            .bind(footprint.row_count)
            .bind(footprint.index_bytes)
            .bind(footprint.toast_bytes)
            .bind(footprint.percent_of_total)
            .execute(&mut *tx)
            .await?;
        }

        // Insert anomalies
        for anomaly in anomalies {
            sqlx::query(
                r#"
                INSERT INTO storage_anomalies 
                    (audit_id, table_name, anomaly_type, severity, description, detected_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                "#,
            )
            .bind(audit_id)
            .bind(&anomaly.table_name)
            .bind(&anomaly.anomaly_type)
            .bind(&anomaly.severity)
            .bind(&anomaly.description)
            .bind(anomaly.detected_at)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;

        Ok(audit_id)
    }

    /// Get the latest audit report
    pub async fn get_latest_audit(&self) -> Result<Option<StorageAuditReport>> {
        let audit_row = sqlx::query(
            "SELECT id, created_at, total_database_bytes, total_row_count, audit_duration_ms 
             FROM storage_audits 
             ORDER BY id DESC LIMIT 1"
        )
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = audit_row else {
            return Ok(None);
        };

        let audit_id: i64 = row.try_get("id")?;
        let created_at: DateTime<Utc> = row.try_get("created_at")?;
        let total_bytes: i64 = row.try_get("total_database_bytes")?;
        let total_rows: i64 = row.try_get("total_row_count")?;
        let duration_ms: i64 = row.try_get("audit_duration_ms")?;

        let footprints: Vec<TableFootprint> = sqlx::query_as(
            "SELECT table_name, total_bytes, row_count, index_bytes, toast_bytes, percent_of_total
             FROM storage_audit_tables WHERE audit_id = $1"
        )
        .bind(audit_id)
        .fetch_all(&self.pool)
        .await?;

        let anomalies: Vec<StorageAnomaly> = sqlx::query_as(
            "SELECT id, audit_id, table_name, anomaly_type, severity, description, detected_at, resolved_at
             FROM storage_anomalies WHERE audit_id = $1"
        )
        .bind(audit_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(Some(StorageAuditReport {
            id: audit_id,
            created_at,
            total_database_bytes: total_bytes,
            total_row_count: total_rows,
            table_footprints: footprints,
            anomalies,
            growth_stats: None, // Calculated on demand
            audit_duration_ms: duration_ms,
        }))
    }

    /// Get audit history with pagination
    pub async fn get_audit_history(&self, limit: i64, offset: i64) -> Result<Vec<StorageAuditSummary>> {
        let summaries: Vec<StorageAuditSummary> = sqlx::query_as(
            r#"
            SELECT 
                sa.id,
                sa.created_at,
                sa.total_database_bytes,
                sa.total_row_count,
                sa.audit_duration_ms,
                COUNT(sa2.id) as anomaly_count
            FROM storage_audits sa
            LEFT JOIN storage_anomalies sa2 ON sa.id = sa2.audit_id
            GROUP BY sa.id, sa.created_at, sa.total_database_bytes, sa.total_row_count, sa.audit_duration_ms
            ORDER BY sa.id DESC
            LIMIT $1 OFFSET $2
            "#
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        Ok(summaries)
    }

    /// Resolve an anomaly
    pub async fn resolve_anomaly(&self, anomaly_id: i64) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE storage_anomalies SET resolved_at = NOW() WHERE id = $1 AND resolved_at IS NULL"
        )
        .bind(anomaly_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() > 0 {
            info!(anomaly_id, "storage anomaly resolved");
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Clean up old audit data
    pub async fn cleanup_old_audits(&self, keep_days: i32) -> Result<u64> {
        let result = sqlx::query(
            r#"
            DELETE FROM storage_audits 
            WHERE created_at < NOW() - INTERVAL '$1 days'
            AND id NOT IN (
                SELECT DISTINCT audit_id 
                FROM storage_anomalies 
                WHERE resolved_at IS NULL
            )
            "#
        )
        .bind(keep_days)
        .execute(&self.pool)
        .await?;

        let deleted = result.rows_affected();
        info!(deleted, days = keep_days, "old storage audit records cleaned up");
        
        Ok(deleted)
    }
}

/// Summary of a storage audit for list views
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct StorageAuditSummary {
    pub id: i64,
    pub created_at: DateTime<Utc>,
    pub total_database_bytes: i64,
    pub total_row_count: i64,
    pub audit_duration_ms: i64,
    pub anomaly_count: i64,
}

/// Run the storage audit worker loop
pub async fn run_storage_audit_worker(pool: PgPool) {
    let config = StorageAuditConfig::from_env();
    let auditor = StorageAuditor::new(pool, config.clone());

    info!(
        audit_interval_secs = config.audit_interval.as_secs(),
        max_growth_rate = config.max_growth_rate_percent,
        anomaly_threshold_bytes = config.anomaly_size_threshold_bytes,
        "starting storage audit worker"
    );

    // Run initial audit
    if let Err(e) = auditor.run_audit().await {
        error!(error = %e, "initial storage audit failed");
    }

    let mut interval = tokio::time::interval(config.audit_interval);

    loop {
        interval.tick().await;

        if let Err(e) = auditor.run_audit().await {
            error!(error = %e, "scheduled storage audit failed");
        }

        // Cleanup old audits monthly (approximately)
        if config.audit_interval.as_secs() >= 3600 {
            let hour = Utc::now().hour();
            if hour == 2 { // Run cleanup at 2 AM
                if let Err(e) = auditor.cleanup_old_audits(90).await {
                    warn!(error = %e, "storage audit cleanup failed");
                }
            }
        }
    }
}

/// Generate Prometheus metrics output for storage auditing
pub fn prometheus_metrics() -> String {
    let total_audits = metrics().total_audits_run.load(Ordering::Relaxed);
    let total_anomalies = metrics().total_anomalies_detected.load(Ordering::Relaxed);
    let last_duration = metrics().last_audit_duration_ms.load(Ordering::Relaxed);
    let last_timestamp = metrics().last_audit_timestamp.load(Ordering::Relaxed);
    let total_bytes = metrics().total_storage_bytes.load(Ordering::Relaxed);

    format!(
        "# HELP storage_audit_total_audits Total number of storage audits performed\n\
         # TYPE storage_audit_total_audits counter\n\
         storage_audit_total_audits {total_audits}\n\
         # HELP storage_audit_total_anomalies Total anomalies detected across all audits\n\
         # TYPE storage_audit_total_anomalies counter\n\
         storage_audit_total_anomalies {total_anomalies}\n\
         # HELP storage_audit_last_duration_ms Duration of the last audit in milliseconds\n\
         # TYPE storage_audit_last_duration_ms gauge\n\
         storage_audit_last_duration_ms {last_duration}\n\
         # HELP storage_audit_last_timestamp Unix timestamp of the last audit\n\
         # TYPE storage_audit_last_timestamp gauge\n\
         storage_audit_last_timestamp {last_timestamp}\n\
         # HELP storage_audit_total_bytes Total database storage in bytes\n\
         # TYPE storage_audit_total_bytes gauge\n\
         storage_audit_total_bytes {total_bytes}\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_storage_audit_config_defaults() {
        // Ensure we can create config with defaults
        let config = StorageAuditConfig {
            audit_interval: Duration::from_secs(3600),
            max_growth_rate_percent: 50.0,
            anomaly_size_threshold_bytes: 100_000_000,
            enable_anomaly_alerts: true,
        };

        assert_eq!(config.audit_interval.as_secs(), 3600);
        assert_eq!(config.max_growth_rate_percent, 50.0);
    }

    #[test]
    fn test_table_footprint_serialization() {
        let footprint = TableFootprint {
            table_name: "test_table".to_string(),
            total_bytes: 1024,
            row_count: 100,
            index_bytes: 512,
            toast_bytes: 0,
            percent_of_total: 10.0,
        };

        let json = serde_json::to_string(&footprint).unwrap();
        assert!(json.contains("test_table"));
        assert!(json.contains("1024"));
    }

    #[test]
    fn test_storage_anomaly_creation() {
        let anomaly = StorageAnomaly {
            id: Some(1),
            audit_id: 1,
            table_name: "large_table".to_string(),
            anomaly_type: "large_table".to_string(),
            severity: "warning".to_string(),
            description: "Table exceeds threshold".to_string(),
            detected_at: Utc::now(),
            resolved_at: None,
        };

        assert_eq!(anomaly.table_name, "large_table");
        assert_eq!(anomaly.severity, "warning");
    }
}
