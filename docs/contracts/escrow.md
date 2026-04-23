# Escrow Smart Contract

## Overview

The `escrow` contract manages milestone-based funding, SAC-compatible token custody, dispute handling, and refunds for Lance jobs.

All token movements are performed through Soroban's standard token interface (`soroban_sdk::token::Client`), which makes the contract compatible with Stellar Asset Contracts (SACs) used for assets like testnet USDC.

## `resolve_dispute`

### Purpose

Finalizes a disputed job by distributing the full remaining escrow balance between the freelancer and the client.

### Behavior

- Requires authentication from the configured `agent_judge`.
- Verifies the job exists and is currently in `Disputed`.
- Validates both payout amounts are non-negative.
- Requires `payee_amount + payer_amount` to equal the full unreleased escrow balance.
- Transfers the freelancer share and client refund using the configured token contract.
- Marks the job as `Resolved`.
- Emits `ResolveDispute` for off-chain indexing and debugging.

### Errors

- `NotInitialized` (2): agent judge has not been configured.
- `InvalidInput` (4): one or more payout amounts are invalid.
- `JobNotFound` (5): job does not exist.
- `InvalidState` (6): job is not in a disputed state.
- `AmountMismatch` (7): verdict does not allocate the full remaining escrow balance.

## `refund`

### Purpose

Returns the remaining escrowed balance to the job client when the refund path is allowed by the current job state.

### Behavior

- Requires authentication from the job client.
- Verifies the job exists and is still active (`Funded` or `WorkInProgress`).
- Returns only the unreleased remainder to the client.
- Marks the job as `Refunded`.
- Emits `Refund` for observability.

### Errors

- `Unauthorized` (3): caller is not the client.
- `JobNotFound` (5): job does not exist.
- `InvalidState` (6): job cannot be refunded from its current state.

## `get_job`

### Purpose

Retrieves the full on-chain escrow record for a job.

### Behavior

- Loads the job from persistent storage.
- Refreshes the job TTL so actively-read jobs stay alive.
- Returns the `EscrowJob` record.

### Errors

- `JobNotFound` (5): job does not exist.
