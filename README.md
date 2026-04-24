# Lance — Freelancer Platform with AI Agent Judge

> A Stellar-native freelance marketplace where AI agents resolve disputes, Soroban smart contracts handle escrow and reputation, and Stellar USDC powers payments.

---

## Architecture

```
lance/
├── apps/web/          ← Next.js 14 frontend (TypeScript, Tailwind, shadcn/ui)
├── backend/           ← Rust/Axum REST API + AI judge service
├── contracts/
│   ├── escrow/        ← Soroban escrow contract (deposit, release, dispute)
│   ├── reputation/    ← Soroban reputation contract (on-chain scores)
│   └── job_registry/  ← Soroban job registry (post, bid, deliverable)
├── tests/e2e/         ← Playwright end-to-end tests
├── docs/              ← Architecture docs, ISSUES.md
└── .github/workflows/ ← CI/CD pipelines
```

## Technology Stack

| Layer           | Technology                                                         |
| --------------- | ------------------------------------------------------------------ |
| Frontend        | Next.js 14, TypeScript, Tailwind CSS, shadcn/ui                    |
| Wallet          | Freighter via `@creit.tech/stellar-wallets-kit`                    |
| Smart Contracts | Rust / Soroban (Stellar)                                           |
| Escrow          | Soroban contract + Stellar native multisig                         |
| Reputation      | Custom Soroban contract (ERC-8004 inspired)                        |
| Payments        | Stellar USDC (Circle)                                              |
| Backend         | Rust / Axum                                                        |
| Database        | PostgreSQL (SQLx)                                                  |
| AI Judge        | OpenClaw agent                                                     |
| CI/CD           | GitHub Actions                                                     |
| Deploy          | Vercel (frontend) · Fly.io (backend) · Stellar Testnet (contracts) |

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- Rust (stable) + `wasm32-unknown-unknown` target
- `stellar` CLI
- Docker (for local Postgres)
- [Freighter wallet](https://www.freighter.app/) browser extension

### Install

```bash
# 1. Clone
git clone <repo-url> && cd lance

# 2. Frontend deps
cd apps/web && npm install && cd ../..

# 3. Backend deps (Rust — just check it compiles)
cargo build -p backend

# 4. Contracts
cargo build --target wasm32-unknown-unknown -p escrow
cargo build --target wasm32-unknown-unknown -p reputation
cargo build --target wasm32-unknown-unknown -p job_registry
```

### Environment

```bash
# apps/web
cp apps/web/.env.example apps/web/.env.local

# backend
cp backend/.env.example backend/.env
```

### Run Locally

```bash
# Terminal 1 — Postgres (Docker)
docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=lance postgres:16

# Terminal 2 — Backend
cd backend && cargo run

# Terminal 3 — Frontend
cd apps/web && npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Smart Contracts

```bash
# Run all contract tests
cargo test -p escrow -p reputation -p job_registry

# Deploy to Testnet (requires stellar CLI + funded account)
./.github/scripts/deploy-contracts.sh
```

---

## Testing

```bash
# Frontend unit tests
cd apps/web && npm test

# Backend
cargo test -p backend

# E2E (requires running frontend + backend)
cd tests/e2e && npx playwright test
```

---

## User guides

- [Connecting a Stellar wallet](./docs/user-guide/stellar-wallets.md) — supported wallets, signing flow, network setup, and troubleshooting.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

MIT
