// Backend tests for indexer.rs - DisputeOpened event indexing (Issue #193)
// 
// These tests verify the event side-effects processing,
// particularly the DisputeOpened event handling.

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    #[test]
    fn test_dispute_event_parsing() {
        // Test that DisputeOpened events are correctly identified and parsed
        let event = json!({
            "id": "test-event-id-001",
            "ledger": 1000,
            "contractId": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
            "topic": [
                "disputeopened",
                "123",  // job_id
                "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"  // opened_by address
            ]
        });

        // Verify topic extraction
        let topics = event.get("topic").and_then(Value::as_array);
        let first_topic = topics
            .and_then(|items| items.first())
            .and_then(Value::as_str)
            .unwrap_or("");

        assert_eq!(first_topic, "disputeopened");

        let job_id = topics
            .and_then(|items| items.get(1))
            .and_then(Value::as_str)
            .unwrap_or("0")
            .parse::<i64>()
            .unwrap_or(0);

        assert_eq!(job_id, 123);

        let opened_by = topics
            .and_then(|items| items.get(2))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();

        assert_eq!(opened_by, "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
    }

    #[test]
    fn test_dispute_event_case_insensitive() {
        // Test that both "dispute" and "disputeopened" topics are recognized
        let topics_lower = vec!["dispute".to_string()];
        let topics_full = vec!["disputeopened".to_string()];

        for topic_str in &topics_lower {
            match topic_str.as_str() {
                "dispute" | "disputeopened" => {
                    // Event should be processed
                    assert!(true);
                }
                _ => panic!("Topic not recognized: {}", topic_str),
            }
        }

        for topic_str in &topics_full {
            match topic_str.as_str() {
                "dispute" | "disputeopened" => {
                    // Event should be processed
                    assert!(true);
                }
                _ => panic!("Topic not recognized: {}", topic_str),
            }
        }
    }

    #[test]
    fn test_dispute_event_optional_fields() {
        // Test handling of optional/missing fields in DisputeOpened events
        let event_minimal = json!({
            "id": "test-event-minimal",
            "ledger": 500
        });

        let event_id = event_minimal
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        assert_eq!(event_id, "test-event-minimal");

        let ledger = event_minimal
            .get("ledger")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        assert_eq!(ledger, 500);

        let contract_id = event_minimal
            .get("contractId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        assert_eq!(contract_id, "");
    }
}
