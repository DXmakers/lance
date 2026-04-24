# Escrow State Transitions

## Overview

The `EscrowContract` relies on strict state transition validations to prevent common Web3 attack vectors like reentrancy and unauthorized state changes. The `EscrowStatus` enum defines the current phase of an escrowed job, and the `validate_transition` method rigorously checks all requested transitions.

## `EscrowStatus` States

- `Setup`: Initial phase. Client configures job and milestones.
- `Funded`: Client has deposited the total amount matching the milestones.
- `WorkInProgress`: First or subsequent milestones have been released. Job is active.
- `Completed`: All milestones released.
- `Disputed`: A dispute has been raised by either party. Funds are locked.
- `Resolved`: Dispute has been addressed and settled by the AI Judge or Agent.
- `Refunded`: Job was cancelled or deadline expired, and remaining funds were returned to the client.

## Valid Transitions (`validate_transition`)

To minimize on-chain footprint and prevent unauthorized overwrites, the protocol asserts the following permitted transitions:

- `Setup` -> `Funded`: Occurs on `deposit`.
- `Funded` -> `WorkInProgress`: Occurs on partial `release_milestone` or `release_funds`.
- `Funded` -> `Completed`: Occurs if a single milestone is fully released.
- `Funded` -> `Disputed`: Occurs on `open_dispute` or `raise_dispute`.
- `Funded` -> `Refunded`: Occurs on `refund`.
- `WorkInProgress` -> `WorkInProgress`: Permitted for partial milestone releases.
- `WorkInProgress` -> `Completed`: Occurs when the final milestone is released.
- `WorkInProgress` -> `Disputed`: Occurs on `open_dispute` or `raise_dispute`.
- `WorkInProgress` -> `Refunded`: Occurs on `refund`.
- `Disputed` -> `Resolved`: Occurs on `resolve_dispute`.

Attempting any other transition will result in `EscrowError::InvalidStateTransition` (11).

## Comprehensive Logging

All state-changing operations within the `EscrowContract` invoke the `soroban_sdk::log!` macro. These logs emit context details (like `job_id`, `amount`, and target states) to the Soroban runtime, making it highly observable for debugging and backend indexing without bloating persistent storage.
