# Backend: Multi-provider RPC Support - Production Runbook

## Overview

This runbook covers the deployment, operation, and scaling of the Stellar blockchain indexer worker. The worker continuously monitors the Stellar network, processes ledger events, and maintains the application's synchronized state with the blockchain.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Stellar        │     │  Backend API     │     │  PostgreSQL     │
│  Horizon RPC    │────▶│  Indexer Worker  │────▶│  (checkpoints,  │
│  (multi-provider)     │                  │     │   ledger events)│
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │
        │                        ▼
        │               ┌──────────────────┐
        │               │  Prometheus      │
        └──────────────▶│  Metrics        │
                        └──────────────────┘
```

## Components

### 1. RPC Client (`services/rpc.rs`)
- **MultiProviderRpc**: Rotates through multiple Stellar Horizon endpoints
- Features: Exponential backoff retry, rate limit handling, health checks
- Default providers:
  - `https://horizon-testnet.stellar.org` (primary)
  - `https://horizon-futurenet.stellar.org` (backup)

### 2. Indexer Worker (`worker/indexer.rs`)
- Processes ledgers sequentially from last checkpoint
- Idempotent: Uses ON CONFLICT DO NOTHING for duplicate prevention
- Polls every 5 seconds by default
- Batch processes up to 10 ledgers per cycle

### 3. Checkpoint System (`migrations/20260427000001_indexer_checkpoint.sql`)
- Tracks last processed ledger in `indexer_checkpoints` table
- Stores ledger events in `ledger_events` table
- Uses database functions for atomic updates

## Prerequisites

