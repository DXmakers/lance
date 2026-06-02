-- BE-API-099: indexes for bounded job search/filter plans.
-- These indexes are intentionally created concurrently so production deploys do
-- not block writes while the planner learns cheaper paths for /api/v1/jobs.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_created_id_desc
  ON jobs (created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_status_created_id_desc
  ON jobs (status, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_budget_created_id_desc
  ON jobs (budget_usdc DESC, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_deadline_created_id_desc
  ON jobs (deadline_at, created_at DESC, id DESC)
  WHERE deadline_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_skills_gin
  ON jobs USING gin (skills);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_search_tsv_gin
  ON jobs USING gin (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_title_trgm
  ON jobs USING gin (title gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_description_trgm
  ON jobs USING gin (description gin_trgm_ops);
