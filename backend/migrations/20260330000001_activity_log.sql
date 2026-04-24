-- Migration: Activity Log

CREATE TABLE IF NOT EXISTS activity_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    actor            TEXT NOT NULL,
    action          TEXT NOT NULL,
    action_type     TEXT NOT NULL DEFAULT 'info',
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_logs_job_created_idx
    ON activity_logs (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS activity_logs_actor_idx
    ON activity_logs (actor, created_at DESC);

-- Insert initial activity logs for existing jobs
INSERT INTO activity_logs (job_id, actor, action, action_type, metadata, created_at)
SELECT 
    id,
    client_address,
    'Job created',
    'info',
    jsonb_build_object(
        'budget_usdc', budget_usdc,
        'milestones', milestones,
        'status', status
    ),
    created_at
FROM jobs
ON CONFLICT DO NOTHING;
