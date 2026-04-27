-- Migration 004: Indexer checkpoint and RPC provider support
-- Tracks the last processed ledger and status of RPC providers

-- Checkpoint table for indexer state
CREATE TABLE IF NOT EXISTS indexer_checkpoints (
    id              TEXT PRIMARY KEY DEFAULT 'main',
    last_ledger     BIGINT NOT NULL DEFAULT 0,
    last_ledger_hash TEXT,
    last_processed_at TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'idle',
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert initial checkpoint if not exists
INSERT INTO indexer_checkpoints (id, last_ledger, status)
VALUES ('main', 0, 'idle')
ON CONFLICT (id) DO NOTHING;

-- RPC provider configuration table
CREATE TABLE IF NOT EXISTS rpc_providers (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    url             TEXT NOT NULL,
    priority        INT NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_health_check TIMESTAMPTZ,
    health_status   TEXT NOT NULL DEFAULT 'unknown',
    consecutive_failures INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(name)
);

-- Ledger events table (idempotent storage)
CREATE TABLE IF NOT EXISTS ledger_events (
    id                  SERIAL PRIMARY KEY,
    ledger_seq          BIGINT NOT NULL,
    ledger_hash         TEXT NOT NULL,
    tx_hash             TEXT NOT NULL,
    event_type          TEXT NOT NULL,
    contract_id         TEXT NOT NULL,
    topic               TEXT NOT NULL,
    payload             JSONB NOT NULL,
    processed           BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(ledger_seq, tx_hash, event_type, topic)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_ledger_events_unprocessed ON ledger_events(ledger_seq) WHERE processed = false;
CREATE INDEX IF NOT EXISTS idx_ledger_events_ledger_seq ON ledger_events(ledger_seq);

-- Function to record processed ledger (idempotent)
CREATE OR REPLACE FUNCTION record_ledger_progress(
    p_ledger BIGINT,
    p_ledger_hash TEXT
) RETURNS void AS $$
BEGIN
    INSERT INTO indexer_checkpoints (id, last_ledger, last_ledger_hash, last_processed_at, status, updated_at)
    VALUES ('main', p_ledger, p_ledger_hash, NOW(), 'syncing', NOW())
    ON CONFLICT (id) DO UPDATE SET
        last_ledger = GREATEST(indexer_checkpoints.last_ledger, EXCLUDED.last_ledger),
        last_ledger_hash = COALESCE(EXCLUDED.last_ledger_hash, indexer_checkpoints.last_ledger_hash),
        last_processed_at = NOW(),
        status = 'syncing',
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to update indexer status
CREATE OR REPLACE FUNCTION update_indexer_status(
    p_status TEXT,
    p_error_message TEXT DEFAULT NULL
) RETURNS void AS $$
BEGIN
    UPDATE indexer_checkpoints
    SET status = p_status,
        error_message = p_error_message,
        updated_at = NOW()
    WHERE id = 'main';
END;
$$ LANGUAGE plpgsql;