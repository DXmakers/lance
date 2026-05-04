# Ledger Indexer Operations Guide

Quick reference for operating and troubleshooting the ledger indexer.

## Quick Health Check

### Check Overall Health
```bash
curl http://localhost:3001/api/health | jq
```

### Check Indexer-Specific Health
```sql
SELECT * FROM indexer_health;
```

Expected output when healthy:
```
 last_processed_ledger | last_successful_cycle_at | health_status | worker_version 
-----------------------+--------------------------+---------------+----------------
                 12345 | 2026-04-28 10:30:45+00   | healthy       | v1.1.0
```

## Common Operations

### View Current Checkpoint
```sql
SELECT 
    last_processed_ledger,
    last_successful_cycle_at,
    total_cycles_completed,
    total_events_processed,
    worker_version
FROM indexer_state 
WHERE id = 1;
```

### View Recent Processing Activity
```sql
SELECT 
    ledger_sequence,
    events_count,
    processing_duration_ms,
    status,
    processing_completed_at
FROM ledger_processing_log
ORDER BY created_at DESC
LIMIT 20;
```

### Check for Failed Ledgers
```sql
SELECT 
    ledger_sequence,
    error_message,
    processing_started_at
FROM ledger_processing_log
WHERE status = 'failed'
ORDER BY created_at DESC;
```

### View Recent Errors
```sql
SELECT 
    last_error_at,
    last_error_message
FROM indexer_state
WHERE id = 1 AND last_error_at IS NOT NULL;
```

### Count Indexed Events
```sql
SELECT 
    COUNT(*) as total_events,
    MIN(ledger_amount) as first_ledger,
    MAX(ledger_amount) as last_ledger
FROM indexed_events;
```

### View Events by Contract
```sql
SELECT 
    contract_id,
    COUNT(*) as event_count,
    MIN(ledger_amount) as first_ledger,
    MAX(ledger_amount) as last_ledger
FROM indexed_events
GROUP BY contract_id
ORDER BY event_count DESC;
```

## Troubleshooting

### Problem: Worker Not Processing

**Symptoms:**
- `health_status = 'stale'`
- `seconds_since_last_success > 300`

**Diagnosis:**
```sql
SELECT 
    last_successful_cycle_at,
    last_error_at,
    last_error_message,
    EXTRACT(EPOCH FROM (NOW() - last_successful_cycle_at)) as seconds_stale
FROM indexer_state
WHERE id = 1;
```

**Solutions:**
1. Check if worker process is running
2. Check database connectivity
3. Check RPC endpoint availability
4. Review application logs
5. Restart worker if necessary

### Problem: High Ledger Lag

**Symptoms:**
- `ledger_lag > 100`
- `health_status = 'lagging'`

**Diagnosis:**
```bash
curl http://localhost:3001/api/health | jq '.indexer_sync_status.ledger_lag'
```

```sql
SELECT 
    ledger_sequence,
    events_count,
    processing_duration_ms
FROM ledger_processing_log
WHERE status = 'completed'
ORDER BY processing_duration_ms DESC
LIMIT 10;
```

**Solutions:**
1. Check if RPC is rate limiting (look for retry counts)
2. Check database write performance
3. Review slow ledgers in processing log
4. Consider increasing `INDEXER_RPC_RATE_LIMIT_MS`
5. Check for database locks or slow queries

### Problem: Repeated Errors

**Symptoms:**
- `health_status = 'error'`
- Errors in `last_error_message`

**Diagnosis:**
```sql
SELECT 
    last_error_at,
    last_error_message,
    last_processed_ledger
FROM indexer_state
WHERE id = 1;
```

```sql
SELECT 
    ledger_sequence,
    error_message,
    processing_started_at
FROM ledger_processing_log
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 5;
```

**Solutions:**
1. Review error message for root cause
2. Check RPC endpoint health
3. Verify database schema is up to date
4. Check for data corruption in specific ledgers
5. Review application logs for stack traces

### Problem: Suspected Duplicate Events

**Symptoms:**
- Duplicate records in application tables
- Inconsistent counts

**Diagnosis:**
```sql
-- Check for duplicate event IDs (should return 0)
SELECT id, COUNT(*) 
FROM indexed_events 
GROUP BY id 
HAVING COUNT(*) > 1;

-- Check for duplicate deposits (should return 0)
SELECT id, COUNT(*) 
FROM deposits 
GROUP BY id 
HAVING COUNT(*) > 1;
```

**Solutions:**
1. Verify database constraints are in place
2. Check transaction isolation level
3. Review recent schema changes
4. If duplicates found, investigate how they occurred
5. Clean up duplicates manually if necessary

## Maintenance Operations

### Reset Checkpoint (DANGEROUS)
Only do this if you need to reindex from a specific point:

```sql
-- Backup first!
CREATE TABLE indexer_state_backup AS SELECT * FROM indexer_state;

-- Reset to specific ledger
UPDATE indexer_state 
SET last_processed_ledger = 12000,
    last_successful_cycle_at = NULL,
    total_cycles_completed = 0,
    total_events_processed = 0
WHERE id = 1;

-- Worker will resume from ledger 12001
```

### Clean Old Processing Logs
```sql
-- Keep last 30 days
DELETE FROM ledger_processing_log
WHERE created_at < NOW() - INTERVAL '30 days';
```

### Vacuum Tables
```sql
-- After large deletes or updates
VACUUM ANALYZE indexed_events;
VACUUM ANALYZE ledger_processing_log;
VACUUM ANALYZE indexer_state;
```

## Monitoring Queries

