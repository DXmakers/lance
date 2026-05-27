// contracts/escrow/src/lib.rs
//
// SC-SEC-061 + SC-SEC-072: ReentrancyGuard for Token Transfers
//
// Compiler flags (set in Cargo.toml [profile.release]):
//   opt-level = "z"        — minimise WASM binary size
//   lto = true             — link-time dead-code elimination
//   codegen-units = 1      — max inlining
//   overflow-checks = true — panic on integer overflow
//   panic = "abort"        — no stack-unwinding overhead
//
// Security invariants enforced on every call:
//   • All incoming addresses pass `address_validation::validate_address()`.
//   • Caller identity verified via `Address::require_auth()`.
//   • All token-transfer paths (release, refund, judge_verdict) are wrapped in
//     `nonreentrant!(env, state, { … })`, ensuring the lock is acquired before
//     the cross-contract SAC call and released after, with the flag persisted
//     to storage at both boundaries.
//   • State transitions are validated before any storage write.
//
// Entry-points:
//   initialise        — deposit client funds; register parties.
//   approve_milestone — client marks a milestone complete (no transfer).
//   release           — transfer funds to freelancer (nonreentrant).
//   refund            — return funds to client (nonreentrant).
//   dispute           — freeze escrow pending AI-judge verdict.
//   judge_verdict     — judge resolves dispute (nonreentrant).

#![no_std]
#![forbid(unsafe_code)]

#[macro_use]
mod reentrancy;

mod address_validation;
mod error;
mod storage_types;

use soroban_sdk::{contract, contractimpl, token, Address, Env};

use address_validation::{
    is_registered_party, register_escrow_parties, validate_address, AddressRole,
};
use error::EscrowError;
use storage_types::{DataKey, EscrowState, EscrowStatus, MilestoneStatus};

