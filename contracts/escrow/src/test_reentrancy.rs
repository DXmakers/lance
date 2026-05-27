// contracts/escrow/src/test_reentrancy.rs
//
// SC-SEC-061: Exhaustive reentrancy unit tests
//
// Test matrix:
//   1.  Guard struct — acquire panics when already locked (direct unit test)
//   2.  Guard struct — lock is written to storage before returning from acquire
//   3.  Guard struct — release clears the flag and writes storage
//   4.  Guard struct — acquire then release leaves lock = false
//   5.  nonreentrant! macro — expands correctly (smoke test via release())
//   6.  release()      — reentrancy panic on simulated re-entrant call
//   7.  refund()       — reentrancy panic on simulated re-entrant call
//   8.  judge_verdict()— reentrancy panic on simulated re-entrant call
//   9.  release()      — lock is cleared after normal completion
//   10. refund()       — lock is cleared after normal completion
//   11. judge_verdict()— lock is cleared after normal completion
//   12. Gas benchmark  — release() instruction cost ≤ 10 200 (−15% from baseline)
//   13. Gas benchmark  — refund()  instruction cost ≤  9 775 (−15% from baseline)
//   14. Gas benchmark  — judge_verdict() instruction cost ≤ 10 200

#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token, Address, Env,
};

use crate::{
    error::EscrowError,
    reentrancy::ReentrancyGuard,
    storage_types::{DataKey, EscrowState, EscrowStatus},
    EscrowContract, EscrowContractClient,
};

// ─── Setup helpers ───────────────────────────────────────────────────────────

fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let client     = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let judge      = Address::generate(&env);

    let token_id   = env.register_stellar_asset_contract_v2(client.clone());
    let token_addr = token_id.address();

    token::StellarAssetClient::new(&env, &token_addr)
        .mint(&client, &10_000_000_000_i128);

    (env, client, freelancer, judge, token_addr)
}

fn deploy(
    env: &Env,
    client: &Address,
    freelancer: &Address,
    judge: &Address,
    token: &Address,
    amount: i128,
) -> EscrowContractClient {
    let id     = env.register_contract(None, EscrowContract);
    let escrow = EscrowContractClient::new(env, &id);
    escrow
        .initialise(
            client,
            freelancer,
            judge,
            token,
            &amount,
            &(env.ledger().timestamp() + 86_400),
            &2_u32,
        )
        .unwrap();
    escrow
}

// ─── 1. acquire panics when already locked ───────────────────────────────────

#[test]
fn guard_acquire_panics_when_locked() {
    let (env, client, freelancer, _, token) = setup();
    let contract_id = env.register_contract(None, EscrowContract);

    env.as_contract(&contract_id, || {
        let mut state = make_state(&env, &client, &freelancer, &token);
        state.reentrancy_lock = true; // pre-set as if a prior acquire ran

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            ReentrancyGuard::new(&env).acquire(&mut state);
        }));
        assert!(result.is_err(), "expected panic when lock already set");
    });
}

// ─── 2. acquire writes lock=true to storage ──────────────────────────────────

#[test]
fn guard_acquire_persists_lock_to_storage() {
    let (env, client, freelancer, _, token) = setup();
    let contract_id = env.register_contract(None, EscrowContract);

    env.as_contract(&contract_id, || {
        let mut state = make_state(&env, &client, &freelancer, &token);

        ReentrancyGuard::new(&env).acquire(&mut state);

        // Read state directly from storage — must show lock = true.
        let stored: EscrowState = env
            .storage()
            .instance()
            .get(&DataKey::State)
            .expect("state must exist after acquire");

        assert!(
            stored.reentrancy_lock,
            "lock must be true in storage after acquire"
        );
    });
}

// ─── 3. release clears flag in storage ───────────────────────────────────────

#[test]
fn guard_release_clears_lock_in_storage() {
    let (env, client, freelancer, _, token) = setup();
    let contract_id = env.register_contract(None, EscrowContract);

    env.as_contract(&contract_id, || {
        let mut state = make_state(&env, &client, &freelancer, &token);

        let guard = ReentrancyGuard::new(&env);
        guard.acquire(&mut state);
        guard.release(&mut state);

        let stored: EscrowState = env
            .storage()
            .instance()
            .get(&DataKey::State)
            .expect("state must exist after release");

        assert!(
            !stored.reentrancy_lock,
            "lock must be false in storage after release"
        );
    });
}

// ─── 4. acquire + release leaves lock = false in memory ──────────────────────

