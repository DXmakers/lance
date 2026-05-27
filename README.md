#  Lance — Freelancer Platform with AI Agent Judge

> **A next-generation freelancer marketplace built on the Stellar network.** Lance leverages Soroban smart contracts for secure escrow, Stellar USDC for borderless payments, and integrates advanced AI agents as impartial judges for automated, fair dispute resolution.

---

##  Overview for Users

Lance reimagines the freelance economy by introducing an **AI Agent Judge** for dispute resolution. Traditional platforms rely on expensive and slow human arbitration when clients and freelancers disagree on the quality of deliverables. Lance solves this by using AI agents (powered by OpenClaw) to impartially review work against original job requirements and make binding decisions.

The platform is underpinned by **Soroban escrow smart contracts**. Clients deposit funds upfront, and the smart contract automatically releases payments based on milestone completion or the verdict of the AI judge if a dispute arises. This ensures trustless, cheap, and fair treatment for all parties.

##  Key Features

- ** Soroban Escrow Smart Contracts**: Job postings hold funds securely on-chain. Payments are guaranteed for completed work, eliminating non-payment risks.
- ** AI Agent Judge**: Impartial dispute resolution powered by OpenClaw. The agent analyzes submissions, reasons about requirements, and provides clear, reasoned verdicts to resolve disagreements.
- ** Milestone-based Payments**: Automatic, trustless payment releases upon approval of project milestones using Stellar USDC.
- ** On-chain Reputation Tracking**: A robust Soroban-based reputation system mapping identity and work history.
- ** Evidence Submission & Appeal Process**: Built-in mechanisms for submitting proof of work and handling large complex disputes securely.

---

##  Architecture for Developers

Lance is a full-stack decentralized application consisting of a Next.js frontend, a Node.js/Express backend (TypeScript), and Soroban smart contracts orchestrating the on-chain logic.

```text
lance/
├── apps/web/          ← Next.js 14 frontend (TypeScript, Tailwind, shadcn/ui)
├── backend/           ← Node.js/Express REST API (TypeScript, Prisma, BullMQ)
├── contracts/
│   ├── escrow/        ← Soroban escrow contract (deposit, release, dispute handling)
│   ├── reputation/    ← Soroban reputation contract (on-chain scores & history)
│   └── job_registry/  ← Soroban job registry (job posting, bidding, deliverables)
├── tests/e2e/         ← Playwright end-to-end tests
├── docs/              ← Architecture docs
└── .github/workflows/ ← CI/CD pipelines
```

##  Technology Stack

| Layer          | Technology                                                         |
| -------------- | ------------------------------------------------------------------ |
| **Frontend**   | Next.js 14, TypeScript, Tailwind CSS, shadcn/ui                    |
| **Wallet**     | Freighter via `@creit.tech/stellar-wallets-kit`                    |
| **Contracts**  | Rust / Soroban (Stellar Smart Contracts)                           |
| **Escrow**     | Soroban contract integrated with Stellar native multisig           |
| **Reputation** | Custom Soroban contract for decentralized identity & scoring       |
| **Payments**   | Stellar USDC (Circle) for fast, low-cost settlement                |
| **Backend**    | Node.js / Express.js (TypeScript)                                  |
| **Database**   | PostgreSQL (Prisma ORM)                                            |
| **Background** | BullMQ (Redis-based job queue) for ledger indexing                 |
| **AI Judge**   | OpenClaw agent for reasoning & verdict generation                  |
| **Deploy**     | Vercel (Frontend) · Google Cloud Run & Cloud SQL (Backend)         |

---

##  Quick Start

### Prerequisites

- Node.js ≥ 20
- Rust (stable) + `wasm32-unknown-unknown` target (for smart contracts)
- `stellar` CLI
- Docker (for local Postgres & Redis databases)
- [Freighter wallet](https://www.freighter.app/) browser extension

### Install

```bash
# 1. Clone the repository
git clone <repo-url> && cd lance

# 2. Install frontend dependencies
cd apps/web && npm install && cd ../..

# 3. Install backend dependencies
cd backend && npm install && cd ..

# 4. Build Soroban contracts
cargo build --target wasm32-unknown-unknown -p escrow
cargo build --target wasm32-unknown-unknown -p reputation
cargo build --target wasm32-unknown-unknown -p job_registry
```

### Environment Setup

```bash
# Setup web frontend environment
cp apps/web/.env.example apps/web/.env.local

# Setup backend environment
cp backend/.env.example backend/.env
```

### Run Locally

```bash
# Terminal 1 — Start Postgres & Redis via Docker Compose
docker compose up -d

# Terminal 2 — Run the Backend API (runs on port 3001)
cd backend && npm run dev

# Terminal 3 — Run the Next.js Frontend (runs on port 3000)
cd apps/web && npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to start exploring Lance.

---

##  Cloud Deployment

The backend is fully containerized and automated for deployment to **Google Cloud Run** and **Google Cloud SQL**.

To provision the cloud database and deploy the API:
```bash
cd backend
./setup-cloud-db.sh
./deploy-gcp.sh
```

---

##  Smart Contracts

Lance operates heavily on-chain to guarantee trustlessness. Our Soroban contracts handle job registries, escrows, and reputation scoring.

```bash
# Run all Soroban contract tests
cargo test -p escrow -p reputation -p job_registry

# Deploy contracts to Stellar Testnet (requires stellar CLI + funded account)
./.github/scripts/deploy-contracts.sh
```

---

##  Testing

```bash
# Frontend unit tests
cd apps/web && npm test

# Backend build check
cd backend && npm run build

# E2E test suite (requires running frontend + backend)
cd tests/e2e && npx playwright test
```

---

##  Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for details on how to get started.

---

##  License

MIT License
