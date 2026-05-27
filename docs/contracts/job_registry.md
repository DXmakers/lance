# JobRegistry Smart Contract

## Overview

The `JobRegistry` contract manages job postings, bid submissions, bid acceptance, deliverable submission, and dispute status updates for the Lance protocol.

## `post_job` and `post_job_auto`

### Purpose

These functions allow a client to post a new job to the Lance protocol, making it available for freelancers to bid on. `post_job` allows the client to explicitly define the job ID, while `post_job_auto` automatically assigns the next available sequential ID.

### Behavior

- Authenticates the caller with `client.require_auth()`.
- Validates inputs: checks for invalid (zero) budget, validates the compact IPFS CID size, and checks for zero job ID.
- Stores the job data (`client`, compact IPFS CID metadata, `budget_stroops`, `status = Open`) in persistent storage.
- Initializes a compact per-job bid counter; individual bids are stored in indexed rows only when submitted.
- Automatically increments the internal `NextJobId` counter.
- Emits a `jobpost` (or `jobauto`) event for on-chain tracking and off-chain indexing.

### Errors

These functions use `JobRegistryError` to return structured error information:

- `InvalidJobId` (3): job ID cannot be zero.
- `InvalidBudget` (4): budget must be greater than zero.
- `InvalidHash` (5): metadata CID must not be empty or exceed maximum length.
- `JobAlreadyExists` (6): the explicitly requested job ID is already taken.
- `Overflow` (14): the next job ID counter overflowed.

### Security

These functions perform strict validation on inputs to prevent issues like overflow and oversized metadata. All CID inputs are bounded, ensuring minimal on-chain footprint and deterministic behavior.

## `accept_bid`

### Purpose

`accept_bid` is called by a job client to accept one freelancer's bid and move the job into the assigned state.

### Behavior

- Authenticates the caller with `client.require_auth()`.
- Verifies the job exists and is currently in the `Open` state.
- Confirms the caller is the job's client.
- Validates that the selected freelancer previously submitted a bid for the job.
- Updates the job status to `Assigned` and records the accepted freelancer.
- Emits a `BidAccepted` event for on-chain auditing.

### Errors

`accept_bid` uses `JobRegistryError` to return structured error information:

- `JobNotFound` (7): job does not exist.
- `JobNotOpen` (8): job is not open for bid acceptance.
- `Unauthorized` (9): caller is not the job's client.
- `BidNotFound` (11): selected freelancer did not submit a bid.

This implementation strengthens trustlessness by ensuring bid acceptance can only succeed for bidders who actually participated in the auction.
The bid lookup is keyed by `(job_id, freelancer)`, so acceptance does not deserialize the full bid collection.

## `get_job`

### Purpose

`get_job` is a view function that retrieves the full record of a specific job.

### Behavior

- Retrieves the `JobRecord` from persistent storage.
- Returns the job details if it exists.

### Errors

- `JobNotFound` (7): The specified job ID does not exist.

## `get_bids`

### Purpose

`get_bids` is a view function that retrieves all bids submitted for a specific job.

### Behavior

- Verifies the job exists.
- Reconstructs the list of `BidRecord`s from indexed bid rows associated with the job.
- Returns an empty list if the job exists but has no bids.

### Errors

- `JobNotFound` (7): The specified job ID does not exist.

## `get_bid_at`

### Purpose

`get_bid_at` retrieves one indexed bid row for callers that need paged or bounded access.

### Behavior

- Verifies the job exists.
- Checks `index < BidCount(job_id)`.
- Returns only the requested bid record.

### Errors

- `JobNotFound` (7): The specified job ID does not exist.
- `BidIndexOutOfBounds` (15): The requested bid index is outside the stored bounds.

## `submit_deliverable`

### Purpose

`submit_deliverable` is called by a freelancer to submit their completed work for an assigned job. The deliverable is stored as a compact IPFS CID, enabling decentralized content storage while maintaining on-chain auditability.

### Behavior

- Authenticates the caller with `freelancer.require_auth()`.
- Validates that the deliverable CID is not empty or oversized to prevent invalid submissions.
- Verifies the job exists and is currently in the `Assigned` state.
- Confirms the caller is the assigned freelancer for the job.
- Updates the job status to `DeliverableSubmitted`.
- Stores the deliverable CID in persistent storage for later retrieval.
- Emits a `DeliverableSubmitted` event with timestamp for on-chain auditing and off-chain indexing.

### Errors

`submit_deliverable` uses `JobRegistryError` to return structured error information:

- `JobNotFound` (7): job does not exist.
- `InvalidHash` (5): deliverable CID is empty or exceeds the CID size bound.
- `InvalidStateTransition` (12): job is not in `Assigned` status.
- `Unauthorized` (9): caller is not the assigned freelancer for the job.

### Notes

This function is critical for the job completion workflow, enabling freelancers to submit their work while maintaining security through authentication and state validation. Compact IPFS CID storage minimizes on-chain data while preserving immutability and accessibility.
