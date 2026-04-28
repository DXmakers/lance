-- Migration: activity logs

CREATE TABLE IF NOT EXISTS activity_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_address    TEXT,
    job_id          UUID REFERENCES jobs(id) ON DELETE SET NULL,
    event_type      TEXT NOT NULL,
    level           TEXT NOT NULL DEFAULT 'info',
    details         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_logs_created_idx
    ON activity_logs (created_at DESC);
