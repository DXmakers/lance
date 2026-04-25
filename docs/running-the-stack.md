# Running the Stack

This guide explains how to run the Lance platform locally, validate background workers, and check system health and sync status.

## What You Are Starting

- Frontend: Next.js app in `apps/web`
- Backend API: Axum service in `backend`
- Postgres: backing store for jobs, disputes, and indexer checkpoints
- Workers:
  - Judge worker for dispute automation
  - Soroban indexer worker for ledger event ingestion

## Prerequisites

- Node.js 20+
- Rust stable toolchain
- Docker (recommended for local Postgres)
- A funded Stellar Testnet account if testing real on-chain flows

## 1. Clone And Install

```bash
git clone https://github.com/DXmakers/lance.git
cd lance

cd apps/web
npm install
cd ../..

cargo build -p backend
```

## 2. Configure Environment

Create backend env file:

```bash
cp backend/.env.example backend/.env
```

Create web env file:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Important backend variables:

- `DATABASE_URL`: Postgres connection string
- `SOROBAN_RPC_URL` or `STELLAR_RPC_URL`: Soroban RPC endpoint
- `JUDGE_AUTHORITY_SECRET`: signing key used by backend judge/contract actions
- `ESCROW_CONTRACT_ID`, `JOB_REGISTRY_CONTRACT_ID`, `REPUTATION_CONTRACT_ID`: deployed contract IDs

## 3. Start Postgres

```bash
docker run --rm \
  --name lance-postgres \
  -p 5432:5432 \
  -e POSTGRES_USER=lance \
  -e POSTGRES_PASSWORD=lance \
  -e POSTGRES_DB=lance \
  postgres:16
```

## 4. Start Backend

In a second terminal:

```bash
cd backend
cargo run
```

On startup, backend will:

- apply SQL migrations
- start API server on `PORT` (default `3001`)
- spawn judge worker
- spawn Soroban indexer worker

## 5. Start Frontend

In a third terminal:

```bash
cd apps/web
npm run dev
```

Open `http://localhost:3000`.

## 6. Health, Readiness, Sync, And Metrics

All endpoints below are prefixed with `/api` because backend mounts router at `/api`.

- Liveness: `GET /api/health/live`
- Readiness: `GET /api/health/ready`
- Aggregate health: `GET /api/health`
- Indexer sync status: `GET /api/sync-status`
- Prometheus metrics: `GET /api/metrics`

Examples:

```bash
curl -s http://localhost:3001/api/health/live | jq
curl -s http://localhost:3001/api/health/ready | jq
curl -s http://localhost:3001/api/health | jq
curl -s http://localhost:3001/api/sync-status | jq
curl -s http://localhost:3001/api/metrics
```

`/api/sync-status` includes:

- latest processed ledger
- latest network ledger (when RPC is reachable)
- ledger lag
- configured max allowed lag (`INDEXER_MAX_LEDGER_LAG`, default `5`)
- RPC reachability details

## 7. Verifying Worker Recovery

To test indexer resilience:

1. Start backend normally.
2. Temporarily break RPC connectivity (for example, set an invalid `SOROBAN_RPC_URL`).
3. Confirm retries and backoff in backend logs.
4. Restore RPC URL.
5. Confirm worker resumes from checkpoint in `indexer_state` table.

Useful SQL:

```sql
SELECT id, last_processed_ledger, updated_at FROM indexer_state;
SELECT COUNT(*) FROM indexed_events;
```

## 8. Monitoring In Docker/Kubernetes

### Docker Compose Pattern

- `backend` service
- `postgres` service
- optional `prometheus` and `grafana` services scraping `/api/metrics`

### Kubernetes Runbook Notes

- Use readiness probe against `/api/health/ready`
- Use liveness probe against `/api/health/live`
- Scrape `/api/metrics` via Prometheus annotations or ServiceMonitor
- Keep only one indexer instance unless leader election is introduced
- Set resource requests/limits and watch:
  - event processing rate
  - error count
  - sync lag

## 9. Common Local Issues

- Sequence mismatch errors: wait briefly and retry transaction flow
- RPC unreachable: verify `SOROBAN_RPC_URL` and firewall rules
- DB connection errors: verify `DATABASE_URL` and that Postgres is running
- Frontend cannot call backend: check CORS and port alignment

## 10. Suggested Development Workflow

1. Run backend and frontend together.
2. Trigger a job flow from UI.
3. Watch toast progress and verify explorer links.
4. Check `/api/sync-status` and `/api/metrics` while processing events.
5. Run tests before opening PR:

```bash
cargo test -p backend
cd apps/web && npm test
```
