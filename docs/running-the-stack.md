# Running the Stack

This guide explains how to run the Lance platform locally, including the frontend, the new Node.js backend, and the backing databases.

## What You Are Starting

- **Frontend:** Next.js app in `apps/web` (runs on port 3000)
- **Backend API:** Express.js service in `backend` (runs on port 3001)
- **Postgres:** Backing store for jobs, users, bids, and disputes.
- **Redis:** In-memory store for future BullMQ background indexing jobs.

## Prerequisites

- Node.js 20+
- Docker (required for local Postgres & Redis)
- A funded Stellar Testnet account if testing real on-chain flows

## 1. Clone And Install

```bash
git clone https://github.com/DXmakers/lance.git
cd lance

# Install Frontend
cd apps/web
npm install
cd ../..

# Install Backend
cd backend
npm install
cd ..
```

## 2. Configure Environment

**Backend environment:**
```bash
cp backend/.env.example backend/.env
```
Important backend variables:
- `DATABASE_URL`: Postgres connection string (should point to local Docker instance for dev)
- `STELLAR_RPC_URL`: Soroban RPC endpoint
- `JUDGE_AUTHORITY_SECRET`: Signing key used by backend judge/contract actions
- `PORT`: API Port (default `3001`)

**Frontend environment:**
```bash
cp apps/web/.env.example apps/web/.env.local
```
Important frontend variables:
- `NEXT_PUBLIC_API_URL`: Points to the backend (default `http://localhost:3001`)

## 3. Start Local Databases (Postgres & Redis)

Use the provided Docker Compose file to start the required infrastructure in the background:

```bash
docker compose up -d
```
*Note: This starts PostgreSQL on port `5432` and Redis on port `6379`.*

## 4. Start the Backend API

In a second terminal, start the Express development server:

```bash
cd backend
npm run dev
```

On startup, `nodemon` will run the TypeScript backend and automatically restart when you save files. You should see:
`️[server]: Server is running at http://localhost:3001`

*(Note: The database schema must be initialized. If you haven't yet, run `npx prisma db push` inside the `backend` folder).*

## 5. Start the Frontend

In a third terminal, start the Next.js development server:

```bash
cd apps/web
npm run dev
```

Open `http://localhost:3000` in your browser.

## 6. Health and Readiness

To check if the backend is successfully connected to the database, ping the health endpoint:

```bash
curl -s http://localhost:3001/health
```

Expected output:
```json
{"status":"ok","db":"connected"}
```

## 7. Cloud Deployment

The backend is fully containerized and automated for deployment to **Google Cloud Run** and **Google Cloud SQL**.

To provision the cloud database and deploy the API:
```bash
cd backend
./setup-cloud-db.sh
./deploy-gcp.sh
```

## 8. Common Local Issues

- **Wallet Auth Errors ("Invalid Signature"):** Ensure you are using the correct active network in your Freighter wallet (Testnet). The backend verifies signatures by explicitly checking the exact message format.
- **RPC unreachable:** Verify `STELLAR_RPC_URL` is reachable or wait a few minutes if the public testnet is rate-limiting.
- **Prisma "Engine" Errors:** If you hit `PrismaClientConstructorValidationError`, ensure your Node version is 20+ and that you ran `npm install` inside the `backend` folder so it has the `@prisma/adapter-pg` dependencies.
- **Frontend cannot call backend:** Check `NEXT_PUBLIC_API_URL` and ensure the backend is actually running on port `3001`.

## 9. Suggested Development Workflow

1. Run the database via `docker compose`.
2. Run backend and frontend together using `npm run dev` in their respective folders.
3. Trigger a job flow from UI.
4. Watch the `nodemon` backend terminal for `console.log` output.
5. Run tests before opening PR:

```bash
cd backend && npm run build
cd apps/web && npm test
```