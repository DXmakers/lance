# Reputation Query Function

## Overview

The reputation contract now exposes a read-only `query_reputation` function that returns both role-specific reputation snapshots for a single address in one call.

This reduces client-side round trips when a UI needs to show both client and freelancer trust signals for the same wallet.

## Contract API

- `query_reputation(address)` returns:
  - client reputation snapshot
  - freelancer reputation snapshot
- `get_public_metrics(address, role_name)` remains available for role-specific legacy callers, but now validates the role symbol instead of silently defaulting to freelancer.

## Validation

- Unknown role symbols now fail with `ReputationError::InvalidInput`.
- The returned reputation values are derived from persistent profile storage and respect the contract's existing score clamping rules.

## Frontend Usage

The web reputation helper now queries the contract once and derives the requested role metrics from the returned summary.

## Files

- `contracts/reputation/src/lib.rs`
- `apps/web/lib/reputation.ts`
