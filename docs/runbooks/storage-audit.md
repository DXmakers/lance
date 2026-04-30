# Storage Audit Worker Runbook

## Overview

The **Storage Audit Worker** is a security component that performs regular audits of database storage footprints to detect anomalies, track growth patterns, and ensure optimal database health.

## Architecture

### Components

1. **StorageAuditor** - Core auditing logic
   - Gathers table-level storage metrics
   - Detects anomalies (large tables, rapid growth, bloat)
   - Calculates growth statistics
   - Stores audit history

2. **StorageAuditWorker** - Background worker
   - Runs on configurable intervals (default: 1 hour)
   - Automatic cleanup of old audit data
   - Integrates with Prometheus metrics

3. **REST API** - Management interface
   - Manual audit triggers
   - Audit history retrieval
   - Anomaly management
   - Storage summary reports

### Database Schema

- `storage_audits` - Main audit records
- `storage_audit_tables` - Per-table footprint data
- `storage_anomalies` - Detected anomalies with resolution tracking

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STORAGE_AUDIT_INTERVAL_SECS` | 3600 | Seconds between automated audits |
| `STORAGE_AUDIT_MAX_GROWTH_PERCENT` | 50.0 | Threshold for rapid growth anomaly detection |
| `STORAGE_AUDIT_ANOMALY_THRESHOLD_BYTES` | 100000000 (100MB) | Table size threshold for warnings |
| `STORAGE_AUDIT_ENABLE_ALERTS` | true | Enable structured logging of anomalies |

### Example Configuration

```bash
# Run audits every 30 minutes
STORAGE_AUDIT_INTERVAL_SECS=1800

# Alert on tables > 500MB
STORAGE_AUDIT_ANOMALY_THRESHOLD_BYTES=524288000

# Alert on growth > 25% per audit cycle
STORAGE_AUDIT_MAX_GROWTH_PERCENT=25.0
```

## Deployment

### Docker Compose

The storage audit worker runs automatically in the worker container:

```yaml
services:
  worker:
    build:
      context: .
      dockerfile: backend/Dockerfile
      target: worker
    environment:
      - DATABASE_URL=postgres://lance:lance@db:5432/lance
      - STORAGE_AUDIT_INTERVAL_SECS=3600
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lance-worker
spec:
  replicas: 1
  selector:
    matchLabels:
      app: lance-worker
  template:
    spec:
      containers:
      - name: worker
        image: lance/worker:latest
        env:
        - name: STORAGE_AUDIT_INTERVAL_SECS
          value: "3600"
        - name: STORAGE_AUDIT_ENABLE_ALERTS
          value: "true"
```

## Monitoring

### Prometheus Metrics

All metrics are available at `/api/metrics` and `/api/storage/metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `storage_audit_total_audits` | Counter | Total audits performed |
| `storage_audit_total_anomalies` | Counter | Total anomalies detected |
| `storage_audit_last_duration_ms` | Gauge | Last audit duration |
| `storage_audit_last_timestamp` | Gauge | Unix timestamp of last audit |
| `storage_audit_total_bytes` | Gauge | Current database size in bytes |

### Grafana Dashboard

Access the storage audit panels in the Lance Indexer dashboard:
- Storage growth trends
- Anomaly detection alerts
- Table size breakdowns
- Audit execution history

## Operations

### Triggering a Manual Audit

```bash
curl -X POST http://localhost:3001/api/v1/storage/audits/trigger
```

Response:
```json
{
  "message": "Storage audit completed successfully",
  "audit": {
    "id": 42,
    "total_database_bytes": 1073741824,
    "table_footprints": [...],
    "anomalies": [...]
  }
}
```

### Retrieving Audit History

```bash
# Get latest 20 audits
curl http://localhost:3001/api/v1/storage/audits/history

# Get with pagination
curl "http://localhost:3001/api/v1/storage/audits/history?limit=10&offset=20"
```

### Checking Storage Summary

```bash
curl http://localhost:3001/api/v1/storage/summary
```

Response:
```json
{
  "current": {
    "audit_id": 42,
    "total_bytes": 1073741824,
    "unresolved_anomalies": 3
  },
  "trends": [...],
  "metrics": {
    "total_audits_run": 100,
    "total_anomalies_detected": 15
  }
}
```

### Managing Anomalies

```bash
# List unresolved anomalies
curl "http://localhost:3001/api/v1/storage/anomalies?unresolved_only=true"

# Resolve an anomaly
curl -X POST http://localhost:3001/api/v1/storage/anomalies/123/resolve
```

