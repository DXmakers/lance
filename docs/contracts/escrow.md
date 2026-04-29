# Escrow Smart Contract

## Overview

The `Escrow` contract manages funded milestone payments, releases, refunds, and disputes for Lance jobs.

## `ReleaseEvent`

### Purpose

`ReleaseEvent` is emitted by `release_funds` after a client releases an explicit milestone index to the freelancer. It gives backend indexers and clients an auditable signal for state-changing escrow releases.

### Topic

- `("escrow", "ReleaseEvent")`

### Payload

- `job_id`: Unique job identifier.
- `released_by`: Client address that authorized the release.
- `released_to`: Freelancer address that received the payment.
- `milestone_index`: Zero-based milestone index released by the call.
- `amount`: Amount transferred for the released milestone.
- `total_released`: Cumulative amount released for the job after this release.
- `released_at`: Ledger timestamp when the event was emitted.

### Validation

`release_funds` preserves the existing escrow checks before emitting the event:

- Caller authentication via `require_auth()`.
- Job must be funded or already in progress.
- Caller must be the job client.
- Milestone index must exist.
- Milestone must still be pending.

The event is emitted only after the token transfer and persistent job update succeed.
