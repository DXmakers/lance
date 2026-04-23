# Escrow -> JobRegistry Cross-Contract Integration

## Overview

This document describes the Escrow-to-JobRegistry cross-contract synchronization flow.

When a dispute is opened in the Escrow contract, Escrow now performs a cross-contract call to JobRegistry and marks the corresponding job as disputed. This keeps both contracts aligned for dispute workflows and backend indexing.

## New Escrow Public Function

### `set_job_registry(env, job_registry)`

Configures the JobRegistry contract address used for dispute status synchronization.

Behavior:

- Requires Escrow admin authentication.
- Stores the JobRegistry address in Escrow instance storage.
- Emits `JobRegistryConfigured` event for observability.

Errors:

- `NotInitialized` (2): Escrow was not initialized.

## Updated Escrow Behavior

### `open_dispute(env, job_id, caller)`

After validating caller and state, Escrow now:

1. Sets Escrow job status to `Disputed`.
2. Calls `JobRegistry.mark_disputed(job_id)`.
3. Emits `RegistryDisputeSynced` and `OpenDispute` events.

### `raise_dispute(env, job_id, caller)`

After existing validation checks, Escrow now:

1. Sets Escrow job status to `Disputed`.
2. Calls `JobRegistry.mark_disputed(job_id)`.
3. Emits `RegistryDisputeSynced` and `DisputeRaised` events.

## Error Handling

Escrow introduces an explicit Soroban error code for cross-contract failures:

- `JobRegistrySyncFailed` (9): Cross-contract dispute sync failed.

These provide clear, actionable failures without silent state drift.

## Security and Validation Notes

- Cross-contract call is only executed after existing caller and state validation passes.
- Sync is optional: if JobRegistry is not configured via `set_job_registry`, dispute flow continues in Escrow only.
- No arithmetic changes were introduced in this integration path.
- Cross-contract sync runs in the same transaction context, preserving atomicity.

## Test Coverage

Escrow now includes an integration test:

- `test_open_dispute_syncs_job_registry_status`

This test verifies:

- Job is `InProgress` in JobRegistry before dispute.
- Opening dispute in Escrow transitions both Escrow and JobRegistry to `Disputed`.