// ─── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Initialises a new escrow.
    ///
    /// Validates all addresses, registers parties for poisoning detection,
    /// pulls `amount` tokens from `client` into the contract, and stores the
    /// packed `EscrowState` (~140 bytes XDR).
    pub fn initialise(
        env: Env,
        client: Address,
        freelancer: Address,
        judge: Address,
        token: Address,
        amount: i128,
        deadline: u64,
        milestone_count: u32,
    ) -> Result<(), EscrowError> {
        if env.storage().instance().has(&DataKey::State) {
            return Err(EscrowError::AlreadyInitialised);
        }

        let client     = validate_address(&env, &client);
        let freelancer = validate_address(&env, &freelancer);
        let judge      = validate_address(&env, &judge);
        let token      = validate_address(&env, &token);

        client.require_auth();

        if amount <= 0 {
            return Err(EscrowError::InsufficientDeposit);
        }

        register_escrow_parties(&env, &client, &freelancer);
        env.storage()
            .instance()
            .set(&DataKey::KnownAddress(AddressRole::Judge), &judge);

        token::Client::new(&env, &token)
            .transfer(&client, &env.current_contract_address(), &amount);

        env.storage().instance().set(
            &DataKey::State,
            &EscrowState {
                status: EscrowStatus::Active,
                client,
                freelancer,
                token,
                amount,
                deadline,
                milestone_count,
                milestones_approved: 0,
                reentrancy_lock: false,
            },
        );

        Ok(())
    }

    /// Client approves a single milestone index.
    ///
    /// Accumulates approvals; does not transfer funds. No reentrancy guard
    /// needed — no token transfer occurs.
    pub fn approve_milestone(
        env: Env,
        caller: Address,
        milestone_index: u32,
    ) -> Result<(), EscrowError> {
        let caller = validate_address(&env, &caller);
        caller.require_auth();

        let mut state: EscrowState = load_state(&env)?;

        if state.status != EscrowStatus::Active {
            return Err(EscrowError::InvalidState);
        }
        if !is_registered_party(&env, &caller, AddressRole::Client) {
            return Err(EscrowError::Unauthorized);
        }
        if milestone_index >= state.milestone_count {
            return Err(EscrowError::InvalidMilestone);
        }

        let key = DataKey::Milestone(milestone_index);
        let already: bool = env
            .storage()
            .instance()
            .get(&key)
            .map(|s: MilestoneStatus| s == MilestoneStatus::Approved)
            .unwrap_or(false);

        if !already {
            env.storage().instance().set(&key, &MilestoneStatus::Approved);
            state.milestones_approved += 1;
            env.storage().instance().set(&DataKey::State, &state);
        }

        Ok(())
    }

    /// Releases funds to the freelancer once all milestones are approved.
    ///
    /// ── ReentrancyGuard applied ──────────────────────────────────────────
    /// The `nonreentrant!` macro acquires the lock and writes it to persistent
    /// storage BEFORE calling `token::Client::transfer`. Any re-entrant call
    /// back into this function (or `refund`) will read the lock flag from
    /// storage and panic with `EscrowError::ReentrancyDetected`.
    pub fn release(env: Env, caller: Address) -> Result<(), EscrowError> {
        let caller = validate_address(&env, &caller);
        caller.require_auth();

        let mut state: EscrowState = load_state(&env)?;

        if state.status != EscrowStatus::Active {
            return Err(EscrowError::InvalidState);
        }
        if !is_registered_party(&env, &caller, AddressRole::Client) {
            return Err(EscrowError::Unauthorized);
        }
        if state.milestones_approved < state.milestone_count {
            return Err(EscrowError::InvalidState);
        }

        let freelancer = validate_address(&env, &state.freelancer.clone());
        let token_addr = state.token.clone();
        let amount     = state.amount;

        // ── nonreentrant! ─────────────────────────────────────────────────
        // Expands to:
        //   let __guard = ReentrancyGuard::new(&env);
        //   __guard.acquire(&mut state);  ← writes lock=true to storage
        //   { transfer(); state.status = Completed; }
        //   __guard.release(&mut state);  ← writes lock=false + final state
        nonreentrant!(env, state, {
            token::Client::new(&env, &token_addr)
                .transfer(&env.current_contract_address(), &freelancer, &amount);
            state.status = EscrowStatus::Completed;
        });

        Ok(())
    }

    /// Refunds the client when the deadline has passed, or after a dispute
    /// resolved in their favour.
    ///
    /// ── ReentrancyGuard applied ──────────────────────────────────────────
    /// Same pattern as `release`. The lock is persisted before the SAC
    /// transfer so any re-entrant `refund` or `release` call panics.
    pub fn refund(env: Env, caller: Address) -> Result<(), EscrowError> {
        let caller = validate_address(&env, &caller);
        caller.require_auth();

        let mut state: EscrowState = load_state(&env)?;

        let is_client       = is_registered_party(&env, &caller, AddressRole::Client);
        let deadline_passed = env.ledger().timestamp() >= state.deadline;

        let eligible = match state.status {
            EscrowStatus::Active   => is_client && deadline_passed,
            EscrowStatus::Refunded => false,
            _                      => false,
        };
        if !eligible {
            return Err(EscrowError::Unauthorized);
        }

        let client     = validate_address(&env, &state.client.clone());
        let token_addr = state.token.clone();
        let amount     = state.amount;

        nonreentrant!(env, state, {
            token::Client::new(&env, &token_addr)
                .transfer(&env.current_contract_address(), &client, &amount);
            state.status = EscrowStatus::Refunded;
        });

        Ok(())
    }

    /// Raises a dispute — freezes the escrow pending AI-judge verdict.
    ///
    /// No token transfer — no reentrancy guard needed.
    pub fn dispute(env: Env, caller: Address) -> Result<(), EscrowError> {
        let caller = validate_address(&env, &caller);
        caller.require_auth();

        let mut state: EscrowState = load_state(&env)?;

        if state.status != EscrowStatus::Active {
            return Err(EscrowError::InvalidState);
        }

        let is_party = is_registered_party(&env, &caller, AddressRole::Client)
            || is_registered_party(&env, &caller, AddressRole::Freelancer);
        if !is_party {
            return Err(EscrowError::Unauthorized);
        }

        state.status = EscrowStatus::Disputed;
        env.storage().instance().set(&DataKey::State, &state);

        Ok(())
    }

    /// Judge resolves a disputed escrow — transfers funds to the winning party.
    ///
    /// ── ReentrancyGuard applied ──────────────────────────────────────────
    /// Identical lock pattern. The verdict is irreversible once the guard is
    /// acquired, preventing a manipulated token contract from triggering a
    /// second verdict call before the first completes.
    pub fn judge_verdict(
        env: Env,
        judge: Address,
        release_to_freelancer: bool,
    ) -> Result<(), EscrowError> {
        let judge = validate_address(&env, &judge);
        judge.require_auth();

        let mut state: EscrowState = load_state(&env)?;

        if state.status != EscrowStatus::Disputed {
            return Err(EscrowError::InvalidState);
        }
        if !is_registered_party(&env, &judge, AddressRole::Judge) {
            return Err(EscrowError::Unauthorized);
        }

        let recipient = if release_to_freelancer {
            validate_address(&env, &state.freelancer.clone())
        } else {
            validate_address(&env, &state.client.clone())
        };
        let token_addr          = state.token.clone();
        let amount              = state.amount;
        let final_status        = if release_to_freelancer {
            EscrowStatus::Completed
        } else {
            EscrowStatus::Refunded
        };

        nonreentrant!(env, state, {
            token::Client::new(&env, &token_addr)
                .transfer(&env.current_contract_address(), &recipient, &amount);
            state.status = final_status;
        });

        Ok(())
    }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

fn load_state(env: &Env) -> Result<EscrowState, EscrowError> {
    env.storage()
        .instance()
        .get(&DataKey::State)
        .ok_or(EscrowError::InvalidState)
}