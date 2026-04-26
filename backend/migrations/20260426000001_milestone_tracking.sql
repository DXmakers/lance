-- Migration 005: rich milestone tracking
--
-- Extends the milestones table with:
--   • description   – freeform scope text for the milestone
--   • due_date      – optional target completion date
--   • submitted_at  – when the freelancer submitted a deliverable for this milestone
--   • approved_at   – when the client approved (distinct from released_at which is on-chain)
--   • notes         – JSONB array of timestamped notes from either party
--   • updated_at    – auto-maintained last-modified timestamp
--
-- Adds a milestone_events audit log table for full status-change history.
-- Adds indexes for common query patterns.

-- ── Extend milestones ────────────────────────────────────────────────────────

ALTER TABLE milestones
    ADD COLUMN IF NOT EXISTS description  TEXT        NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS due_date     DATE,
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── Milestone notes ──────────────────────────────────────────────────────────
-- Separate table (not JSONB) so notes are queryable and auditable.

CREATE TABLE IF NOT EXISTS milestone_notes (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    milestone_id    UUID        NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    job_id          UUID        NOT NULL REFERENCES jobs(id)       ON DELETE CASCADE,
    author_address  TEXT        NOT NULL,
    body            TEXT        NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Milestone event log ──────────────────────────────────────────────────────
-- Immutable audit trail: every status transition is recorded here.

CREATE TABLE IF NOT EXISTS milestone_events (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    milestone_id    UUID        NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    job_id          UUID        NOT NULL REFERENCES jobs(id)       ON DELETE CASCADE,
    actor_address   TEXT        NOT NULL,
    event_type      TEXT        NOT NULL, -- submitted | approved | released | disputed | reopened
    previous_status TEXT        NOT NULL DEFAULT '',
    new_status      TEXT        NOT NULL DEFAULT '',
    tx_hash         TEXT,
    metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS milestones_job_status_idx
    ON milestones (job_id, status);

CREATE INDEX IF NOT EXISTS milestones_due_date_idx
    ON milestones (due_date)
    WHERE due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS milestone_notes_milestone_idx
    ON milestone_notes (milestone_id, created_at DESC);

CREATE INDEX IF NOT EXISTS milestone_notes_job_idx
    ON milestone_notes (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS milestone_events_milestone_idx
    ON milestone_events (milestone_id, created_at DESC);

CREATE INDEX IF NOT EXISTS milestone_events_job_idx
    ON milestone_events (job_id, created_at DESC);

-- ── updated_at trigger for milestones ────────────────────────────────────────

DROP TRIGGER IF EXISTS milestones_updated_at ON milestones;
CREATE TRIGGER milestones_updated_at
    BEFORE UPDATE ON milestones
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