### Processing Rate (Last Hour)
```sql
SELECT 
    COUNT(*) as cycles,
    SUM(events_count) as total_events,
    AVG(processing_duration_ms) as avg_duration_ms,
    MAX(processing_duration_ms) as max_duration_ms
FROM ledger_processing_log
WHERE processing_completed_at > NOW() - INTERVAL '1 hour'
  AND status = 'completed';
```

### Error Rate (Last Hour)
```sql
SELECT 
    COUNT(*) as failed_cycles,
    COUNT(*) * 100.0 / NULLIF((
        SELECT COUNT(*) 
        FROM ledger_processing_log 
        WHERE created_at > NOW() - INTERVAL '1 hour'
    ), 0) as error_rate_percent
FROM ledger_processing_log
WHERE created_at > NOW() - INTERVAL '1 hour'
  AND status = 'failed';
```

### Throughput Over Time
```sql
SELECT 
    DATE_TRUNC('hour', processing_completed_at) as hour,
    COUNT(*) as cycles,
    SUM(events_count) as events,
    AVG(processing_duration_ms) as avg_duration_ms
FROM ledger_processing_log
WHERE processing_completed_at > NOW() - INTERVAL '24 hours'
  AND status = 'completed'
GROUP BY DATE_TRUNC('hour', processing_completed_at)
ORDER BY hour DESC;
```

### Slowest Ledgers (Last 24 Hours)
```sql
SELECT 
    ledger_sequence,
    events_count,
    processing_duration_ms,
    processing_completed_at
FROM ledger_processing_log
WHERE processing_completed_at > NOW() - INTERVAL '24 hours'
  AND status = 'completed'
ORDER BY processing_duration_ms DESC
LIMIT 10;
```

## Alerting Thresholds

Recommended alert conditions:

### Critical Alerts
```sql
-- Worker completely stalled (no activity for 10 minutes)
SELECT 
    CASE 
        WHEN EXTRACT(EPOCH FROM (NOW() - last_successful_cycle_at)) > 600 
        THEN 'CRITICAL: Worker stalled'
        ELSE 'OK'
    END as alert
FROM indexer_state WHERE id = 1;

-- Ledger lag too high (> 1000 ledgers behind)
-- Check via API: curl http://localhost:3001/api/health
```

### Warning Alerts
```sql
-- Worker slow (no activity for 5 minutes)
SELECT 
    CASE 
        WHEN EXTRACT(EPOCH FROM (NOW() - last_successful_cycle_at)) > 300 
        THEN 'WARNING: Worker slow'
        ELSE 'OK'
    END as alert
FROM indexer_state WHERE id = 1;

-- High error rate (> 10% in last hour)
SELECT 
    CASE 
        WHEN COUNT(*) * 100.0 / NULLIF((
            SELECT COUNT(*) 
            FROM ledger_processing_log 
            WHERE created_at > NOW() - INTERVAL '1 hour'
        ), 0) > 10
        THEN 'WARNING: High error rate'
        ELSE 'OK'
    END as alert
FROM ledger_processing_log
WHERE created_at > NOW() - INTERVAL '1 hour'
  AND status = 'failed';
```

## Performance Tuning

### Check Index Usage
```sql
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE tablename IN ('indexed_events', 'ledger_processing_log', 'indexer_state')
ORDER BY idx_scan DESC;
```

### Check Table Sizes
```sql
SELECT 
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename IN ('indexed_events', 'ledger_processing_log', 'indexer_state', 'deposits')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Analyze Query Performance
```sql
EXPLAIN ANALYZE
SELECT * FROM indexed_events 
WHERE ledger_amount BETWEEN 10000 AND 11000;
```

## Backup and Recovery

### Backup Indexer State
```bash
pg_dump -h localhost -U lance -d lance \
  -t indexer_state \
  -t indexed_events \
  -t ledger_processing_log \
  > indexer_backup_$(date +%Y%m%d).sql
```

### Restore from Backup
```bash
psql -h localhost -U lance -d lance < indexer_backup_20260428.sql
```

## Emergency Procedures

### Stop Indexer
```bash
# Find the process
ps aux | grep backend

# Kill gracefully
kill -TERM <pid>

# Force kill if necessary (last resort)
kill -9 <pid>
```

### Restart Indexer
```bash
# Start the backend (includes indexer worker)
cargo run --bin backend

# Or if using systemd
systemctl restart lance-backend
```

### Force Checkpoint Update
```sql
-- Only if you're certain about the ledger number
SELECT update_indexer_checkpoint(12345, 0, 'v1.1.0');
```

## Useful Dashboards

### Real-Time Status
```sql
SELECT 
    health_status,
    last_processed_ledger,
    total_cycles_completed,
    total_events_processed,
    worker_version,
    EXTRACT(EPOCH FROM (NOW() - last_successful_cycle_at)) as seconds_since_success
FROM indexer_health;
```

### Recent Activity Summary
```sql
SELECT 
    COUNT(*) FILTER (WHERE status = 'completed') as completed,
    COUNT(*) FILTER (WHERE status = 'failed') as failed,
    COUNT(*) FILTER (WHERE status = 'processing') as in_progress,
    SUM(events_count) as total_events,
    AVG(processing_duration_ms) FILTER (WHERE status = 'completed') as avg_duration_ms
FROM ledger_processing_log
WHERE created_at > NOW() - INTERVAL '1 hour';
```

## Contact and Escalation

If issues persist:
1. Check application logs for detailed error messages
2. Review Prometheus metrics for trends
3. Check Soroban RPC status page
4. Escalate to backend team with:
   - Output of health check queries
   - Recent error messages
   - Processing log for affected ledgers
   - Application logs
