# Runbook: Soroban Indexer Worker

## Overview
The indexer worker keeps Lance synchronized with Stellar/Soroban data by:
- polling the configured RPC endpoint on Tokio tasks
- checkpointing the last fully processed ledger in Postgres
- re-processing safely with idempotent `ON CONFLICT DO NOTHING` writes
- exposing sync, latency, retry, and throughput metrics for monitoring

The worker is restart-safe. A crash or pod reschedule resumes from `indexer_state.last_processed_ledger`.

## Runtime Controls
Configure these environment variables in the worker container or pod:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | required | PostgreSQL connection string |
| `SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `INDEXER_MAX_LEDGER_LAG` | `5` | Max lag before `/api/health` and `/api/sync-status` report degraded |
| `INDEXER_IDLE_POLL_MS` | `2000` | Sleep interval when the worker is caught up |
| `INDEXER_RPC_RATE_LIMIT_MS` | `250` | Minimum spacing between outbound RPC calls |
| `INDEXER_RPC_RETRY_MAX_ATTEMPTS` | `4` | Max retries for transient RPC failures / provider rate limits |
| `INDEXER_RPC_RETRY_INITIAL_BACKOFF_MS` | `500` | Initial exponential backoff delay for RPC retries |
| `INDEXER_RPC_RETRY_MAX_BACKOFF_MS` | `5000` | Maximum RPC retry backoff |
| `INDEXER_WORKER_RETRY_MAX_ATTEMPTS` | `4` | Max retries for full worker-loop failures |
| `INDEXER_WORKER_RETRY_INITIAL_BACKOFF_MS` | `1000` | Initial backoff for worker-loop failures |
| `INDEXER_WORKER_RETRY_MAX_BACKOFF_MS` | `60000` | Maximum worker-loop backoff |
| `RUST_LOG` | `backend=debug,tower_http=debug` | Structured tracing filter |

## Health and Monitoring
Available endpoints:
- `GET /api/health/live`: process liveness only
- `GET /api/health/ready`: DB connectivity
- `GET /api/health`: DB status plus nested indexer sync state
- `GET /api/sync-status`: checkpoint, lag, retry count, throughput, and RPC reachability
- `GET /api/metrics`: Prometheus metrics

Prometheus metrics exported by the worker:
- `indexer_last_processed_ledger`
- `indexer_latest_network_ledger`
- `indexer_ledger_lag`
- `indexer_total_events_processed`
- `indexer_last_batch_events_processed`
- `indexer_last_batch_rate_per_second`
- `indexer_total_errors`
- `indexer_rpc_retries_total`
- `indexer_last_loop_duration_ms`
- `indexer_last_rpc_latency_ms`

Recommended alerts:
- `indexer_ledger_lag > INDEXER_MAX_LEDGER_LAG` for 2-5 minutes
- sustained growth in `indexer_rpc_retries_total`
- `indexer_last_rpc_latency_ms` above provider SLO
- repeated non-zero `indexer_total_errors`

The dashboard routes already wired for operators are:
- `/admin/monitoring`
- `/admin/monitoring/deposit-indexing`

## Docker
Example service definition:

```yaml
services:
  backend:
    image: ghcr.io/dxmakers/lance-backend:latest
    command: ["./backend"]
    environment:
      DATABASE_URL: postgresql://lance:lance@postgres:5432/lance
      SOROBAN_RPC_URL: https://soroban-testnet.stellar.org
      INDEXER_MAX_LEDGER_LAG: "5"
      INDEXER_IDLE_POLL_MS: "2000"
      INDEXER_RPC_RATE_LIMIT_MS: "250"
      INDEXER_RPC_RETRY_MAX_ATTEMPTS: "4"
      INDEXER_RPC_RETRY_INITIAL_BACKOFF_MS: "500"
      INDEXER_RPC_RETRY_MAX_BACKOFF_MS: "5000"
      RUST_LOG: info,backend::indexer=debug
    restart: unless-stopped
    ports:
      - "3001:3001"
```

Operational notes:
- keep Postgres and the worker in the same private network
- use provider-specific rate limits to tune `INDEXER_RPC_RATE_LIMIT_MS`
- prefer a dedicated RPC endpoint for production traffic

## Kubernetes
Recommended deployment shape:
- API + worker in the same binary is acceptable for small clusters
- for higher isolation, run a dedicated worker deployment using the same image and command
- keep worker replicas at `1` unless you intentionally want active/active idempotent re-processing

Example deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lance-indexer
spec:
  replicas: 1
  selector:
    matchLabels:
      app: lance-indexer
  template:
    metadata:
      labels:
        app: lance-indexer
    spec:
      containers:
        - name: backend
          image: ghcr.io/dxmakers/lance-backend:latest
          command: ["./backend"]
          envFrom:
            - secretRef:
                name: lance-backend-env
          ports:
            - containerPort: 3001
          readinessProbe:
            httpGet:
              path: /api/health/ready
              port: 3001
          livenessProbe:
            httpGet:
              path: /api/health/live
              port: 3001
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: "1"
              memory: 1Gi
```

Scaling guidance:
- vertical scale first if the worker lags because of DB or decode pressure
- horizontal scale the API separately from the worker
- if you run more than one worker, expect duplicate reads but not duplicate writes because inserts are idempotent

## Recovery Procedures
### RPC instability or provider throttling
Symptoms:
- rising `indexer_rpc_retries_total`
- frequent rate-limit warnings in tracing logs
- growing `indexer_ledger_lag`

Actions:
1. confirm the provider status page / quota
2. increase `INDEXER_RPC_RATE_LIMIT_MS` if you are too aggressive
3. increase `INDEXER_RPC_RETRY_MAX_ATTEMPTS` or backoff ceilings if the provider is flaky but healthy
4. fail over to a secondary RPC endpoint if available

### Manual re-scan
To replay from a known ledger:

```sql
UPDATE indexer_state
SET last_processed_ledger = 45000, updated_at = NOW()
WHERE id = 1;
```

Restart the worker or wait for the next loop. Because event writes are idempotent, replaying already-seen ledgers is safe.

### Worker restart
Typical reasons:
- deploy a new image
- force a fresh RPC connection
- rotate credentials / endpoint config

Kubernetes:
```bash
kubectl rollout restart deployment/lance-indexer
```

Docker:
```bash
docker restart lance-backend
```

## Verification Checklist
After deploy:
1. `GET /api/health/ready` returns `200`
2. `GET /api/sync-status` shows `in_sync: true`
3. `indexer_latest_network_ledger - indexer_last_processed_ledger <= INDEXER_MAX_LEDGER_LAG`
4. `indexer_rpc_retries_total` is stable or low
5. new ledgers appear in the monitoring dashboard within a few seconds
