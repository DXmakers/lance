-- Migration 001: initial schema
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS jobs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title               TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    budget_usdc         BIGINT NOT NULL DEFAULT 0,
    milestones          INT NOT NULL DEFAULT 1,
    client_address      TEXT NOT NULL,
    freelancer_address  TEXT,
    status              TEXT NOT NULL DEFAULT 'open',
    metadata_hash       TEXT,
    on_chain_job_id     BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bids (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id              UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    freelancer_address  TEXT NOT NULL,
    proposal            TEXT NOT NULL DEFAULT '',
    proposal_hash       TEXT,
    status              TEXT NOT NULL DEFAULT 'pending',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS milestones (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    index           INT NOT NULL,
    title           TEXT NOT NULL DEFAULT '',
    amount_usdc     BIGINT NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'pending',
    tx_hash         TEXT,
    released_at     TIMESTAMPTZ,
    UNIQUE(job_id, index)
);

CREATE TABLE IF NOT EXISTS disputes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    opened_by   TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evidence (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dispute_id      UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    submitted_by    TEXT NOT NULL,
    content         TEXT NOT NULL DEFAULT '',
    file_hash       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS verdicts (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dispute_id              UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    winner                  TEXT NOT NULL,
    freelancer_share_bps    INT NOT NULL DEFAULT 0,
    reasoning               TEXT NOT NULL DEFAULT '',
    on_chain_tx             TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at trigger for jobs
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
