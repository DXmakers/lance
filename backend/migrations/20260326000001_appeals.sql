-- Migration 002: appeal process for large disputes

CREATE TABLE IF NOT EXISTS appeals (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dispute_id  UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'open',  -- open | closed_override | closed_upheld
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(dispute_id) -- only one appeal per dispute
);

CREATE TABLE IF NOT EXISTS arbiter_votes (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    appeal_id               UUID NOT NULL REFERENCES appeals(id) ON DELETE CASCADE,
    arbiter_address         TEXT NOT NULL,
    freelancer_share_bps    INT NOT NULL DEFAULT 0,
    reasoning               TEXT NOT NULL DEFAULT '',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(appeal_id, arbiter_address) -- one vote per arbiter per appeal
);

-- Registered arbiter addresses (the 5-member panel)
CREATE TABLE IF NOT EXISTS arbiters (
    address     TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
