# Escrow Smart Contract

## Overview

The `Escrow` contract manages milestone funding, release, refund, and dispute flows for Lance jobs.

## `DepositEvent`

### Purpose

`DepositEvent` is emitted by `deposit` after the client funds an escrow job and the job transitions to `Funded`. It gives backend indexers and clients a durable audit signal for funded jobs.

### Topic

- `("escrow", "DepositEvent")`

### Payload

- `job_id`: Unique job identifier.
- `deposited_by`: Client address that authorized and funded the escrow.
- `token`: Token contract address transferred into escrow.
- `amount`: Total amount deposited.
- `milestone_count`: Number of milestones funded by the deposit.
- `deposited_at`: Ledger timestamp when the event was emitted.

### Validation

`deposit` emits the event only after the existing escrow checks and state changes succeed:

- The job must exist and be in `Setup`.
- The caller is authenticated through the stored client address.
- The deposited amount must be positive.
- The job must have at least one milestone.
- The sum of milestone amounts must match the deposit amount.
- Token transfer into the contract and persistent job update must complete successfully.
