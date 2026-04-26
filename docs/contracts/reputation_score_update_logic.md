# Reputation Score Update Logic

## Overview

This document describes the Lance reputation contract update flow for on-chain rating and administrative score adjustments.

## Behavior

- Ratings are only accepted after a job reaches `Completed`.
- Only job participants may rate a target address.
- A participant can rate each job only once.
- Ratings update the correct role bucket:
  - `Client` when the target is the job client.
  - `Freelancer` when the target is the assigned freelancer.
- Administrative score updates and slashing emit reputation events for off-chain auditability.

## Validation

- Rating input is restricted to the `1..=5` range.
- Non-participants are rejected with a dedicated Soroban error code.
- Duplicate reviews are rejected with a dedicated Soroban error code.
- Score values are clamped to the `0..=10000` basis-point range.

## Logging and Auditability

The contract emits state-changing events for:

- contract upgrades
- score adjustments
- rating submissions

These events are intended for backend indexing and debugging in Testnet and production environments.

## Files

- `contracts/reputation/src/lib.rs`
- `contracts/reputation/src/storage.rs`
- `contracts/reputation/src/profile.rs`
