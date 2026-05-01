CREATE TABLE IF NOT EXISTS ledger_checkpoints (
    id SMALLINT PRIMARY KEY,
    last_processed_ledger BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ledger_checkpoints_single_row CHECK (id = 1)
);

INSERT INTO ledger_checkpoints (id, last_processed_ledger)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS indexed_events (
    id BIGSERIAL PRIMARY KEY,
    event_key TEXT NOT NULL UNIQUE,
    ledger_sequence BIGINT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS indexed_events_ledger_sequence_idx
    ON indexed_events (ledger_sequence);