-- Migration: Enhanced milestone tracking
-- Adds description, due_date, and completed_at to milestones for richer DB tracking.
-- Adds a milestone_events audit log for immutable status history.

ALTER TABLE milestones
    ADD COLUMN IF NOT EXISTS description   TEXT,
    ADD COLUMN IF NOT EXISTS due_date      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS completed_at  TIMESTAMPTZ;

-- Audit log: every status transition is recorded here.
CREATE TABLE IF NOT EXISTS milestone_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    milestone_id    UUID NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,   -- 'created' | 'deliverable_submitted' | 'released' | 'disputed'
    actor_address   TEXT,            -- wallet address of the actor
    tx_hash         TEXT,            -- on-chain tx hash if applicable
    note            TEXT,            -- optional human-readable note
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_milestone_events_milestone_id ON milestone_events(milestone_id);
CREATE INDEX IF NOT EXISTS idx_milestone_events_job_id       ON milestone_events(job_id);

-- Back-fill created events for existing milestones
INSERT INTO milestone_events (milestone_id, job_id, event_type, created_at)
SELECT id, job_id, 'created', NOW()
FROM milestones
WHERE NOT EXISTS (
    SELECT 1 FROM milestone_events me
    WHERE me.milestone_id = milestones.id AND me.event_type = 'created'
);