## Alerting

### Recommended Prometheus Alerts

```yaml
groups:
  - name: storage_audit_alerts
    rules:
      # Alert on audit failures
      - alert: StorageAuditNotRunning
        expr: time() - storage_audit_last_timestamp > 7200
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Storage audit hasn't run in over 2 hours"

      # Alert on high anomaly count
      - alert: StorageAnomalyHigh
        expr: storage_audit_total_anomalies > 10
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "High number of storage anomalies detected"

      # Alert on rapid database growth
      - alert: DatabaseRapidGrowth
        expr: |
          (
            storage_audit_total_bytes 
            - storage_audit_total_bytes offset 24h
          ) / storage_audit_total_bytes offset 24h > 0.5
        for: 30m
        labels:
          severity: critical
        annotations:
          summary: "Database grew by more than 50% in 24 hours"
```

## Troubleshooting

### Common Issues

#### Audit Worker Not Running

1. Check worker logs:
   ```bash
   docker logs lance-worker | grep -i "storage audit"
   ```

2. Verify database migrations:
   ```bash
   psql $DATABASE_URL -c "\dt storage_*"
   ```

#### High Anomaly Count

1. Review anomaly details:
   ```bash
   curl http://localhost:3001/api/v1/storage/anomalies
   ```

2. Common causes:
   - Rapid data ingestion
   - Missing index maintenance
   - Large batch operations

3. Resolution steps:
   - Run `VACUUM ANALYZE` on affected tables
   - Consider table partitioning for large tables
   - Review application write patterns

#### Audit Performance Issues

If audits take too long:

1. Reduce audit frequency:
   ```bash
   STORAGE_AUDIT_INTERVAL_SECS=7200  # Every 2 hours
   ```

2. Exclude large tables from anomaly detection (requires code modification)

3. Optimize table statistics:
   ```sql
   ANALYZE storage_audits;
   ANALYZE storage_audit_tables;
   ```

## Scaling Considerations

### Database Size Growth

As the database grows:

1. **Audit History Retention**: Old audits are automatically cleaned up after 90 days
2. **Anomaly Retention**: Unresolved anomalies are preserved indefinitely
3. **Index Maintenance**: Ensure indexes on `storage_audits(created_at)` and `storage_anomalies(resolved_at)`

### Worker Scaling

The storage audit worker:
- Runs as a single instance (no need for multiple workers)
- Uses minimal resources between audit cycles
- Can be co-located with other workers

## Security Considerations

1. **Database Access**: Worker requires read access to `pg_stat_*` system tables
2. **Audit Trail**: All storage changes are logged for security review
3. **Anomaly Alerts**: Sensitive table names may appear in logs

## Maintenance Procedures

### Monthly Tasks

1. Review unresolved anomalies:
   ```sql
   SELECT table_name, anomaly_type, severity, description
   FROM storage_anomalies
   WHERE resolved_at IS NULL
   ORDER BY detected_at DESC;
   ```

2. Check audit execution times:
   ```sql
   SELECT 
     DATE(created_at) as audit_date,
     AVG(audit_duration_ms) as avg_duration_ms,
     MAX(audit_duration_ms) as max_duration_ms
   FROM storage_audits
   WHERE created_at > NOW() - INTERVAL '30 days'
   GROUP BY DATE(created_at)
   ORDER BY audit_date DESC;
   ```

### Quarterly Tasks

1. Archive old audit data if needed:
   ```sql
   -- Export before deletion
   COPY (
     SELECT * FROM storage_audits
     WHERE created_at < NOW() - INTERVAL '6 months'
   ) TO '/backup/old_audits.csv';
   ```

2. Review and adjust thresholds based on growth patterns

## API Reference

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/storage/audits/latest` | Get latest audit report |
| GET | `/api/v1/storage/audits/history` | Get audit history |
| POST | `/api/v1/storage/audits/trigger` | Trigger manual audit |
| GET | `/api/v1/storage/audits/:id` | Get specific audit |
| GET | `/api/v1/storage/anomalies` | List anomalies |
| POST | `/api/v1/storage/anomalies/:id/resolve` | Resolve anomaly |
| GET | `/api/v1/storage/summary` | Get storage summary |
| GET | `/api/storage/metrics` | Prometheus metrics |

## Related Documentation

- [Indexer Runbook](./indexer.md)
- [Database Schema](../database/schema.md)
- [Monitoring Setup](../monitoring/README.md)
