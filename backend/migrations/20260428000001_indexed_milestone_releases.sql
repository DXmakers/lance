-- Tracks on-chain ReleaseMilestone events indexed by the ledger follower.
CREATE TABLE IF NOT EXISTS indexed_milestone_releases (
    id          VARCHAR(128) PRIMARY KEY,
    ledger      BIGINT NOT NULL,
    contract_id VARCHAR(64) NOT NULL,
    job_id      BIGINT NOT NULL,
    milestone_index INT NOT NULL,
    amount      BIGINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_milestone_releases_job_id ON indexed_milestone_releases(job_id);
CREATE INDEX IF NOT EXISTS idx_milestone_releases_ledger  ON indexed_milestone_releases(ledger);
