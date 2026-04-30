-- Migration: saved_jobs
CREATE TABLE IF NOT EXISTS saved_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_address TEXT NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(job_id, user_address)
);

CREATE INDEX IF NOT EXISTS saved_jobs_user_address_idx ON saved_jobs(user_address);
