# JobRegistry Smart Contract

## Overview

The `JobRegistry` contract manages job postings, bid submissions, bid acceptance, deliverable submission, and dispute status updates for the Lance protocol.

## `accept_bid`

### Purpose

`accept_bid` is called by a job client to accept one freelancer's bid and move the job into an in-progress state.

### Behavior

- Authenticates the caller with `client.require_auth()`.
- Verifies the job exists and is currently in the `Open` state.
- Confirms the caller is the job's client.
- Validates that the selected freelancer previously submitted a bid for the job.
- Updates the job status to `InProgress` and records the accepted freelancer.
- Emits a `BidAccepted` event for on-chain auditing.

### Errors

`accept_bid` uses `JobRegistryError` to return structured error information:

- `JobNotFound` (1): job does not exist.
- `InvalidState` (5): job is not open for bid acceptance.
- `Unauthorized` (3): caller is not the job's client.
- `BidNotFound` (6): selected freelancer did not submit a bid.

### Notes

This implementation strengthens trustlessness by ensuring bid acceptance can only succeed for bidders who actually participated in the auction.
