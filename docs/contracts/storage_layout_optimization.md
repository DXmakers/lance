# Storage Layout Optimization (ContractData vs ContractInstance)

## Overview

This change optimizes Soroban storage layout by reducing unnecessary `ContractData` writes and tightening `ContractInstance`-based config control.

The objective is to lower rent footprint and execution overhead without changing external behavior.

## What Changed

### 1) JobRegistry: lazy `Bids(job_id)` ContractData allocation

File: `contracts/job_registry/src/lib.rs`

Before:

- `post_job` always created two persistent entries:
  - `Job(job_id)`
  - `Bids(job_id)` initialized as an empty vector

After:

- `post_job` creates only `Job(job_id)`.
- `Bids(job_id)` is created on first `submit_bid` write.
- Read paths (`get_bids`, `accept_bid`) already safely handle missing bids entry via `unwrap_or_else(Vec::new)`.

Impact:

- One less persistent `ContractData` entry per newly posted job that never receives bids.
- Lower storage rent pressure and smaller ledger footprint.

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
- Dynamic keys are now allocated lazily where possible (`Bids(job_id)`), minimizing persistent data creation.

## Compatibility

- No public function signatures were changed.
- Existing tests and behavior remain compatible.