- PostgreSQL 14+ with UUID extension
- Rust 1.75+ with tokio
- Environment variables:
  - `DATABASE_URL` - PostgreSQL connection string
  - `HORIZON_URL` - Primary Stellar Horizon endpoint (default: https://horizon-testnet.stellar.org)
  - `STELLAR_NETWORK_PASSPHRASE` - Network identifier

## Docker Deployment

### Dockerfile

```dockerfile
FROM rust:1.75-bookworm as builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY backend/Cargo.toml ./backend/
COPY backend/src ./backend/src
COPY backend/migrations ./backend/migrations
RUN cargo build --release -p backend

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl-dev && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/backend /usr/local/bin/
COPY backend/.env.example /app/.env

WORKDIR /app
EXPOSE 3001
CMD ["backend"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  backend:
    build: .
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgres://user:pass@db:5432/lance
      - HORIZON_URL=https://horizon-testnet.stellar.org
    depends_on:
      - db
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G

  db:
    image: postgres:14-alpine
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=lance
    volumes:
      - pgdata:/var/lib/postgresql/data
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

volumes:
  pgdata:
```

## Kubernetes Deployment

### Deployment YAML

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend-indexer
  labels:
    app: backend
    component: indexer
spec:
  replicas: 1
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
      - name: backend
        image: your-registry/backend:latest
        ports:
        - containerPort: 3001
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: backend-secrets
              key: database-url
        - name: HORIZON_URL
          value: "https://horizon-testnet.stellar.org"
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "2"
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/health/sync
            port: 3001
          initialDelaySeconds: 10
          periodSeconds: 5
```

### Horizontal Pod Autoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: backend-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: backend-indexer
  minReplicas: 1
  maxReplicas: 3
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-svc
spec:
  selector:
    app: backend
  ports:
  - port: 3001
    targetPort: 3001
  type: ClusterIP
```

## Monitoring

### Prometheus Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `indexer_ledgers_processed_total` | Counter | Total ledgers processed |
| `indexer_transactions_processed_total` | Counter | Total transactions indexed |
| `indexer_last_ledger_height` | Gauge | Current synced ledger number |
| `indexer_lag_seconds` | Gauge | Seconds behind network |
| `indexer_processing_duration_seconds` | Histogram | Ledger processing time |
| `indexer_rpc_errors_total` | Counter | RPC failure count |
| `indexer_db_write_duration_seconds` | Histogram | Database write latency |

### Health Endpoints

- `/api/health` - Basic health check
- `/api/health/sync` - Indexer sync status with lag info

### Example Response

```json
{
  "status": "syncing",
  "last_ledger": 12345,
  "network_ledger": 12350,
  "lag": 5,
  "indexer_status": "syncing",
  "error_message": null
}
```

## Operations

### Manual Rescan

Trigger a rescan from a specific ledger:

```bash
curl "http://localhost:3001/api/indexer/rescan?from=100000"
```

### Check Sync Status

```bash
curl -s http://localhost:3001/api/health/sync | jq
```

### View Metrics

```bash
curl -s http://localhost:3001/metrics
```

## Scaling Guidelines

### Vertical Scaling
- Increase CPU/memory for higher throughput
- Recommended: 2 CPU cores, 1GB RAM minimum

### Horizontal Scaling
- Run only ONE indexer worker per database
- Multiple instances will cause duplicate processing
- Use leader election if multiple replicas needed

### Performance Tuning

```sql
-- Add index for efficient queries
CREATE INDEX idx_ledger_events_unprocessed 
ON ledger_events(ledger_seq) WHERE processed = false;

-- Monitor checkpoint lag
SELECT * FROM indexer_checkpoints;

-- Check event count
SELECT COUNT(*) FROM ledger_events 
WHERE processed = false;
```

## Troubleshooting

### High Lag

1. Check RPC provider status:
```bash
curl -s "https://horizon-testnet.stellar.org/health" | jq
```

2. Review logs:
```bash
kubectl logs -l app=backend --tail=100
```

3. Manual rescan:
```bash
curl "http://localhost:3001/api/indexer/rescan?from=$(date +%s)"
```

### RPC Connection Failures

1. Check provider health:
```bash
curl -s https://horizon-testnet.stellar.org/ledgers?limit=1 | jq
```

2. Verify network connectivity:
```bash
kubectl exec -it <pod> -- curl -I https://horizon-testnet.stellar.org
```

### Database Issues

1. Check checkpoint table:
```sql
SELECT * FROM indexer_checkpoints;
```

2. Review recent events:
```sql
SELECT * FROM ledger_events 
ORDER BY created_at DESC 
LIMIT 10;
```

## Alerting

### Prometheus Alert Rules

```yaml
groups:
- name: indexer
  rules:
  - alert: IndexerHighLag
    expr: indexer_lag_seconds > 60
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "Indexer is 60+ seconds behind network"
      
  - alert: IndexerNotSynced
    expr: indexer_lag_seconds > 300
    for: 2m
    labels:
      severity: critical
    annotations:
      summary: "Indexer has fallen more than 5 minutes behind"

  - alert: IndexerHighErrorRate
    expr: rate(indexer_rpc_errors_total[5m]) > 1
    for: 2m
    labels:
      severity: warning
    annotations:
      summary: "High RPC error rate detected"
```

## Backup & Recovery

### Checkpoint Backup

```bash
pg_dump -t indexer_checkpoints -t ledger_events lance > backup.sql
```

### Recovery Procedure

1. Stop all indexer workers
2. Restore checkpoint:
```sql
UPDATE indexer_checkpoints 
SET last_ledger = <last_known_good_ledger> 
WHERE id = 'main';
```
3. Clear potentially corrupt events:
```sql
DELETE FROM ledger_events 
WHERE ledger_seq >= <last_known_good_ledger>;
```
4. Restart worker - it will reprocess from checkpoint

## Log Levels

| Level | Use |
|-------|-----|
| ERROR | Failures requiring attention |
| WARN | Recoverable issues (retries) |
| INFO | Normal operations |
| DEBUG | Detailed debugging |

Set via `RUST_LOG`: `RUST_LOG=backend=debug,indexer=info`
