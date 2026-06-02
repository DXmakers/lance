-- Add query-plan support and a reusable cleanup primitive for PostgreSQL-backed auth sessions.
-- The B-tree indexes keep expiry cleanup and active-session checks on indexed ranges instead
-- of table scans when the sessions table is under high-concurrency login traffic.
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_address_expires_at ON sessions(address, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires_at ON auth_challenges(expires_at);

CREATE OR REPLACE FUNCTION cleanup_expired_sessions(cutoff TIMESTAMPTZ DEFAULT now())
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    deleted_count BIGINT;
BEGIN
    DELETE FROM sessions
    WHERE expires_at <= cutoff;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;
