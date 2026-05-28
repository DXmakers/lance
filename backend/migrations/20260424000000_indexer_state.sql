-- backend/migrations/20260424000000_indexer_state.sql

CREATE TABLE IF NOT EXISTS indexer_state (
    id INT PRIMARY KEY,
    last_processed_ledger BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency tracking table for processed events
CREATE TABLE IF NOT EXISTS indexed_events (
    id VARCHAR(128) PRIMARY KEY,
    ledger_amount BIGINT NOT NULL,
    contract_id VARCHAR(64) NOT NULL,
    topic_hash VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO indexer_state (id, last_processed_ledger) 
VALUES (1, 0) 
ON CONFLICT (id) DO NOTHING;
