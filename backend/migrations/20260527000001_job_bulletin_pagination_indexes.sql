-- Adds optional bulletin search fields and indexes for cursor-paginated job listings.
-- Existing jobs remain queryable because both columns are nullable/defaulted.
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS skills TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_jobs_created_id_desc
    ON jobs (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_budget_created_id_desc
    ON jobs (budget_usdc, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_deadline_at
    ON jobs (deadline_at)
    WHERE deadline_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_skills_gin
    ON jobs USING GIN (skills);
