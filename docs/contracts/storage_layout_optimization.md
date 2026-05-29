# Storage Layout Optimization (ContractData vs ContractInstance)

## Overview

This change optimizes Soroban storage layout by reducing unnecessary `ContractData` writes and tightening `ContractInstance`-based config control.

The objective is to lower rent footprint and execution overhead without changing external behavior.

## What Changed

### 1) JobRegistry: indexed bid rows instead of monolithic bid vectors

File: `contracts/job_registry/src/lib.rs`

Before:

- `post_job` always created two persistent entries:
  - `Job(job_id)`
  - `Bids(job_id)` initialized as an empty vector
- Each `submit_bid` deserialized and rewrote the whole vector.
- `accept_bid` scanned the whole vector to confirm that a freelancer had bid.

After:

- `post_job` creates only `Job(job_id)`.
- `BidCount(job_id)` tracks the current bid bounds.
- `Bid(job_id, index)` stores each proposal as an independent row.
- `BidIndex(job_id, freelancer)` provides constant-key duplicate checks, cancellation, and accept validation.
- `Refund(freelancer)` accumulates collateral credited by cancelled bids until the freelancer claims it.
- `get_bids` remains a compatibility view that reconstructs a vector only for read callers.
- `get_bid_at` provides bounded indexed reads and returns `BidIndexOutOfBounds` (15) for invalid indices.

Impact:

- One less persistent `ContractData` entry per newly posted job that never receives bids.
- Write paths avoid repeatedly deserializing and rewriting a growing bid vector.
- Bid cancellation uses swap-remove compaction so indexed bounds remain tight after dynamic removals.
- Bid acceptance refunds non-selected collateral and compacts storage down to the accepted row.
- Collateral refund accounting uses checked addition and clears storage on claim.
- Late bid submissions after assignment remain blocked with `JobNotOpen` (8).
- Lower execution overhead for duplicate checks and bid acceptance.

### 2) Reputation: strict admin verification for instance config updates

File: `contracts/reputation/src/lib.rs`

`set_job_registry` now verifies:

- caller auth (`require_auth`) and
- equality with admin stored in `ContractInstance` (`DataKey::Admin`).

Impact:

- Preserves intended instance-based config authority model.
- Prevents unauthorized instance config writes by any authenticated address.

## Why this aligns with ContractData vs ContractInstance

- `ContractInstance`: used for compact, singleton contract config (admin, registry pointers).
- `ContractData`: used for per-job/per-user dynamic state.
- Dynamic bid keys are now allocated per submitted proposal, bounded by `BidCount(job_id)`, and compacted on cancellation, minimizing unnecessary persistent data reads and rewrites.

## Compatibility

- No public function signatures were changed.
- `submit_bid` remains available as the zero-collateral compatibility path.
- `BidRecord` now includes `collateral_stroops` so callers can inspect refundable bid collateral.
