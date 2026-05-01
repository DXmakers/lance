# Production Runbook: Blockchain Indexer

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Deployment](#deployment)
4. [Scaling](#scaling)
5. [Monitoring](#monitoring)
6. [Operations](#operations)
7. [Troubleshooting](#troubleshooting)
8. [Disaster Recovery](#disaster-recovery)

---

## Overview

This runbook provides operational procedures for deploying, scaling, and maintaining the blockchain indexer in production environments using Docker and Kubernetes.

### System Components

- **Indexer Worker**: Rust-based async worker that processes blockchain events
- **PostgreSQL**: Stores indexed events and checkpoint state
- **Prometheus**: Metrics collection and alerting
- **Grafana**: Visualization and dashboards
- **Loki** (optional): Log aggregation

### Key Metrics

- **Event Processing Rate**: Events/second throughput
- **Ledger Lag**: How many ledgers behind the network
- **Error Count**: Total indexing errors
- **Processing Latency**: Time to process each cycle

---

## Architecture

### High-Level Design

```
┌─────────────────┐
│  Stellar/Soroban│
│   RPC Endpoint  │
└────────┬────────┘
         │
         │ getEvents()
         │
┌────────▼────────┐
│ Indexer Worker  │◄──── Prometheus (scrape /metrics)
│   (Rust/Tokio)  │
└────────┬────────┘
         │
         │ SQL
         │
┌────────▼────────┐
│   PostgreSQL    │
│  (Checkpoint +  │
│     Events)     │
└─────────────────┘
```

### Data Flow

1. Worker reads last checkpoint from PostgreSQL
2. Worker fetches events from RPC starting at checkpoint + 1
3. Worker processes events in atomic transaction
4. Worker updates checkpoint and commits transaction
5. Prometheus scrapes metrics from `/api/metrics`
6. Grafana visualizes metrics and logs

---

## Deployment

### Prerequisites

- Docker 20.10+
- Kubernetes 1.24+ (for K8s deployment)
- PostgreSQL 14+
- Prometheus 2.40+
- Grafana 10.0+

### Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:pass@host:5432/dbname
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org

# Optional (with defaults)
PORT=3001
INDEXER_IDLE_POLL_MS=2000
INDEXER_RPC_RATE_LIMIT_MS=250
INDEXER_RPC_RETRY_MAX_ATTEMPTS=4
INDEXER_RPC_RETRY_INITIAL_BACKOFF_MS=500
INDEXER_RPC_RETRY_MAX_BACKOFF_MS=5000
INDEXER_WORKER_RETRY_MAX_ATTEMPTS=4
INDEXER_WORKER_RETRY_INITIAL_BACKOFF_MS=1000
INDEXER_WORKER_RETRY_MAX_BACKOFF_MS=60000
INDEXER_MAX_LEDGER_LAG=5
RUST_LOG=backend=info
```

### Docker Deployment

#### 1. Build Docker Image

```dockerfile
# Dockerfile
FROM rust:1.75-slim as builder

WORKDIR /app
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src ./src
COPY backend/migrations ./migrations

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/backend /app/backend
COPY --from=builder /app/migrations /app/migrations

EXPOSE 3001

CMD ["/app/backend"]
```

#### 2. Build and Push

```bash
# Build image
docker build -t indexer:latest -f backend/Dockerfile .

# Tag for registry
docker tag indexer:latest your-registry.com/indexer:v1.0.0

# Push to registry
docker push your-registry.com/indexer:v1.0.0
```

#### 3. Docker Compose (Development/Testing)

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:14-alpine
    environment:
      POSTGRES_DB: indexer
      POSTGRES_USER: indexer
      POSTGRES_PASSWORD: changeme
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U indexer"]
      interval: 10s
      timeout: 5s
      retries: 5

  indexer:
    image: indexer:latest
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://indexer:changeme@postgres:5432/indexer
      SOROBAN_RPC_URL: https://soroban-testnet.stellar.org
      RUST_LOG: backend=info
    ports:
      - "3001:3001"
    restart: unless-stopped

  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=30d'

  grafana:
    image: grafana/grafana:latest
    depends_on:
      - prometheus
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
      GF_INSTALL_PLUGINS: grafana-piechart-panel
    volumes:
      - ./grafana-dashboard.json:/etc/grafana/provisioning/dashboards/indexer.json
      - ./grafana-datasources.yml:/etc/grafana/provisioning/datasources/datasources.yml
      - grafana_data:/var/lib/grafana
    ports:
      - "3000:3000"

volumes:
  postgres_data:
  prometheus_data:
  grafana_data:
```

#### 4. Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'backend'
    static_configs:
      - targets: ['indexer:3001']
    metrics_path: '/api/metrics'
    scrape_interval: 10s
```

#### 5. Grafana Datasource Configuration

```yaml
# grafana-datasources.yml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
```

#### 6. Start Services

```bash
docker-compose up -d

# Check logs
docker-compose logs -f indexer

# Check health
curl http://localhost:3001/api/health
```

### Kubernetes Deployment

#### 1. Namespace

```yaml
# namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: indexer
```

#### 2. ConfigMap

```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: indexer-config
  namespace: indexer
data:
  SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org"
  PORT: "3001"
  INDEXER_IDLE_POLL_MS: "2000"
  INDEXER_RPC_RATE_LIMIT_MS: "250"
  RUST_LOG: "backend=info"
```

#### 3. Secret

```yaml
# secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: indexer-secrets
  namespace: indexer
type: Opaque
stringData:
  DATABASE_URL: "postgresql://user:password@postgres-service:5432/indexer"
```

#### 4. Deployment

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: indexer
  namespace: indexer
  labels:
    app: indexer
spec:
  replicas: 1  # Single instance for checkpoint consistency
  selector:
    matchLabels:
      app: indexer
  template:
    metadata:
      labels:
        app: indexer
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "3001"
        prometheus.io/path: "/api/metrics"
    spec:
      containers:
      - name: indexer
        image: your-registry.com/indexer:v1.0.0
        ports:
        - containerPort: 3001
          name: http
          protocol: TCP
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: indexer-secrets
              key: DATABASE_URL
        envFrom:
        - configMapRef:
            name: indexer-config
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
        livenessProbe:
          httpGet:
            path: /api/health/live
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /api/health/ready
            port: 3001
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
        startupProbe:
          httpGet:
            path: /api/health/live
            port: 3001
          initialDelaySeconds: 0
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 30
      restartPolicy: Always
```

#### 5. Service

```yaml
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: indexer-service
  namespace: indexer
  labels:
    app: indexer
spec:
  type: ClusterIP
  ports:
  - port: 3001
    targetPort: 3001
    protocol: TCP
    name: http
  selector:
    app: indexer
```

#### 6. ServiceMonitor (for Prometheus Operator)

```yaml
# servicemonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: indexer
  namespace: indexer
  labels:
    app: indexer
spec:
  selector:
    matchLabels:
      app: indexer
  endpoints:
  - port: http
    path: /api/metrics
    interval: 10s
```

#### 7. HorizontalPodAutoscaler (Optional - for read replicas)

```yaml
# hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: indexer-hpa
  namespace: indexer
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: indexer
  minReplicas: 1
  maxReplicas: 1  # Keep at 1 for indexer to avoid checkpoint conflicts
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 80
```

#### 8. Deploy to Kubernetes

```bash
# Apply all manifests
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml
kubectl apply -f secret.yaml
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
kubectl apply -f servicemonitor.yaml

# Check deployment
kubectl get pods -n indexer
kubectl logs -f -n indexer deployment/indexer

# Check health
kubectl port-forward -n indexer svc/indexer-service 3001:3001
curl http://localhost:3001/api/health
```

---

## Scaling

### Vertical Scaling

The indexer is designed as a single-instance worker to maintain checkpoint consistency. Scale vertically by increasing resources:

#### Docker

```yaml
# docker-compose.yml
services:
  indexer:
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 4G
        reservations:
          cpus: '2'
          memory: 2G
```

#### Kubernetes

```yaml
resources:
  requests:
    memory: "2Gi"
    cpu: "1000m"
  limits:
    memory: "8Gi"
    cpu: "4000m"
```

### Horizontal Scaling (Advanced)

**⚠️ WARNING**: The indexer uses a single checkpoint. Running multiple instances requires careful coordination.

#### Option 1: Shard by Contract ID

Deploy multiple indexers, each processing events from specific contracts:

```yaml
# indexer-shard-1.yaml
env:
- name: CONTRACT_FILTER
  value: "CONTRACT_ID_1,CONTRACT_ID_2"
```

Requires code modification to filter events by contract.

#### Option 2: Leader Election

Use Kubernetes leader election to ensure only one active indexer:

```yaml
# Requires leader election sidecar or library
# Only the leader processes events
# Followers remain on standby
```

#### Option 3: Read Replicas

Scale the API/health check endpoints separately from the indexer:

```yaml
# Separate deployment for read-only API
apiVersion: apps/v1
kind: Deployment
metadata:
  name: indexer-api
spec:
  replicas: 3  # Scale API independently
```

### Database Scaling

#### Connection Pooling

```rust
// Adjust in code
PgPoolOptions::new()
    .max_connections(20)  // Increase for higher throughput
    .connect(&database_url)
```

#### Read Replicas

Configure PostgreSQL read replicas for health check queries:

```yaml
env:
- name: DATABASE_READ_URL
  value: "postgresql://user:pass@postgres-replica:5432/indexer"
```

---

## Monitoring

### Grafana Dashboard

Import the provided `grafana-dashboard.json`:

1. Open Grafana (http://localhost:3000)
2. Navigate to Dashboards → Import
3. Upload `grafana-dashboard.json`
4. Select Prometheus datasource
5. Click Import

### Key Panels

1. **Ledger Lag**: Current lag behind network (green if ≤5, red if >5)
2. **Ledger Status**: Last processed ledger and network height (monospace font)
3. **Total Errors**: Cumulative error count (red if >0)
4. **Events Processed**: Total events indexed
5. **Event Processing Rate**: Real-time throughput chart
6. **Error Rate**: Errors per minute (bar chart)
7. **Processing Latency**: p50, p95, p99 percentiles
8. **Ledger Lag Over Time**: Historical lag trend
9. **Recent Indexer Events**: Compact log table

### Alerts

Configure Prometheus alerts:

```yaml
# alerts.yml
groups:
  - name: indexer
    interval: 30s
    rules:
      - alert: IndexerHighLag
        expr: indexer_ledger_lag > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Indexer is lagging behind network"
          description: "Ledger lag is {{ $value }} (threshold: 10)"

      - alert: IndexerErrors
        expr: increase(indexer_errors_total[5m]) > 5
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Indexer experiencing errors"
          description: "{{ $value }} errors in last 5 minutes"

      - alert: IndexerDown
        expr: up{job="backend"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Indexer is down"
          description: "Indexer has been down for 1 minute"

      - alert: IndexerSlowProcessing
        expr: histogram_quantile(0.95, rate(indexer_processing_latency_seconds_bucket[5m])) > 5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Indexer processing is slow"
          description: "p95 latency is {{ $value }}s (threshold: 5s)"
```

### Log Aggregation (Optional)

#### Loki Configuration

```yaml
# promtail-config.yml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: indexer
    static_configs:
      - targets:
          - localhost
        labels:
          job: backend
          __path__: /var/log/indexer/*.log
```

---

## Operations

### Manual Indexer Restart

#### Docker

```bash
# Graceful restart
docker-compose restart indexer

# Force restart
docker-compose stop indexer
docker-compose up -d indexer

# Check logs
docker-compose logs -f indexer
```

#### Kubernetes

```bash
# Rolling restart
kubectl rollout restart deployment/indexer -n indexer

# Force delete pod (will recreate)
kubectl delete pod -l app=indexer -n indexer

# Check status
kubectl rollout status deployment/indexer -n indexer
kubectl logs -f -n indexer deployment/indexer
```

### Ledger Re-scan

To re-index from a specific ledger:

#### Option 1: Update Checkpoint in Database

```sql
-- Connect to PostgreSQL
psql $DATABASE_URL

-- Check current checkpoint
SELECT * FROM indexer_state WHERE id = 1;

-- Reset to specific ledger (e.g., 12000)
UPDATE indexer_state 
SET last_processed_ledger = 12000, updated_at = NOW() 
WHERE id = 1;

-- Verify
SELECT * FROM indexer_state WHERE id = 1;
```

#### Option 2: Delete and Reinitialize

```sql
-- ⚠️ WARNING: This will re-index from latest network ledger
DELETE FROM indexer_state WHERE id = 1;

-- Restart indexer to reinitialize
```

#### Option 3: Full Re-index

```sql
-- ⚠️ WARNING: This deletes all indexed data
TRUNCATE TABLE indexed_events CASCADE;
TRUNCATE TABLE deposits CASCADE;
TRUNCATE TABLE indexed_disputes CASCADE;
DELETE FROM indexer_state WHERE id = 1;

-- Restart indexer
```

### Configuration Updates

#### Docker

```bash
# Update environment variables in docker-compose.yml
vim docker-compose.yml

# Restart with new config
docker-compose up -d indexer
```

#### Kubernetes

```bash
# Update ConfigMap
kubectl edit configmap indexer-config -n indexer

# Update Secret
kubectl edit secret indexer-secrets -n indexer

# Restart to apply changes
kubectl rollout restart deployment/indexer -n indexer
```

### Database Maintenance

#### Backup

```bash
# Full backup
pg_dump $DATABASE_URL > indexer_backup_$(date +%Y%m%d).sql

# Compressed backup
pg_dump $DATABASE_URL | gzip > indexer_backup_$(date +%Y%m%d).sql.gz

# Backup to S3
pg_dump $DATABASE_URL | gzip | aws s3 cp - s3://backups/indexer_$(date +%Y%m%d).sql.gz
```

#### Restore

```bash
# Restore from backup
psql $DATABASE_URL < indexer_backup_20260428.sql

# Restore from compressed
gunzip -c indexer_backup_20260428.sql.gz | psql $DATABASE_URL
```

#### Vacuum

```sql
-- Analyze tables
ANALYZE indexed_events;
ANALYZE deposits;
ANALYZE indexed_disputes;

-- Vacuum to reclaim space
VACUUM ANALYZE indexed_events;
VACUUM ANALYZE deposits;
VACUUM ANALYZE indexed_disputes;
```

---

## Troubleshooting

### High Ledger Lag

**Symptoms**: `indexer_ledger_lag` > 10

**Possible Causes**:
1. Slow RPC responses
2. Database performance issues
3. High event volume
4. Insufficient resources

**Diagnosis**:

```bash
# Check RPC latency
curl http://localhost:3001/api/sync-status | jq '.last_rpc_latency_ms'

# Check processing rate
curl http://localhost:3001/api/sync-status | jq '.last_batch_rate_per_second'

# Check database connections
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'indexer';"

# Check resource usage
docker stats indexer  # Docker
kubectl top pod -n indexer  # Kubernetes
```

**Solutions**:

1. **Increase RPC rate limit**:
   ```bash
   INDEXER_RPC_RATE_LIMIT_MS=100  # Reduce from 250ms
   ```

2. **Optimize database**:
   ```sql
   CREATE INDEX CONCURRENTLY idx_indexed_events_ledger ON indexed_events(ledger_amount);
   VACUUM ANALYZE indexed_events;
   ```

3. **Scale vertically**:
   - Increase CPU/memory limits
   - Upgrade database instance

4. **Check RPC provider**:
   - Switch to different RPC endpoint
   - Contact provider about rate limits

### Frequent Errors

**Symptoms**: `indexer_errors_total` increasing

**Diagnosis**:

```bash
# Check recent errors in logs
docker-compose logs --tail=100 indexer | grep ERROR

# Kubernetes
kubectl logs -n indexer deployment/indexer --tail=100 | grep ERROR

# Check error rate
curl http://localhost:3001/api/sync-status | jq '.error_count'
```

**Common Errors**:

1. **Database connection errors**:
   ```
   error="database connection lost"
   ```
   - Check PostgreSQL health
   - Verify connection string
   - Check network connectivity

2. **RPC errors**:
   ```
   error="RPC getEvents HTTP 429: too many requests"
   ```
   - Increase `INDEXER_RPC_RETRY_MAX_BACKOFF_MS`
   - Reduce `INDEXER_RPC_RATE_LIMIT_MS`
   - Switch RPC provider

3. **Transaction errors**:
   ```
   error="failed to commit transaction"
   ```
   - Check database locks
   - Verify database disk space
   - Check for long-running queries

### Indexer Not Processing

**Symptoms**: Checkpoint not advancing

**Diagnosis**:

```bash
# Check if indexer is running
docker ps | grep indexer
kubectl get pods -n indexer

# Check health endpoints
curl http://localhost:3001/api/health/live
curl http://localhost:3001/api/health/ready

# Check logs for stuck state
docker-compose logs --tail=50 indexer
kubectl logs -n indexer deployment/indexer --tail=50
```

**Solutions**:

1. **Restart indexer**:
   ```bash
   docker-compose restart indexer
   kubectl rollout restart deployment/indexer -n indexer
   ```

2. **Check database connectivity**:
   ```bash
   psql $DATABASE_URL -c "SELECT 1;"
   ```

3. **Verify RPC endpoint**:
   ```bash
   curl -X POST $SOROBAN_RPC_URL \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger","params":{}}'
   ```

### High Memory Usage

**Symptoms**: OOMKilled, high memory consumption

**Diagnosis**:

```bash
# Check memory usage
docker stats indexer
kubectl top pod -n indexer

# Check for memory leaks in logs
docker-compose logs indexer | grep -i "memory\|oom"
```

**Solutions**:

1. **Increase memory limits**:
   ```yaml
   resources:
     limits:
       memory: "4Gi"
   ```

2. **Reduce batch size** (requires code change):
   - Process fewer events per cycle
   - Commit more frequently

3. **Check for connection leaks**:
   ```sql
   SELECT count(*) FROM pg_stat_activity WHERE datname = 'indexer';
   ```

### Slow Queries

**Symptoms**: High `indexer_processing_latency_seconds`

**Diagnosis**:

```sql
-- Check slow queries
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
WHERE query LIKE '%indexed_events%'
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Check missing indexes
SELECT schemaname, tablename, attname, n_distinct, correlation
FROM pg_stats
WHERE tablename IN ('indexed_events', 'deposits', 'indexed_disputes')
ORDER BY abs(correlation) DESC;
```

**Solutions**:

1. **Add indexes**:
   ```sql
   CREATE INDEX CONCURRENTLY idx_indexed_events_ledger ON indexed_events(ledger_amount);
   CREATE INDEX CONCURRENTLY idx_deposits_ledger ON deposits(ledger);
   CREATE INDEX CONCURRENTLY idx_disputes_ledger ON indexed_disputes(ledger);
   ```

2. **Analyze tables**:
   ```sql
   ANALYZE indexed_events;
   ANALYZE deposits;
   ANALYZE indexed_disputes;
   ```

---

## Disaster Recovery

### Checkpoint Corruption

**Scenario**: Checkpoint is incorrect or corrupted

**Recovery**:

1. **Stop indexer**:
   ```bash
   docker-compose stop indexer
   kubectl scale deployment/indexer --replicas=0 -n indexer
   ```

2. **Identify last good ledger**:
   ```sql
   SELECT MAX(ledger_amount) FROM indexed_events;
   ```

3. **Reset checkpoint**:
   ```sql
   UPDATE indexer_state 
   SET last_processed_ledger = (SELECT MAX(ledger_amount) FROM indexed_events),
       updated_at = NOW()
   WHERE id = 1;
   ```

4. **Restart indexer**:
   ```bash
   docker-compose start indexer
   kubectl scale deployment/indexer --replicas=1 -n indexer
   ```

### Database Failure

**Scenario**: PostgreSQL is down or corrupted

**Recovery**:

1. **Restore from backup**:
   ```bash
   # Stop indexer
   docker-compose stop indexer

   # Restore database
   psql $DATABASE_URL < indexer_backup_latest.sql

   # Restart indexer
   docker-compose start indexer
   ```

2. **If no backup, reinitialize**:
   ```sql
   -- Run migrations
   -- Indexer will start from latest network ledger
   DELETE FROM indexer_state WHERE id = 1;
   ```

### RPC Provider Outage

**Scenario**: Primary RPC endpoint is down

**Recovery**:

1. **Switch to backup RPC**:
   ```bash
   # Update environment variable
   export SOROBAN_RPC_URL=https://backup-rpc-endpoint.com

   # Restart indexer
   docker-compose restart indexer
   kubectl set env deployment/indexer SOROBAN_RPC_URL=https://backup-rpc-endpoint.com -n indexer
   ```

2. **Configure multiple RPC endpoints** (requires code change):
   - Implement RPC failover logic
   - Round-robin between endpoints

### Complete System Failure

**Scenario**: All components down

**Recovery Steps**:

1. **Restore infrastructure**:
   ```bash
   # Start PostgreSQL
   docker-compose up -d postgres
   kubectl apply -f postgres-deployment.yaml

   # Wait for database
   until pg_isready -h localhost -p 5432; do sleep 1; done
   ```

2. **Restore database from backup**:
   ```bash
   psql $DATABASE_URL < indexer_backup_latest.sql
   ```

3. **Start monitoring**:
   ```bash
   docker-compose up -d prometheus grafana
   ```

4. **Start indexer**:
   ```bash
   docker-compose up -d indexer
   ```

5. **Verify health**:
   ```bash
   curl http://localhost:3001/api/health
   curl http://localhost:3001/api/sync-status
   ```

---

## Appendix

### Health Check Endpoints

- **`GET /api/health/live`**: Liveness probe (always returns 200)
- **`GET /api/health/ready`**: Readiness probe (checks DB connection)
- **`GET /api/health`**: Combined health check with sync status
- **`GET /api/sync-status`**: Detailed indexer status
- **`GET /api/metrics`**: Prometheus metrics

### Metrics Reference

| Metric | Type | Description |
|--------|------|-------------|
| `indexer_events_processed_total` | Counter | Total events processed |
| `indexer_errors_total` | Counter | Total errors encountered |
| `indexer_processing_latency_seconds` | Histogram | Processing cycle latency |
| `indexer_last_processed_ledger` | Gauge | Last processed ledger |
| `indexer_ledger_lag` | Gauge | Ledgers behind network |

### Log Levels

- **TRACE**: Detailed debugging (RPC requests, individual events)
- **DEBUG**: Development debugging (transactions, checkpoints)
- **INFO**: Normal operations (cycle completion, events indexed)
- **WARN**: Potential issues (retries, skipped events)
- **ERROR**: Failures (cycle errors, database errors)

### Support Contacts

- **On-call**: [Your on-call rotation]
- **Slack**: #indexer-alerts
- **Email**: ops@yourcompany.com
- **Runbook**: https://docs.yourcompany.com/indexer

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-04-28 | 1.0.0 | Initial runbook |

