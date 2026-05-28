-- Configure PostgreSQL Indexes on Sensitive User Address Mappings
-- BE-API-085: Optimize queries on address fields for high concurrency and connection pooling

-- Index on profiles.address for fast profile lookups by wallet address
CREATE INDEX IF NOT EXISTS idx_profiles_address ON profiles(address);

-- Index on saved_jobs.user_address for efficient user-saved job queries with pagination
CREATE INDEX IF NOT EXISTS idx_saved_jobs_user_address ON saved_jobs(user_address, created_at DESC);

-- Composite index on activity_logs for address-based activity queries with timestamp ordering
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_address ON activity_logs(user_address, created_at DESC)
WHERE user_address IS NOT NULL;

-- Index on sessions.address for efficient session lookup and cleanup
CREATE INDEX IF NOT EXISTS idx_sessions_address_created ON sessions(address, expires_at DESC);

-- Index on arbiters.address for fast arbiter lookups
CREATE INDEX IF NOT EXISTS idx_arbiters_address_active ON arbiters(address, active);

-- Composite index on jobs for efficient client/freelancer queries with sorting
CREATE INDEX IF NOT EXISTS idx_jobs_client_address ON jobs(client_address, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_freelancer_address ON jobs(freelancer_address, status, created_at DESC)
WHERE freelancer_address IS NOT NULL;

-- Index on bids for efficient freelancer bid queries
CREATE INDEX IF NOT EXISTS idx_bids_freelancer_address ON bids(freelancer_address, created_at DESC);

-- Index on disputes for efficient dispute tracking by participant
CREATE INDEX IF NOT EXISTS idx_disputes_opened_by ON disputes(opened_by, created_at DESC);

-- Partial index on transaction_queue for active transactions (excludes completed/failed)
CREATE INDEX IF NOT EXISTS idx_transaction_queue_active ON transaction_queue(status, scheduled_at)
WHERE status IN ('queued', 'processing', 'pending');

-- Add constraint for connection pool validation (ensures addresses are non-empty when present)
ALTER TABLE profiles ADD CONSTRAINT chk_profiles_address_not_empty CHECK (address != '');
ALTER TABLE saved_jobs ADD CONSTRAINT chk_saved_jobs_user_address_not_empty CHECK (user_address != '');

-- VACUUM ANALYZE to update statistics after index creation
VACUUM ANALYZE profiles;
VACUUM ANALYZE saved_jobs;
VACUUM ANALYZE activity_logs;
VACUUM ANALYZE sessions;
VACUUM ANALYZE arbiters;
VACUUM ANALYZE jobs;
VACUUM ANALYZE bids;
VACUUM ANALYZE disputes;
VACUUM ANALYZE transaction_queue;
