-- backend/migrations/20260425000002_deposits.sql

CREATE TABLE IF NOT EXISTS deposits (
    id VARCHAR(128) PRIMARY KEY, -- Soroban event ID (e.g. "0000000123-0001")
    ledger BIGINT NOT NULL,
    contract_id VARCHAR(64) NOT NULL,
    sender VARCHAR(64) NOT NULL,
    amount BIGINT NOT NULL,
    token VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deposits_sender ON deposits(sender);
CREATE INDEX IF NOT EXISTS idx_deposits_ledger ON deposits(ledger);
CREATE INDEX IF NOT EXISTS idx_deposits_contract ON deposits(contract_id);
