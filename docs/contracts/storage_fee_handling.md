# Soroban Storage Fee Handling (Footprints)

## Overview

This document describes how Lance contracts proactively handle Soroban storage rent by extending TTL for active state entries. The goal is to reduce footprint-related failures for long-running jobs and profiles while keeping on-chain behavior deterministic.

## Strategy

Each contract now applies a consistent TTL extension policy:

- `threshold`: `50_000`
- `extend_to`: `150_000`

When a key is read or written in a hot path, the contract calls `extend_ttl` to keep the entry alive.

## Contract Coverage

### Escrow

File: `contracts/escrow/src/lib.rs`

- Adds TTL helpers for instance and persistent storage.
- Extends instance TTL for admin/config-driven flows.
- Extends persistent TTL for job records in all major state transitions:
  - `create_job`
  - `add_milestone`
  - `deposit`
  - `release_milestone`
  - `release_funds`
  - `open_dispute`
  - `raise_dispute`
  - `resolve_dispute`
  - `refund`
  - `get_job`
  - `get_milestone_status`

### Job Registry

File: `contracts/job_registry/src/lib.rs`

- Adds persistent TTL helper.
- Extends TTL for job, bids, and deliverable keys during:
  - `post_job`
  - `submit_bid`
  - `accept_bid`
  - `submit_deliverable`
  - `mark_disputed`
  - `get_job`
  - `get_bids`
  - `get_deliverable`

### Reputation

Files:

- `contracts/reputation/src/lib.rs`
- `contracts/reputation/src/storage.rs`

- Extends instance TTL after admin/config and key update paths.
- Extends persistent TTL for profile and reviewed-marker entries.
- Applies TTL refresh in profile read/write helpers and in rating submission.

## Security Notes

- No external-call ordering was changed in a way that introduces reentrancy risk.
- Arithmetic and state validation checks remain intact.
- TTL extensions are conditional on key existence where required.

## Operational Notes

- This change improves resilience against storage-expiry related transaction failures.
- Threshold values are conservative defaults and can be tuned in future governance upgrades.
