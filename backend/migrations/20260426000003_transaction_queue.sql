-- Transaction queue for retry-safe Soroban submissions (#181).
--
-- The queue is the durable buffer between the API request that wants to
-- broadcast a transaction and the worker that submits and polls for
-- confirmation. Rows transition through:
--   queued      → claimed by the worker
--   submitted   → broadcast to the network, waiting for confirmation
--   confirmed   → final, with `tx_hash` populated
--   failed      → terminal failure, with `last_error` populated
--   abandoned   → exceeded `max_attempts`; surfaced to operators

CREATE TABLE IF NOT EXISTS transaction_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payload         JSONB NOT NULL,
    status          TEXT  NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','submitted','confirmed','failed','abandoned')),
    tx_hash         TEXT,
    sequence_number BIGINT,
    attempts        INT   NOT NULL DEFAULT 0,
    max_attempts    INT   NOT NULL DEFAULT 5,
    last_error      TEXT,
    scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transaction_queue_status_scheduled_idx
    ON transaction_queue (status, scheduled_at);

CREATE INDEX IF NOT EXISTS transaction_queue_tx_hash_idx
    ON transaction_queue (tx_hash)
    WHERE tx_hash IS NOT NULL;
