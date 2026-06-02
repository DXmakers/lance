-- Add high-concurrency database indexes to eliminate table scans and prevent lock contention

-- 1. Indexes on jobs table
CREATE INDEX IF NOT EXISTS idx_jobs_client_address ON jobs(client_address);
CREATE INDEX IF NOT EXISTS idx_jobs_freelancer_address ON jobs(freelancer_address);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

-- 2. Indexes on bids table
CREATE INDEX IF NOT EXISTS idx_bids_freelancer_address ON bids(freelancer_address);
CREATE INDEX IF NOT EXISTS idx_bids_job_id ON bids(job_id);

-- 3. Indexes on activity_logs table
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_address ON activity_logs(user_address);
CREATE INDEX IF NOT EXISTS idx_activity_logs_job_id ON activity_logs(job_id);
