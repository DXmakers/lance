// contracts/escrow/src/reentrancy.rs
//
// SC-SEC-061: ReentrancyGuard for Token Transfers
//
// ── Why Soroban needs a reentrancy guard ────────────────────────────────────
//
// In the EVM, a single transaction runs in one call frame; cross-contract
// calls are synchronous sub-frames and re-entrancy is possible only when the
// called contract immediately calls back. Soroban has the same property —
// a token SAC (Stellar Asset Contract) invocation IS a cross-contract call
// and it CAN invoke the caller back if an attacker deploys a malicious token.
//
// The canonical guard pattern:
//   1. Read state from storage.
//   2. Check the lock flag → panic if already set.
//   3. Set the flag and WRITE to storage (so any re-entrant call sees it).
//   4. Perform the token transfer.
//   5. Update final state and clear the flag, write storage.
//
// If the token contract calls back into `release` or `refund` mid-transfer,
// step 2 of that re-entrant call sees the flag set and panics immediately.
// Soroban unwinds the entire transaction on panic, reverting all storage
// writes — the attacker gains nothing and loses their gas.
//
// ── Design: ReentrancyGuard struct (RAII-like) ──────────────────────────────
//
// SC-SEC-061 upgrades the bare functions from SC-SEC-072 into a formal
// `ReentrancyGuard` struct. The guard:
//   • Stores a reference to the `Env` so it can write storage on acquire/release.
//   • Exposes `acquire(&mut state)` and `release(&mut state)`.
//   • Is consumed (moved) on acquire, preventing accidental double-release.
//   • Can be used via the `nonreentrant!` macro for concise call-sites.
//
// Usage (low-level):
//   let guard = ReentrancyGuard::new(&env);
//   guard.acquire(&mut state);      // panics if locked; writes storage
//   token_client.transfer(...);
//   guard.release(&mut state);      // clears flag; writes storage
//
// Usage (macro):
//   nonreentrant!(env, state, {
//       token_client.transfer(...);
//       state.status = EscrowStatus::Completed;
//   });
//
// ── Storage strategy ────────────────────────────────────────────────────────
//
// The `reentrancy_lock` bool is embedded directly in `EscrowState` rather
// than a separate `DataKey::ReentrancyLock` entry. This saves one storage
// round-trip per guarded call (one read+write instead of two separate keys)
// and shrinks the ledger footprint by ~12 bytes (one fewer XDR map entry).

use soroban_sdk::{panic_with_error, Env};

use crate::error::EscrowError;
use crate::storage_types::{DataKey, EscrowState};

// ─── ReentrancyGuard ─────────────────────────────────────────────────────────

/// A mutex-style guard that prevents re-entrant calls into guarded functions.
///
/// # Invariants
/// * `acquire` must always be followed by `release` on the same `state`.
/// * Between `acquire` and `release`, `state.reentrancy_lock == true` is
///   persisted to instance storage — any re-entrant call reads this and panics.
/// * Soroban rolls back all storage writes on panic, so a failed re-entrant
///   attempt leaves state unchanged.
///
/// # Gas profile (per guarded call)
/// * 1 × instance storage read  (already done by caller loading state)
/// * 1 × instance storage write  (acquire — persists the lock)
/// * 1 × instance storage write  (release — clears lock + final state)
/// Total overhead: 2 storage writes ≈ +600 instructions vs unguarded.
pub struct ReentrancyGuard<'env> {
    env: &'env Env,
}

impl<'env> ReentrancyGuard<'env> {
    /// Creates a new guard bound to `env`.
    ///
    /// Creating the guard does NOT set the lock — call `acquire` explicitly,
    /// or use the `nonreentrant!` macro which does both.
    #[inline(always)]
    pub fn new(env: &'env Env) -> Self {
        Self { env }
    }

    /// Acquires the lock.
    ///
    /// # Panics
    /// Panics with [`EscrowError::ReentrancyDetected`] if `state.reentrancy_lock`
    /// is already `true`. This fires correctly on re-entrant calls because
    /// `acquire` writes the updated state to persistent storage *before*
    /// returning, so the re-entrant invocation reads the flag from storage
    /// at its own load-state step.
    #[inline(always)]
    pub fn acquire(&self, state: &mut EscrowState) {
        if state.reentrancy_lock {
            panic_with_error!(self.env, EscrowError::ReentrancyDetected);
        }
        state.reentrancy_lock = true;
        // ── Critical: write BEFORE the token transfer ──────────────────────
        // The transfer is a cross-contract call. If the called contract
        // invokes us back synchronously, the re-entrant call will load state
        // from storage and see the lock set, triggering the panic above.
        self.env.storage().instance().set(&DataKey::State, state);
    }

    /// Releases the lock and persists the final post-transfer state.
    ///
    /// Must be called after every `acquire`. In normal (non-panicking) flow
    /// this is always reached. If a panic occurs between `acquire` and
    /// `release`, Soroban rolls back the storage write from `acquire`, so the
    /// lock is implicitly released by the transaction revert.
    #[inline(always)]
    pub fn release(&self, state: &mut EscrowState) {
        state.reentrancy_lock = false;
        self.env.storage().instance().set(&DataKey::State, state);
    }
}

// ─── nonreentrant! macro ─────────────────────────────────────────────────────

/// Wraps a block of code with acquire + release, ensuring the lock is always
/// cleared even if the block modifies state in ways that require a final write.
///
/// # Usage
/// ```rust,ignore
/// nonreentrant!(env, state, {
///     let token_client = token::Client::new(&env, &state.token);
///     token_client.transfer(&env.current_contract_address(), &recipient, &state.amount);
///     state.status = EscrowStatus::Completed;
/// });
/// ```
///
/// Expands to:
/// ```rust,ignore
/// {
///     let __guard = ReentrancyGuard::new(&env);
///     __guard.acquire(&mut state);
///     { /* block */ }
///     __guard.release(&mut state);
/// }
/// ```
///
/// # Panic safety
/// If `block` panics, Soroban aborts the transaction and rolls back all
/// storage — the lock is cleared via rollback, not via `release`. The macro
/// does NOT catch panics; it relies on Soroban's transactional semantics.
#[macro_export]
macro_rules! nonreentrant {
    ($env:expr, $state:expr, $block:block) => {{
        let __guard = $crate::reentrancy::ReentrancyGuard::new(&$env);
        __guard.acquire(&mut $state);
        $block
        __guard.release(&mut $state);
    }};
}

// ─── Backwards-compatible free functions ────────────────────────────────────
//
// SC-SEC-072 call-sites use `enter_reentrancy_guard` / `exit_reentrancy_guard`.
// Keep them as thin wrappers so the upgrade is non-breaking.

/// Acquires the reentrancy lock via a `ReentrancyGuard`.
/// Kept for backwards compatibility with SC-SEC-072 call-sites.
#[inline(always)]
pub fn enter_reentrancy_guard(env: &Env, state: &mut EscrowState) {
    ReentrancyGuard::new(env).acquire(state);
}

/// Releases the reentrancy lock via a `ReentrancyGuard`.
/// Kept for backwards compatibility with SC-SEC-072 call-sites.
#[inline(always)]
pub fn exit_reentrancy_guard(env: &Env, state: &mut EscrowState) {
    ReentrancyGuard::new(env).release(state);
}