use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// DisputeResolved event stored in the database
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DisputeResolvedEvent {
    pub id: i64,
    pub ledger_sequence: i64,
    pub dispute_id: i64,
    pub resolution_timestamp: DateTime<Utc>,
    pub resolved_by: String,
    pub outcome: String,
    pub tx_hash: String,
    pub event_signature_hash: Option<String>,
    pub processed_ledger: Option<i64>,
    pub processed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// Request to store a DisputeResolved event
#[derive(Debug, Clone)]
pub struct StoreDisputeResolvedEventRequest {
    pub ledger_sequence: i64,
    pub dispute_id: i64,
    pub resolution_timestamp: DateTime<Utc>,
    pub resolved_by: String,
    pub outcome: String,
    pub tx_hash: String,
    pub event_signature_hash: String,
    pub processed_ledger: i64,
}

/// Response from storing a DisputeResolved event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisputeResolvedEventResponse {
    pub id: i64,
    pub dispute_id: i64,
    pub outcome: String,
    pub resolved_by: String,
    pub processed_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dispute_resolved_event_creation() {
        let event = DisputeResolvedEvent {
            id: 1,
            ledger_sequence: 100,
            dispute_id: 42,
            resolution_timestamp: Utc::now(),
            resolved_by: "GXXXXXX".to_string(),
            outcome: "client_wins".to_string(),
            tx_hash: "abc123".to_string(),
            event_signature_hash: Some("sig_hash_123".to_string()),
            processed_ledger: Some(100),
            processed_at: Some(Utc::now()),
            created_at: Utc::now(),
        };

        assert_eq!(event.ledger_sequence, 100);
        assert_eq!(event.dispute_id, 42);
        assert_eq!(event.outcome, "client_wins");
    }
}
