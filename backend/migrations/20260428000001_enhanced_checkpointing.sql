-- backend/migrations/20260428000001_enhanced_checkpointing.sql
-- Enhanced checkpointing system for ledger event monitoring

-- Add additional metadata to indexer_state for better observability
ALTER TABLE indexer_state 
ADD COLUMN IF NOT EXISTS last_successful_cycle_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_error_message TEXT,
ADD COLUMN IF NOT EXISTS total_cycles_completed BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_events_processed BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS worker_version VARCHAR(32) NOT NULL DEFAULT 'v1.0.0';

-- Create index on indexed_events for faster duplicate detection
CREATE INDEX IF NOT EXISTS idx_indexed_events_ledger ON indexed_events(ledger_amount);
CREATE INDEX IF NOT EXISTS idx_indexed_events_contract ON indexed_events(contract_id);
CREATE INDEX IF NOT EXISTS idx_indexed_events_created_at ON indexed_events(created_at);

-- Add composite index for common queries
CREATE INDEX IF NOT EXISTS idx_indexed_events_ledger_contract ON indexed_events(ledger_amount, contract_id);

-- Create a ledger processing log table for audit trail
CREATE TABLE IF NOT EXISTS ledger_processing_log (
    id BIGSERIAL PRIMARY KEY,
    ledger_sequence BIGINT NOT NULL,
    events_count INT NOT NULL DEFAULT 0,
    processing_started_at TIMESTAMPTZ NOT NULL,
    processing_completed_at TIMESTAMPTZ,
    processing_duration_ms BIGINT,
    status VARCHAR(32) NOT NULL DEFAULT 'processing', -- processing, completed, failed
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_processing_log_ledger ON ledger_processing_log(ledger_sequence);
CREATE INDEX IF NOT EXISTS idx_ledger_processing_log_status ON ledger_processing_log(status);
CREATE INDEX IF NOT EXISTS idx_ledger_processing_log_created_at ON ledger_processing_log(created_at);

-- Add unique constraint to prevent duplicate processing logs for same ledger
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_processing_log_unique_ledger 
ON ledger_processing_log(ledger_sequence) 
WHERE status = 'completed';

-- Function to update indexer state with comprehensive metadata
CREATE OR REPLACE FUNCTION update_indexer_checkpoint(
    p_ledger BIGINT,
    p_events_count BIGINT,
    p_worker_version VARCHAR(32)
) RETURNS void AS $$
BEGIN
    INSERT INTO indexer_state (
        id, 
        last_processed_ledger, 
        last_successful_cycle_at,
        total_cycles_completed,
        total_events_processed,
        worker_version,
        updated_at
    )
    VALUES (
        1, 
        p_ledger, 
        NOW(),
        1,
        p_events_count,
        p_worker_version,
        NOW()
    )
    ON CONFLICT (id) 
    DO UPDATE SET 
        last_processed_ledger = EXCLUDED.last_processed_ledger,
        last_successful_cycle_at = EXCLUDED.last_successful_cycle_at,
        total_cycles_completed = indexer_state.total_cycles_completed + 1,
        total_events_processed = indexer_state.total_events_processed + p_events_count,
        worker_version = EXCLUDED.worker_version,
        updated_at = EXCLUDED.updated_at;
END;
$$ LANGUAGE plpgsql;

-- Function to record indexer errors
CREATE OR REPLACE FUNCTION record_indexer_error(
    p_error_message TEXT
) RETURNS void AS $$
BEGIN
    UPDATE indexer_state 
    SET 
        last_error_at = NOW(),
        last_error_message = p_error_message,
        updated_at = NOW()
    WHERE id = 1;
END;
$$ LANGUAGE plpgsql;

-- View for monitoring indexer health
CREATE OR REPLACE VIEW indexer_health AS
SELECT 
    i.last_processed_ledger,
    i.last_successful_cycle_at,
    i.last_error_at,
    i.last_error_message,
    i.total_cycles_completed,
    i.total_events_processed,
    i.worker_version,
    i.updated_at,
    EXTRACT(EPOCH FROM (NOW() - i.last_successful_cycle_at)) AS seconds_since_last_success,
    CASE 
        WHEN i.last_successful_cycle_at IS NULL THEN 'never_run'
        WHEN EXTRACT(EPOCH FROM (NOW() - i.last_successful_cycle_at)) > 300 THEN 'stale'
        WHEN i.last_error_at > i.last_successful_cycle_at THEN 'error'
        ELSE 'healthy'
    END AS health_status,
    (SELECT COUNT(*) FROM indexed_events) AS total_indexed_events,
    (SELECT COUNT(*) FROM ledger_processing_log WHERE status = 'failed') AS failed_ledgers_count
FROM indexer_state i
WHERE i.id = 1;

COMMENT ON VIEW indexer_health IS 'Real-time health monitoring view for the ledger indexer worker';
COMMENT ON TABLE ledger_processing_log IS 'Audit trail of all ledger processing attempts for debugging and monitoring';
COMMENT ON FUNCTION update_indexer_checkpoint IS 'Atomically updates indexer checkpoint with comprehensive metadata';
COMMENT ON FUNCTION record_indexer_error IS 'Records indexer error information for monitoring and alerting';
