# JobRegistry Smart Contract

## Overview

The `JobRegistry` contract manages job postings, bid submissions, bid cancellation, collateral refund accounting, bid acceptance, deliverable submission, and dispute status updates for the Lance protocol.

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
- Credits collateral from non-selected bids to each losing freelancer's refund balance.
- Compacts bid storage down to the accepted bid.
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

## `submit_bid` and `submit_bid_with_collateral`

### Purpose

These functions let freelancers submit compact CID-backed proposals. `submit_bid` keeps the legacy zero-collateral path, while `submit_bid_with_collateral` records a non-negative collateral amount for later refund if the bidder cancels before assignment.

### Behavior

- Authenticates the caller with `freelancer.require_auth()`.
- Verifies the job exists and is still `Open`.
- Validates that the proposal CID is non-empty and within the CID size bound.
- Rejects duplicate bids through `BidIndex(job_id, freelancer)`.
- Stores the bid in `Bid(job_id, index)` and increments `BidCount(job_id)` with checked math.
- Records collateral in the bid row without storing heavy proposal text on-chain.

### Errors

- `JobNotFound` (7): job does not exist.
- `JobNotOpen` (8): job is not open for bid submission.
- `BidAlreadySubmitted` (10): freelancer already has an active bid for this job.
- `InvalidCollateral` (16): collateral is negative.

## `cancel_bid`, `claim_refund`, and `get_refund_balance`

### Purpose

`cancel_bid` lets a freelancer withdraw an open bid and credit its collateral to a refundable balance. `claim_refund` clears and returns the accumulated balance, while `get_refund_balance` exposes the current amount for wallets and indexers.

### Behavior

- Only the bidding freelancer can cancel or claim their own refund.
- Cancellation is allowed only while the job is `Open`.
- The bid row is removed with a swap-remove operation so `BidCount(job_id)` remains a tight upper bound.
- If the removed bid is not the last row, the last bid is moved into the cancelled index and its `BidIndex` is updated.
- Collateral is added to `Refund(freelancer)` with checked math.
- Losing bid collateral is also credited during `accept_bid`.
- `claim_refund` removes the refund storage entry after returning the amount.

### Errors

- `JobNotFound` (7): job does not exist.
- `JobNotOpen` (8): bid cancellation is no longer allowed.
- `BidNotFound` (11): the freelancer has no active bid for the job.
- `Overflow` (14): refund balance addition overflowed.
- `NoRefund` (17): the freelancer has no refundable balance to claim.

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
