-- Stores bounded verification proofs for the SQLx PostgreSQL migration advisory lock.
-- Each row captures one API-side cluster synchronization probe so operators can
-- audit pool pressure and lock mutual exclusion across rolling deploys.
CREATE TABLE IF NOT EXISTS sqlx_migration_lock_audits (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    database_name            TEXT NOT NULL,
    lock_id                  BIGINT NOT NULL,
    probe_concurrency        INT NOT NULL CHECK (probe_concurrency > 0),
    blocked_probe_count      INT NOT NULL CHECK (blocked_probe_count >= 0),
    available_after_release  BOOLEAN NOT NULL,
    pool_total_before        INT NOT NULL CHECK (pool_total_before >= 0),
    pool_waiting_before      INT NOT NULL CHECK (pool_waiting_before >= 0),
    pool_total_after         INT NOT NULL CHECK (pool_total_after >= 0),
    pool_waiting_after       INT NOT NULL CHECK (pool_waiting_after >= 0),
    duration_ms              INT NOT NULL CHECK (duration_ms >= 0),
    status                   TEXT NOT NULL CHECK (status IN ('synchronized', 'failed')),
    details                  JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sqlx_migration_lock_audits_created
    ON sqlx_migration_lock_audits (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_sqlx_migration_lock_audits_db_status_created
    ON sqlx_migration_lock_audits (database_name, status, created_at DESC, id DESC);
