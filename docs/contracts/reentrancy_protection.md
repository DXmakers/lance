# Reentrancy Protection in Escrow Contract

## Overview

The `EscrowContract` implements reentrancy protection to ensure that all token transfers are secure and follow the **Checks-Effects-Interactions** pattern. This prevents malicious or recursive calls from exploiting the contract state during external token transfers.

## Reentrancy Guard

A reentrancy guard is implemented using a `Locked` flag in the contract's instance storage. Any function that performs an external interaction (like a token transfer) must enter the guard at the beginning and exit it at the end.

### Implementation Details

- **`enter_reentrancy_guard(env: &Env)`**: Checks if the `Locked` key exists in storage. If it does, it panics with `EscrowError::ReentrancyDetected`. Otherwise, it sets the `Locked` key.
- **`exit_reentrancy_guard(env: &Env)`**: Removes the `Locked` key from storage, allowing subsequent calls.

If a call panics during the interaction, the transaction is reverted, and the `Locked` flag is cleared as part of the state revert, ensuring the contract is not left in a locked state.

## Checks-Effects-Interactions Pattern

In addition to the reentrancy guard, all transfer functions have been refactored to strictly follow the Checks-Effects-Interactions pattern:

1.  **Checks**: Validate inputs, permissions, and current state.
2.  **Effects**: Update the contract's internal state (e.g., updating `job.status` or `job.released_amount`).
3.  **Interactions**: Perform the external token transfer using the `token::Client`.

This ensures that even if a reentrancy attack were possible, the contract state would already reflect the updated values before the attack occurs.

## Affected Functions

The following functions are protected by the reentrancy guard and follow the reordered logic:

- `deposit`
- `release_milestone`
- `release_funds`
- `resolve_dispute`
- `refund`

## Error Codes

- **`EscrowError::ReentrancyDetected` (12)**: Returned when a reentrant call is detected by the guard.
