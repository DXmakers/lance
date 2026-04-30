-- Storage Audit tables for regular footprint monitoring
-- This migration creates the schema for tracking database storage usage
-- and detecting anomalies in storage growth patterns.

-- Main table for storage audit records
CREATE TABLE IF NOT EXISTS storage_audits (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_database_bytes BIGINT NOT NULL DEFAULT 0,
    total_row_count BIGINT NOT NULL DEFAULT 0,
    audit_duration_ms INTEGER NOT NULL DEFAULT 0
);

-- Table-level storage footprints for each audit
CREATE TABLE IF NOT EXISTS storage_audit_tables (
    id BIGSERIAL PRIMARY KEY,
    audit_id BIGINT NOT NULL REFERENCES storage_audits(id) ON DELETE CASCADE,
    table_name TEXT NOT NULL,
    total_bytes BIGINT NOT NULL DEFAULT 0,
    row_count BIGINT NOT NULL DEFAULT 0,
    index_bytes BIGINT NOT NULL DEFAULT 0,
    toast_bytes BIGINT NOT NULL DEFAULT 0,
    percent_of_total DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(audit_id, table_name)
);

-- Anomalies detected during storage audits
CREATE TABLE IF NOT EXISTS storage_anomalies (
    id BIGSERIAL PRIMARY KEY,
    audit_id BIGINT NOT NULL REFERENCES storage_audits(id) ON DELETE CASCADE,
    table_name TEXT NOT NULL,
    anomaly_type TEXT NOT NULL, -- 'large_table', 'rapid_growth', 'table_bloat', etc.
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    description TEXT NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    resolution_notes TEXT
);

-- Index for faster anomaly queries
CREATE INDEX IF NOT EXISTS idx_storage_anomalies_unresolved 
    ON storage_anomalies(resolved_at) 
    WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_storage_anomalies_table 
    ON storage_anomalies(table_name);

CREATE INDEX IF NOT EXISTS idx_storage_audit_tables_audit 
    ON storage_audit_tables(audit_id);

CREATE INDEX IF NOT EXISTS idx_storage_audits_created 
    ON storage_audits(created_at DESC);

-- View for latest storage summary
CREATE OR REPLACE VIEW latest_storage_summary AS
SELECT 
    sa.id as audit_id,
    sa.created_at,
    sa.total_database_bytes,
    sa.total_row_count,
    COUNT(sa2.id) as unresolved_anomaly_count
FROM storage_audits sa
LEFT JOIN storage_anomalies sa2 ON sa.id = sa2.audit_id AND sa2.resolved_at IS NULL
WHERE sa.id = (SELECT MAX(id) FROM storage_audits)
GROUP BY sa.id, sa.created_at, sa.total_database_bytes, sa.total_row_count;

-- View for storage trends over time
CREATE OR REPLACE VIEW storage_trend_summary AS
SELECT 
    DATE(created_at) as audit_date,
    MAX(total_database_bytes) as peak_bytes,
    MIN(total_database_bytes) as min_bytes,
    AVG(total_database_bytes)::BIGINT as avg_bytes,
    MAX(total_row_count) as peak_rows,
    SUM(audit_duration_ms) as total_audit_time_ms
FROM storage_audits
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY audit_date DESC;

-- Function to get storage growth rate
CREATE OR REPLACE FUNCTION calculate_storage_growth_rate(
    p_hours_back INTEGER DEFAULT 24
) RETURNS TABLE (
    table_name TEXT,
    current_bytes BIGINT,
    previous_bytes BIGINT,
    bytes_growth BIGINT,
    percent_growth NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH current_audit AS (
        SELECT id, created_at
        FROM storage_audits
        ORDER BY id DESC
        LIMIT 1
    ),
    previous_audit AS (
        SELECT id, created_at
        FROM storage_audits
        WHERE created_at < NOW() - INTERVAL '1 hour' * p_hours_back
        ORDER BY id DESC
        LIMIT 1
    )
    SELECT 
        curr.table_name::TEXT,
        curr.total_bytes as current_bytes,
        COALESCE(prev.total_bytes, 0) as previous_bytes,
        curr.total_bytes - COALESCE(prev.total_bytes, 0) as bytes_growth,
        CASE 
            WHEN prev.total_bytes > 0 
            THEN ROUND(((curr.total_bytes - prev.total_bytes)::NUMERIC / prev.total_bytes) * 100, 2)
            ELSE 0
        END as percent_growth
    FROM storage_audit_tables curr
    JOIN current_audit ca ON curr.audit_id = ca.id
    LEFT JOIN storage_audit_tables prev ON prev.table_name = curr.table_name
        AND prev.audit_id = (SELECT id FROM previous_audit);
END;
$$ LANGUAGE plpgsql;

-- Comment on tables for documentation
COMMENT ON TABLE storage_audits IS 'Records of periodic storage footprint audits';
COMMENT ON TABLE storage_audit_tables IS 'Per-table storage metrics for each audit';
COMMENT ON TABLE storage_anomalies IS 'Storage anomalies detected during audits (large tables, rapid growth, bloat)';

COMMENT ON COLUMN storage_anomalies.anomaly_type IS 'Type: large_table, rapid_growth, table_bloat';
COMMENT ON COLUMN storage_anomalies.severity IS 'Level: info, warning, critical';
