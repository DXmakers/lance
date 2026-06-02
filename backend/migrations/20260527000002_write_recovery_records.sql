-- Durable ledger for database writes that may be interrupted after the request is accepted.
-- A pending/failed row gives operators and retry workers a stable idempotency key to inspect.
CREATE TABLE IF NOT EXISTS write_recovery_records (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    idempotency_key   TEXT NOT NULL UNIQUE,
    operation         TEXT NOT NULL,
    entity_type       TEXT NOT NULL,
    entity_id         UUID,
    status            TEXT NOT NULL DEFAULT 'pending',
    attempts          INT NOT NULL DEFAULT 0,
    last_error        TEXT,
    recovery_payload  JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT write_recovery_status_check
        CHECK (status IN ('pending', 'committed', 'failed', 'abandoned'))
);

CREATE INDEX IF NOT EXISTS idx_write_recovery_status_updated
    ON write_recovery_records (status, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_write_recovery_entity
    ON write_recovery_records (entity_type, entity_id)
    WHERE entity_id IS NOT NULL;

CREATE TRIGGER write_recovery_records_updated_at
  BEFORE UPDATE ON write_recovery_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