#[test]
fn guard_acquire_release_leaves_unlocked() {
    let (env, client, freelancer, _, token) = setup();
    let contract_id = env.register_contract(None, EscrowContract);

    env.as_contract(&contract_id, || {
        let mut state = make_state(&env, &client, &freelancer, &token);

        let guard = ReentrancyGuard::new(&env);
        guard.acquire(&mut state);
        assert!(state.reentrancy_lock);
        guard.release(&mut state);
        assert!(!state.reentrancy_lock);
    });
}

// ─── 5. nonreentrant! macro smoke test (via release) ─────────────────────────

#[test]
fn nonreentrant_macro_smoke_test() {
    let (env, client, freelancer, judge, token) = setup();
    let escrow = deploy(&env, &client, &freelancer, &judge, &token, 1_000_000);

    escrow.approve_milestone(&client, &0).unwrap();
    escrow.approve_milestone(&client, &1).unwrap();

    // release() internally uses nonreentrant! — verify it completes normally.
    let result = escrow.release(&client);
    assert!(result.is_ok(), "release with nonreentrant! must succeed: {:?}", result);
}

// ─── 6. release — re-entrant call panics ─────────────────────────────────────
//
// We simulate a re-entrant call by manually setting reentrancy_lock = true
// in instance storage before calling release(), as if a prior acquire() had
// run but never released. The guard must detect this and abort.

#[test]
fn release_panics_on_reentrancy() {
    let (env, client, freelancer, judge, token) = setup();
    let escrow = deploy(&env, &client, &freelancer, &judge, &token, 1_000_000);

    escrow.approve_milestone(&client, &0).unwrap();
    escrow.approve_milestone(&client, &1).unwrap();

    // Inject the locked flag directly — simulates a re-entrant call arriving
    // while a prior release() is mid-transfer.
    env.as_contract(escrow.address(), || {
        let mut state: EscrowState = env
            .storage()
            .instance()
            .get(&DataKey::State)
            .unwrap();
        state.reentrancy_lock = true;
        env.storage().instance().set(&DataKey::State, &state);
    });

    let result = escrow.try_release(&client);
    assert!(
        result.is_err(),
        "release must fail when lock is pre-set (re-entrant scenario)"
    );
}

// ─── 7. refund — re-entrant call panics ──────────────────────────────────────

#[test]
fn refund_panics_on_reentrancy() {
    let (env, client, freelancer, judge, token) = setup();
    let contract_id = env.register_contract(None, EscrowContract);
    let escrow      = EscrowContractClient::new(&env, &contract_id);

    let deadline = env.ledger().timestamp() + 100;
    escrow
        .initialise(
            &client, &freelancer, &judge, &token,
            &1_000_000, &deadline, &1,
        )
        .unwrap();

    // Fast-forward past deadline.
    env.ledger().set(LedgerInfo {
        timestamp: deadline + 1,
        ..env.ledger().get()
    });

    // Inject locked flag.
    env.as_contract(&contract_id, || {
        let mut state: EscrowState =
            env.storage().instance().get(&DataKey::State).unwrap();
        state.reentrancy_lock = true;
        env.storage().instance().set(&DataKey::State, &state);
    });

    let result = escrow.try_refund(&client);
    assert!(result.is_err(), "refund must fail when lock pre-set");
}

// ─── 8. judge_verdict — re-entrant call panics ───────────────────────────────

#[test]
fn judge_verdict_panics_on_reentrancy() {
    let (env, client, freelancer, judge, token) = setup();
    let escrow = deploy(&env, &client, &freelancer, &judge, &token, 1_000_000);

    escrow.dispute(&client).unwrap();

    // Inject locked flag.
    env.as_contract(escrow.address(), || {
        let mut state: EscrowState =
            env.storage().instance().get(&DataKey::State).unwrap();
        state.reentrancy_lock = true;
        env.storage().instance().set(&DataKey::State, &state);
    });

    let result = escrow.try_judge_verdict(&judge, &true);
    assert!(result.is_err(), "judge_verdict must fail when lock pre-set");
}

// ─── 9. release — lock cleared after successful call ─────────────────────────

#[test]
fn release_lock_cleared_after_success() {
    let (env, client, freelancer, judge, token) = setup();
    let escrow = deploy(&env, &client, &freelancer, &judge, &token, 1_000_000);

    escrow.approve_milestone(&client, &0).unwrap();
    escrow.approve_milestone(&client, &1).unwrap();
    escrow.release(&client).unwrap();

    env.as_contract(escrow.address(), || {
        let state: EscrowState = env
            .storage()
            .instance()
            .get(&DataKey::State)
            .unwrap();
        assert!(!state.reentrancy_lock, "lock must be false after release completes");
        assert_eq!(state.status, EscrowStatus::Completed);
    });
}

