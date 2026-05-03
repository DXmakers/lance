# Production Deployment & Scaling Runbook

## Table of Contents

1. [Overview](#overview)
2. [Pre-Deployment Checklist](#pre-deployment-checklist)
3. [Docker Deployment](#docker-deployment)
4. [Kubernetes Deployment](#kubernetes-deployment)
5. [Scaling Strategies](#scaling-strategies)
6. [Monitoring & Alerting](#monitoring--alerting)
7. [Troubleshooting](#troubleshooting)
8. [Disaster Recovery](#disaster-recovery)
9. [Performance Tuning](#performance-tuning)

## Overview

This runbook provides comprehensive guidance for deploying and scaling the Soroban ledger indexer worker in production environments using Docker and Kubernetes. The worker is designed to process Stellar ledger events with high throughput, low latency, and automatic recovery from failures.

### Architecture

- **Worker Type**: Async Rust application using Tokio
- **Database**: PostgreSQL 15+
- **RPC Provider**: Soroban RPC (Stellar testnet/mainnet)
- **Monitoring**: Prometheus metrics + structured logging
- **Orchestration**: Docker Compose (dev) / Kubernetes (prod)

### Key Characteristics

- **Processing Target**: 5 seconds per ledger
- **Idempotent Processing**: Safe to reprocess ledgers
- **Checkpoint-Based Recovery**: Resumes from last known state
- **Circuit Breaker**: Handles RPC provider failures gracefully
- **Exponential Backoff**: Intelligent retry logic with jitter

## Pre-Deployment Checklist

### Infrastructure Requirements

- [ ] PostgreSQL 15+ instance (managed or self-hosted)
- [ ] Kubernetes cluster (1.24+) or Docker Swarm
- [ ] Persistent storage for database backups
- [ ] Prometheus + Grafana for monitoring
- [ ] Container registry (Docker Hub, ECR, GCR, etc.)
- [ ] Load balancer for API endpoints
- [ ] VPC/Network isolation configured

### Configuration Validation

- [ ] `DATABASE_URL` environment variable set correctly
- [ ] `SOROBAN_RPC_URL` pointing to correct network (testnet/mainnet)
- [ ] RPC rate limits configured appropriately
- [ ] Circuit breaker thresholds tuned for your RPC provider
- [ ] Retry policies configured for expected failure patterns
- [ ] Logging level set appropriately (debug/info/warn)
- [ ] Metrics endpoint accessible for Prometheus scraping

### Database Preparation

```bash
# Create database
createdb soroban_indexer

# Run migrations
sqlx migrate run --database-url postgresql://user:pass@host/soroban_indexer

# Verify schema
psql -d soroban_indexer -c "\dt"
```

### Security Checklist

- [ ] Database credentials stored in secrets manager (not in code)
- [ ] RPC API keys rotated and secured
- [ ] Network policies restrict access to database
- [ ] TLS/SSL enabled for all external connections
- [ ] Container images scanned for vulnerabilities
- [ ] RBAC configured in Kubernetes
- [ ] Audit logging enabled for sensitive operations

## Docker Deployment

### Building the Image

```bash
# Build production image
docker build -f backend/Dockerfile -t soroban-indexer:latest .

# Tag for registry
docker tag soroban-indexer:latest myregistry.azurecr.io/soroban-indexer:v1.0.0

# Push to registry
docker push myregistry.azurecr.io/soroban-indexer:v1.0.0
```

### Docker Compose (Development/Staging)

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: soroban_indexer
      POSTGRES_USER: indexer
      POSTGRES_PASSWORD: ${DB_PASSWORD}
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
    build:
      context: .
      dockerfile: backend/Dockerfile
    environment:
      DATABASE_URL: postgresql://indexer:${DB_PASSWORD}@postgres:5432/soroban_indexer
      SOROBAN_RPC_URL: https://soroban-testnet.stellar.org
      RUST_LOG: backend=info,tower_http=debug
      PORT: 3001
    ports:
      - "3001:3001"
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

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

volumes:
  postgres_data:
  prometheus_data:
```

### Running with Docker Compose

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f indexer

# Stop services
docker-compose down

# Clean up volumes
docker-compose down -v
```

## Kubernetes Deployment

### Prerequisites

```bash
# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"

# Install Helm (optional but recommended)
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

### Namespace Setup

```bash
# Create namespace
kubectl create namespace soroban-indexer

# Set default namespace
kubectl config set-context --current --namespace=soroban-indexer
```

### Secrets Management

```bash
# Create database secret
kubectl create secret generic db-credentials \
  --from-literal=username=indexer \
  --from-literal=password=$(openssl rand -base64 32) \
  -n soroban-indexer

# Create RPC API key secret (if needed)
kubectl create secret generic rpc-credentials \
  --from-literal=api-key=your-api-key \
  -n soroban-indexer

# Verify secrets
kubectl get secrets -n soroban-indexer
```

### ConfigMap for Configuration

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: indexer-config
  namespace: soroban-indexer
data:
  SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org"
  RUST_LOG: "backend=info,tower_http=debug"
  INDEXER_RPC_RATE_LIMIT_MS: "100"
  INDEXER_RPC_RETRY_MAX_ATTEMPTS: "5"
  INDEXER_CIRCUIT_BREAKER_ENABLED: "true"
  INDEXER_CIRCUIT_BREAKER_THRESHOLD: "5"
```

### PostgreSQL StatefulSet

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: soroban-indexer
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:15-alpine
        ports:
        - containerPort: 5432
        env:
        - name: POSTGRES_DB
          value: soroban_indexer
        - name: POSTGRES_USER
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: username
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: password
        volumeMounts:
        - name: postgres-storage
          mountPath: /var/lib/postgresql/data
        livenessProbe:
          exec:
            command:
            - /bin/sh
            - -c
            - pg_isready -U indexer
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          exec:
            command:
            - /bin/sh
            - -c
            - pg_isready -U indexer
          initialDelaySeconds: 5
          periodSeconds: 5
  volumeClaimTemplates:
  - metadata:
      name: postgres-storage
    spec:
      accessModes: [ "ReadWriteOnce" ]
      resources:
        requests:
          storage: 100Gi
```

### Indexer Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: soroban-indexer
  namespace: soroban-indexer
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: soroban-indexer
  template:
    metadata:
      labels:
        app: soroban-indexer
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "3001"
        prometheus.io/path: "/api/health/metrics"
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - soroban-indexer
              topologyKey: kubernetes.io/hostname
      containers:
      - name: indexer
        image: myregistry.azurecr.io/soroban-indexer:v1.0.0
        imagePullPolicy: IfNotPresent
        ports:
        - name: http
          containerPort: 3001
        env:
        - name: DATABASE_URL
          value: "postgresql://$(DB_USER):$(DB_PASSWORD)@postgres:5432/soroban_indexer"
        - name: DB_USER
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: username
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: password
        envFrom:
        - configMapRef:
            name: indexer-config
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 2000m
            memory: 2Gi
        livenessProbe:
          httpGet:
            path: /api/health
            port: http
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /api/health/indexer
            port: http
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 2
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 15"]
```

### Service Definition

```yaml
apiVersion: v1
kind: Service
metadata:
  name: soroban-indexer
  namespace: soroban-indexer
spec:
  type: ClusterIP
  selector:
    app: soroban-indexer
  ports:
  - name: http
    port: 80
    targetPort: 3001
  - name: metrics
    port: 9090
    targetPort: 3001
```

### Deploying to Kubernetes

```bash
# Apply configurations
kubectl apply -f configmap.yaml
kubectl apply -f postgres-statefulset.yaml
kubectl apply -f indexer-deployment.yaml
kubectl apply -f service.yaml

# Verify deployment
kubectl get pods -n soroban-indexer
kubectl get svc -n soroban-indexer

# Check logs
kubectl logs -f deployment/soroban-indexer -n soroban-indexer

# Port forward for local testing
kubectl port-forward svc/soroban-indexer 3001:80 -n soroban-indexer
```

## Scaling Strategies

### Horizontal Scaling

The indexer is designed to run multiple instances with a shared database checkpoint. Each instance processes independently and updates the checkpoint atomically.

#### Scaling Up

```bash
# Scale to 5 replicas
kubectl scale deployment soroban-indexer --replicas=5 -n soroban-indexer

# Verify scaling
kubectl get pods -n soroban-indexer
```

#### Scaling Down

```bash
# Scale to 2 replicas
kubectl scale deployment soroban-indexer --replicas=2 -n soroban-indexer

# Graceful shutdown (15s preStop delay allows in-flight requests)
kubectl delete pod <pod-name> -n soroban-indexer
```

### Vertical Scaling

Adjust resource requests/limits based on monitoring data:

```yaml
resources:
  requests:
    cpu: 1000m      # Increase from 500m
    memory: 1Gi     # Increase from 512Mi
  limits:
    cpu: 4000m      # Increase from 2000m
    memory: 4Gi     # Increase from 2Gi
```

### Auto-Scaling with HPA

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: soroban-indexer-hpa
  namespace: soroban-indexer
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: soroban-indexer
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
      - type: Percent
        value: 100
        periodSeconds: 30
```

### Database Scaling

#### Connection Pooling

Configure PgBouncer for connection pooling:

```ini
[databases]
soroban_indexer = host=postgres port=5432 dbname=soroban_indexer

[pgbouncer]
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 25
min_pool_size = 10
reserve_pool_size = 5
reserve_pool_timeout = 3
```

#### Read Replicas

For high-volume read scenarios, configure PostgreSQL streaming replication:

```bash
# On primary
ALTER SYSTEM SET wal_level = replica;
ALTER SYSTEM SET max_wal_senders = 10;
ALTER SYSTEM SET wal_keep_size = '1GB';

# Restart primary
systemctl restart postgresql

# On replica
pg_basebackup -h primary-host -D /var/lib/postgresql/data -U replication -v -P -W
```

## Monitoring & Alerting

### Prometheus Configuration

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'soroban-indexer'
    kubernetes_sd_configs:
      - role: pod
        namespaces:
          names:
            - soroban-indexer
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
        action: replace
        target_label: __metrics_path__
        regex: (.+)
      - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        regex: ([^:]+)(?::\d+)?;(\d+)
        replacement: $1:$2
        target_label: __address__
```

### Alert Rules

```yaml
groups:
  - name: soroban-indexer
    interval: 30s
    rules:
      - alert: IndexerLagging
        expr: indexer_ledger_lag > 100
        for: 5m
        annotations:
          summary: "Indexer lagging behind network"
          description: "Indexer is {{ $value }} ledgers behind"

      - alert: HighErrorRate
        expr: rate(indexer_total_errors[5m]) > 10
        for: 5m
        annotations:
          summary: "High error rate detected"
          description: "Error rate: {{ $value }} errors/sec"

      - alert: RpcFailures
        expr: rate(indexer_rpc_errors[5m]) > 5
        for: 5m
        annotations:
          summary: "RPC provider issues"
          description: "RPC errors: {{ $value }} errors/sec"

      - alert: SlowProcessing
        expr: indexer_last_loop_duration_ms > 5000
        for: 2m
        annotations:
          summary: "Processing slower than target"
          description: "Loop duration: {{ $value }}ms (target: 5000ms)"
```

### Grafana Dashboard

Key panels to include:

1. **Sync Status**: `indexer_ledger_lag` gauge
2. **Throughput**: `rate(indexer_total_events_processed[5m])`
3. **Error Rate**: `rate(indexer_total_errors[5m])`
4. **Latency**: `indexer_last_loop_duration_ms`
5. **Recovery Rate**: `rate(indexer_successful_recoveries[5m])`
6. **RPC Health**: `rate(indexer_rpc_errors[5m])`

## Troubleshooting

### Common Issues

#### 1. Indexer Stuck/Not Processing

**Symptoms**: Ledger lag increasing, no new events processed

**Diagnosis**:
```bash
# Check pod status
kubectl describe pod <pod-name> -n soroban-indexer

# Check logs for errors
kubectl logs <pod-name> -n soroban-indexer | grep -i error

# Check database connectivity
kubectl exec -it <pod-name> -n soroban-indexer -- \
  psql $DATABASE_URL -c "SELECT last_processed_ledger FROM indexer_state;"
```

**Solutions**:
- Restart the pod: `kubectl delete pod <pod-name> -n soroban-indexer`
- Check RPC provider status
- Verify database connectivity and performance
- Review circuit breaker state in logs

#### 2. High Memory Usage

**Symptoms**: Pod OOMKilled, memory usage > 90%

**Diagnosis**:
```bash
# Check memory usage
kubectl top pod <pod-name> -n soroban-indexer

# Check for memory leaks in logs
kubectl logs <pod-name> -n soroban-indexer | grep -i memory
```

**Solutions**:
- Increase memory limits in deployment
- Reduce batch size if configurable
- Check for connection pool leaks
- Review event processing logic for memory issues

#### 3. Database Connection Errors

**Symptoms**: "too many connections" errors, connection timeouts

**Diagnosis**:
```bash
# Check active connections
psql -d soroban_indexer -c "SELECT count(*) FROM pg_stat_activity;"

# Check connection limits
psql -d soroban_indexer -c "SHOW max_connections;"
```

**Solutions**:
- Increase `max_connections` in PostgreSQL
- Implement connection pooling (PgBouncer)
- Reduce number of replicas temporarily
- Check for connection leaks in application

#### 4. RPC Rate Limiting

**Symptoms**: Frequent 429 errors, increasing retry count

**Diagnosis**:
```bash
# Check RPC error metrics
kubectl exec -it <pod-name> -n soroban-indexer -- \
  curl http://localhost:3001/api/health/metrics | grep rpc_errors
```

**Solutions**:
- Increase `INDEXER_RPC_RATE_LIMIT_MS`
- Reduce number of replicas
- Contact RPC provider for higher rate limits
- Implement request batching if supported

## Disaster Recovery

### Backup Strategy

#### Database Backups

```bash
# Full backup
pg_dump -h postgres-host -U indexer soroban_indexer > backup.sql

# Compressed backup
pg_dump -h postgres-host -U indexer -Fc soroban_indexer > backup.dump

# Automated daily backups (cron)
0 2 * * * pg_dump -h postgres-host -U indexer -Fc soroban_indexer > /backups/soroban_$(date +\%Y\%m\%d).dump
```

#### Kubernetes Backup

```bash
# Backup all resources
kubectl get all -n soroban-indexer -o yaml > soroban-backup.yaml

# Backup secrets (encrypted)
kubectl get secrets -n soroban-indexer -o yaml | \
  gpg --encrypt --recipient your-key-id > secrets-backup.yaml.gpg
```

### Recovery Procedures

#### Database Recovery

```bash
# Restore from SQL dump
psql -h postgres-host -U indexer soroban_indexer < backup.sql

# Restore from compressed dump
pg_restore -h postgres-host -U indexer -d soroban_indexer backup.dump

# Verify recovery
psql -h postgres-host -U indexer -d soroban_indexer -c \
  "SELECT COUNT(*) FROM indexed_events;"
```

#### Checkpoint Reset (Last Resort)

If the checkpoint is corrupted:

```bash
# Reset checkpoint to specific ledger
kubectl exec -it postgres-0 -n soroban-indexer -- \
  psql -U indexer soroban_indexer -c \
  "UPDATE indexer_state SET last_processed_ledger = 12345 WHERE id = 1;"

# Restart indexer pods
kubectl rollout restart deployment/soroban-indexer -n soroban-indexer
```

## Performance Tuning

### RPC Configuration

```bash
# Optimize for throughput
INDEXER_RPC_RATE_LIMIT_MS=50          # Reduce rate limiting
INDEXER_RPC_RETRY_MAX_ATTEMPTS=3      # Fewer retries
INDEXER_RPC_TIMEOUT_MS=5000           # Shorter timeout

# Optimize for reliability
INDEXER_RPC_RATE_LIMIT_MS=200         # More conservative
INDEXER_RPC_RETRY_MAX_ATTEMPTS=7      # More retries
INDEXER_RPC_TIMEOUT_MS=15000          # Longer timeout
```

### Database Tuning

```sql
-- Increase shared buffers (25% of system RAM)
ALTER SYSTEM SET shared_buffers = '8GB';

-- Increase work memory
ALTER SYSTEM SET work_mem = '256MB';

-- Increase maintenance work memory
ALTER SYSTEM SET maintenance_work_mem = '2GB';

-- Enable parallel queries
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;
ALTER SYSTEM SET max_parallel_workers = 8;

-- Optimize for SSD
ALTER SYSTEM SET random_page_cost = 1.1;

-- Restart PostgreSQL
systemctl restart postgresql
```

### Index Optimization

```sql
-- Create indexes for common queries
CREATE INDEX idx_indexed_events_ledger ON indexed_events(ledger_amount);
CREATE INDEX idx_indexed_events_contract ON indexed_events(contract_id);
CREATE INDEX idx_indexed_events_topic ON indexed_events(topic_hash);

-- Analyze query performance
EXPLAIN ANALYZE SELECT * FROM indexed_events WHERE ledger_amount > 12345;

-- Vacuum and analyze
VACUUM ANALYZE indexed_events;
```

### Kubernetes Resource Optimization

```yaml
# Use resource quotas to prevent resource starvation
apiVersion: v1
kind: ResourceQuota
metadata:
  name: soroban-quota
  namespace: soroban-indexer
spec:
  hard:
    requests.cpu: "10"
    requests.memory: "20Gi"
    limits.cpu: "20"
    limits.memory: "40Gi"
    pods: "20"
```

## Maintenance

### Regular Tasks

- **Daily**: Monitor error rates and lag
- **Weekly**: Review performance metrics and logs
- **Monthly**: Update dependencies and security patches
- **Quarterly**: Capacity planning and scaling review

### Update Procedure

```bash
# Build new image
docker build -f backend/Dockerfile -t soroban-indexer:v1.1.0 .

# Push to registry
docker push myregistry.azurecr.io/soroban-indexer:v1.1.0

# Update deployment
kubectl set image deployment/soroban-indexer \
  soroban-indexer=myregistry.azurecr.io/soroban-indexer:v1.1.0 \
  -n soroban-indexer

# Monitor rollout
kubectl rollout status deployment/soroban-indexer -n soroban-indexer

# Rollback if needed
kubectl rollout undo deployment/soroban-indexer -n soroban-indexer
```

## Support & Escalation

### Escalation Path

1. **Level 1**: Check logs and metrics
2. **Level 2**: Review RPC provider status
3. **Level 3**: Database performance analysis
4. **Level 4**: Infrastructure team involvement

### Contact Information

- **On-Call**: Check PagerDuty schedule
- **Slack**: #soroban-indexer-alerts
- **Email**: indexer-team@company.com
- **Docs**: https://docs.company.com/soroban-indexer

## Appendix

### Useful Commands

```bash
# Get all resources
kubectl get all -n soroban-indexer

# Describe deployment
kubectl describe deployment soroban-indexer -n soroban-indexer

# Stream logs
kubectl logs -f deployment/soroban-indexer -n soroban-indexer

# Execute command in pod
kubectl exec -it <pod-name> -n soroban-indexer -- /bin/bash

# Port forward
kubectl port-forward svc/soroban-indexer 3001:80 -n soroban-indexer

# Get metrics
kubectl top nodes
kubectl top pods -n soroban-indexer

# Check events
kubectl get events -n soroban-indexer --sort-by='.lastTimestamp'
```

### Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | - | PostgreSQL connection string |
| `SOROBAN_RPC_URL` | https://soroban-testnet.stellar.org | RPC endpoint |
| `RUST_LOG` | info | Logging level |
| `PORT` | 3001 | HTTP server port |
| `INDEXER_RPC_RATE_LIMIT_MS` | 100 | Rate limit interval |
| `INDEXER_RPC_RETRY_MAX_ATTEMPTS` | 5 | Max retry attempts |
| `INDEXER_CIRCUIT_BREAKER_ENABLED` | true | Enable circuit breaker |
| `INDEXER_CIRCUIT_BREAKER_THRESHOLD` | 5 | Failure threshold |

---

**Last Updated**: April 28, 2026
**Version**: 1.0.0
**Maintainer**: Infrastructure Team
