# Initialize Job Registry Storage

## Summary

This document describes the storage bootstrap flow for the Soroban `job_registry` contract and the security constraints added for production-oriented operation.

The registry now enforces explicit one-time initialization before any state mutation.

## New Public Functions

- `initialize(env: Env, admin: Address)`
  - One-time setup for contract instance storage.
  - Requires `admin` auth.
  - Stores:
    - `DataKey::Admin`
    - `DataKey::NextJobId` initialized to `1`

- `is_initialized(env: Env) -> bool`
  - Returns whether the registry has been initialized.

- `get_admin(env: Env) -> Address`
  - Returns the configured admin address.

- `get_next_job_id(env: Env) -> u64`
  - Returns the next auto-assigned job id.

- `post_job_auto(env: Env, client: Address, hash: Bytes, budget: i128) -> u64`
  - Allocates a new on-chain id using `NextJobId`.
  - Increments `NextJobId` atomically after successful write.

## Updated Behavior

- `post_job` now requires initialization and validates:
  - `job_id > 0`
  - `budget > 0`
  - non-empty hash with bounded length

- `submit_bid` now rejects duplicate bids from the same freelancer on the same job.

- `accept_bid` now requires the selected freelancer to have a submitted bid.

- `submit_deliverable` validates hash and state transitions.

- `mark_disputed` now requires admin authorization.

## Error Handling

All failure paths now use typed contract errors (`JobRegistryError`) through Soroban contract error codes rather than string panics.

Covered categories include:

- initialization state errors
- unauthorized access
- invalid input (hash/budget/job id)
- invalid state transitions
- missing records
- overflow protection for id progression

## Logging

State-changing functions emit Soroban events for observability:

- `init`
- `jobpost`
- `jobauto`
- `bid`
- `accept`
- `deliver`
- `dispute`

## Test Coverage Scope

`contracts/job_registry/src/lib.rs` includes tests for:

- initialization lifecycle
- pre-init rejection
- auto id allocation
- explicit id counter sync
- input validation failures
- duplicate bid rejection
- accept-bid authorization and bid existence checks
- dispute state transition guards
- full happy-path lifecycle

Run:

```bash
cargo test -p job_registry
```

## Testnet Verification Checklist

1. Deploy updated `job_registry` contract to Stellar Testnet.
2. Call `initialize(admin)` once.
3. Submit `post_job_auto` and confirm `get_next_job_id` increments.
4. Validate events via Soroban RPC event queries.
5. Attempt invalid calls (duplicate bid, invalid transition, pre-init call) and confirm contract error codes.
6. Execute dispute flow with admin signer and confirm final job status.