// ─── 10. refund — lock cleared after successful call ─────────────────────────

#[test]
fn refund_lock_cleared_after_success() {
    let (env, client, freelancer, judge, token) = setup();
    let contract_id = env.register_contract(None, EscrowContract);
    let escrow      = EscrowContractClient::new(&env, &contract_id);

    let deadline = env.ledger().timestamp() + 100;
    escrow
        .initialise(&client, &freelancer, &judge, &token, &1_000_000, &deadline, &1)
        .unwrap();

    env.ledger().set(LedgerInfo {
        timestamp: deadline + 1,
        ..env.ledger().get()
    });
    escrow.refund(&client).unwrap();

    env.as_contract(&contract_id, || {
        let state: EscrowState = env.storage().instance().get(&DataKey::State).unwrap();
        assert!(!state.reentrancy_lock, "lock must be false after refund completes");
        assert_eq!(state.status, EscrowStatus::Refunded);
    });
}

// ─── 11. judge_verdict — lock cleared after successful call ──────────────────

#[test]
fn judge_verdict_lock_cleared_after_success() {
    let (env, client, freelancer, judge, token) = setup();
    let escrow = deploy(&env, &client, &freelancer, &judge, &token, 1_000_000);

    escrow.dispute(&client).unwrap();
    escrow.judge_verdict(&judge, &true).unwrap();

    env.as_contract(escrow.address(), || {
        let state: EscrowState = env.storage().instance().get(&DataKey::State).unwrap();
        assert!(!state.reentrancy_lock, "lock must be false after judge_verdict completes");
        assert_eq!(state.status, EscrowStatus::Completed);
    });
}

// ─── 12–14. Gas benchmarks ───────────────────────────────────────────────────
//
// Pre-SC-SEC-061 baselines (measured in Soroban testutils CPU instruction units):
//   release        : ~12 000
//   refund         : ~11 500
//   judge_verdict  : ~12 000
//
// SC-SEC-061 target (−15%):
//   release        : ≤ 10 200
//   refund         : ≤  9 775
//   judge_verdict  : ≤ 10 200

#[test]
fn gas_release_within_budget() {
    let (env, client, freelancer, judge, token) = setup();
    let escrow = deploy(&env, &client, &freelancer, &judge, &token, 1_000_000);

    escrow.approve_milestone(&client, &0).unwrap();
    escrow.approve_milestone(&client, &1).unwrap();

    env.budget().reset_unlimited();
    escrow.release(&client).unwrap();
    let cost = env.budget().cpu_instruction_cost();

    assert!(
        cost <= 10_200,
        "release used {} instructions; expected ≤ 10 200 (−15% baseline)",
        cost
    );
}

#[test]
fn gas_refund_within_budget() {
    let (env, client, freelancer, judge, token) = setup();
    let contract_id = env.register_contract(None, EscrowContract);
    let escrow      = EscrowContractClient::new(&env, &contract_id);
    let deadline    = env.ledger().timestamp() + 100;

    escrow
        .initialise(&client, &freelancer, &judge, &token, &1_000_000, &deadline, &1)
        .unwrap();

    env.ledger().set(LedgerInfo {
        timestamp: deadline + 1,
        ..env.ledger().get()
    });

    env.budget().reset_unlimited();
    escrow.refund(&client).unwrap();
    let cost = env.budget().cpu_instruction_cost();

    assert!(
        cost <= 9_775,
        "refund used {} instructions; expected ≤ 9 775 (−15% baseline)",
        cost
    );
}

#[test]
fn gas_judge_verdict_within_budget() {
    let (env, client, freelancer, judge, token) = setup();
    let escrow = deploy(&env, &client, &freelancer, &judge, &token, 1_000_000);

    escrow.dispute(&client).unwrap();

    env.budget().reset_unlimited();
    escrow.judge_verdict(&judge, &true).unwrap();
    let cost = env.budget().cpu_instruction_cost();

    assert!(
        cost <= 10_200,
        "judge_verdict used {} instructions; expected ≤ 10 200 (−15% baseline)",
        cost
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Builds an EscrowState and writes it to instance storage so guard tests
/// can run inside `env.as_contract(...)` without a full initialise() call.
fn make_state(env: &Env, client: &Address, freelancer: &Address, token: &Address) -> EscrowState {
    let state = EscrowState {
        status: EscrowStatus::Active,
        client: client.clone(),
        freelancer: freelancer.clone(),
        token: token.clone(),
        amount: 1_000_000,
        deadline: 9_999_999,
        milestone_count: 1,
        milestones_approved: 0,
        reentrancy_lock: false,
    };
    env.storage().instance().set(&DataKey::State, &state);
    state
}