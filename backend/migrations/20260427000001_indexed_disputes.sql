-- backend/migrations/20260427000001_indexed_disputes.sql
-- Tracks on-chain DisputeOpened events indexed by the ledger follower.

CREATE TABLE IF NOT EXISTS indexed_disputes (
    id          VARCHAR(128) PRIMARY KEY,
    ledger      BIGINT NOT NULL,
    contract_id VARCHAR(64) NOT NULL,
    job_id      BIGINT NOT NULL,
    opened_by   TEXT NOT NULL,
    event_type  TEXT NOT NULL DEFAULT 'DisputeOpened',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_indexed_disputes_job_id ON indexed_disputes(job_id);
CREATE INDEX IF NOT EXISTS idx_indexed_disputes_ledger  ON indexed_disputes(ledger);
