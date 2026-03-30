-- Migration 003: public profiles and milestone deliverables

CREATE TABLE IF NOT EXISTS profiles (
    address         TEXT PRIMARY KEY,
    display_name    TEXT,
    headline        TEXT NOT NULL DEFAULT '',
    bio             TEXT NOT NULL DEFAULT '',
    portfolio_links JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deliverables (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    milestone_index INT NOT NULL,
    submitted_by    TEXT NOT NULL,
    label           TEXT NOT NULL DEFAULT '',
    kind            TEXT NOT NULL DEFAULT 'link',
    url             TEXT NOT NULL DEFAULT '',
    file_hash       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deliverables_job_created_idx
    ON deliverables (job_id, created_at DESC);

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
