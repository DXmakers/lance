-- Migration 004: production query bounds and lookup indexes

CREATE INDEX IF NOT EXISTS jobs_status_created_idx
    ON jobs (status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS jobs_client_status_idx
    ON jobs (client_address, status, created_at DESC);

CREATE INDEX IF NOT EXISTS jobs_freelancer_status_idx
    ON jobs (freelancer_address, status, created_at DESC)
    WHERE freelancer_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS bids_job_created_idx
    ON bids (job_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS milestones_job_status_idx
    ON milestones (job_id, status, index ASC);

CREATE INDEX IF NOT EXISTS disputes_job_created_idx
    ON disputes (job_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS disputes_status_created_idx
    ON disputes (status, created_at DESC);

CREATE INDEX IF NOT EXISTS evidence_dispute_created_idx
    ON evidence (dispute_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS verdicts_dispute_created_idx
    ON verdicts (dispute_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS appeals_status_created_idx
    ON appeals (status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS arbiter_votes_appeal_created_idx
    ON arbiter_votes (appeal_id, created_at ASC, id ASC);
