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

This implementation strengthens trustlessness by ensuring bid acceptance can only succeed for bidders who actually participated in the auction.

## `get_job`

### Purpose

`get_job` is a view function that retrieves the full record of a specific job.

### Behavior

- Retrieves the `JobRecord` from persistent storage.
- Returns the job details if it exists.

### Errors

- `JobNotFound` (1): The specified job ID does not exist.

## `get_bids`

### Purpose

`get_bids` is a view function that retrieves all bids submitted for a specific job.

### Behavior

- Verifies the job exists.
- Retrieves the list of `BidRecord`s associated with the job.
- Returns an empty list if the job exists but has no bids.

### Errors

- `JobNotFound` (1): The specified job ID does not exist.
## `submit_deliverable`

### Purpose

`submit_deliverable` is called by a freelancer to submit their completed work for a job that is in progress. The deliverable is stored as an IPFS hash, enabling decentralized content storage while maintaining on-chain auditability.

### Behavior

- Authenticates the caller with `freelancer.require_auth()`.
- Validates that the deliverable hash is not empty to prevent invalid submissions.
- Verifies the job exists and is currently in the `InProgress` state.
- Confirms the caller is the assigned freelancer for the job.
- Updates the job status to `DeliverableSubmitted`.
- Stores the deliverable hash in persistent storage for later retrieval.
- Emits a `DeliverableSubmitted` event with timestamp for on-chain auditing and off-chain indexing.

### Errors

`submit_deliverable` uses `JobRegistryError` to return structured error information:

- `JobNotFound` (1): job does not exist.
- `InvalidInput` (4): deliverable hash is empty.
- `InvalidState` (5): job is not in `InProgress` status.
- `Unauthorized` (3): caller is not the assigned freelancer for the job.

### Notes

This function is critical for the job completion workflow, enabling freelancers to submit their work while maintaining security through authentication and state validation. The IPFS hash storage minimizes on-chain data while preserving immutability and accessibility.
