-- Migration 006: Add bid status transition tracking
-- Tracks bid status changes with timestamps for audit trail

CREATE TABLE IF NOT EXISTS bid_status_transitions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_id              UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
    from_status         TEXT NOT NULL,
    to_status           TEXT NOT NULL,
    transitioned_by     TEXT NOT NULL,
    reason              TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for efficient bid status history queries
CREATE INDEX idx_bid_status_transitions_bid_id
    ON bid_status_transitions(bid_id, created_at DESC);

-- Add updated_at column to bids for tracking changes
ALTER TABLE bids
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_bids_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bids_updated_at ON bids;
CREATE TRIGGER bids_updated_at
    BEFORE UPDATE ON bids
    FOR EACH ROW
    EXECUTE FUNCTION update_bids_updated_at();
