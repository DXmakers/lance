use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexedEventRecord {
    pub event_key: String,
    pub ledger_sequence: i64,
    pub event_type: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncStatus {
    Starting,
    CatchingUp,
    Synced,
    Degraded,
}

impl Default for SyncStatus {
    fn default() -> Self {
        Self::Starting
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncSnapshot {
    pub status: SyncStatus,
    pub last_processed_ledger: i64,
    pub latest_ledger: i64,
    pub ledger_lag: i64,
    pub last_success_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
}

impl SyncSnapshot {
    pub fn new(last_processed_ledger: i64) -> Self {
        Self {
            status: SyncStatus::Starting,
            last_processed_ledger,
            latest_ledger: last_processed_ledger,
            ledger_lag: 0,
            last_success_at: None,
            last_error: None,
        }
    }

    pub fn update_success(&mut self, last_processed_ledger: i64, latest_ledger: i64) {
        self.last_processed_ledger = last_processed_ledger;
        self.latest_ledger = latest_ledger;
        self.ledger_lag = latest_ledger.saturating_sub(last_processed_ledger);
        self.last_success_at = Some(Utc::now());
        self.last_error = None;
        self.status = if self.ledger_lag == 0 {
            SyncStatus::Synced
        } else {
            SyncStatus::CatchingUp
        };
    }

    pub fn record_error(&mut self, error: impl Into<String>) {
        self.last_error = Some(error.into());
        self.status = SyncStatus::Degraded;
    }
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: SyncStatus,
    pub healthy: bool,
    pub last_processed_ledger: i64,
    pub latest_ledger: i64,
    pub ledger_lag: i64,
    pub last_success_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
}