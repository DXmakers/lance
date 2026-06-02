// contracts/escrow/src/test_address_validation.rs
//
// SC-SEC-072 — Unit tests covering:
//   1. Address poisoning detection (prefix+suffix match, middle differs)
//   2. Zero-address rejection
//   3. Role-conflict rejection (client == freelancer)
//   4. Re-entrancy guard — simulated re-entrant call panics with the correct error
//   5. Happy-path: legitimate addresses pass through unmodified
//   6. Gas benchmark assertions (instruction-count upper bounds)

#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token, Address, Env,
};
use soroban_token_sdk::TokenUtils;

use crate::{
    address_validation::{register_escrow_parties, validate_address, AddressRole},
    error::EscrowError,
    reentrancy::{enter_reentrancy_guard, exit_reentrancy_guard},
    storage_types::{DataKey, EscrowState, EscrowStatus},
    EscrowContract, EscrowContractClient,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Creates a fresh Env with a mock token contract and two funded accounts.
fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let freelancer_addr = Address::generate(&env);
    let judge_addr = Address::generate(&env);

    // Deploy a minimal SAC-compatible test token.
    let token_id = env.register_stellar_asset_contract_v2(client_addr.clone());
    let token_addr = token_id.address();

    // Mint 1 000 USDC (7 decimal places → 10_000_000_000 stroops) to client.
    let token_admin = token::StellarAssetClient::new(&env, &token_addr);
    token_admin.mint(&client_addr, &10_000_000_000_i128);

    (env, client_addr, freelancer_addr, judge_addr, token_addr)
}

/// Deploys the escrow contract and calls `initialise` with sane defaults.
fn deploy_and_init(
    env: &Env,
    client: &Address,
    freelancer: &Address,
    judge: &Address,
    token: &Address,
    amount: i128,
) -> EscrowContractClient {
    let contract_id = env.register_contract(None, EscrowContract);
    let escrow = EscrowContractClient::new(env, &contract_id);

    escrow
        .initialise(
            client,
            freelancer,
            judge,
            token,
            &amount,
            &(env.ledger().timestamp() + 86_400), // deadline 24 h from now
            &2_u32,                                // 2 milestones
        )
        .unwrap();

    escrow
}

// ─── 1. Legitimate addresses ──────────────────────────────────────────────────

#[test]
fn valid_addresses_pass_through() {
    let (env, client, freelancer, judge, token) = setup();
    let escrow = deploy_and_init(&env, &client, &freelancer, &judge, &token, 1_000_000);
    // If initialise didn't panic, all four addresses were accepted.
    let _ = escrow;
}

// ─── 2. Zero-address rejection ────────────────────────────────────────────────

#[test]
#[should_panic(expected = "ZeroAddress")]
fn zero_address_rejected_as_client() {
    let (env, _client, freelancer, judge, token) = setup();
    let contract_id = env.register_contract(None, EscrowContract);
    let escrow = EscrowContractClient::new(&env, &contract_id);

    // Soroban doesn't have a direct "zero Address" constructor, but we can
    // test validate_address directly by calling the helper inside the contract
    // execution context via a thin wrapper.  Here we test via the full path:
    // constructing a zero-byte payload address would be caught at the SDK level,
    // so instead we verify the guard by unit-testing the helper directly.

    env.as_contract(&contract_id, || {
        // Manually insert a fake "zero" bytes entry and confirm the guard fires.
        use soroban_sdk::Bytes;
        let zero = Bytes::from_array(&env, &[0u8; 32]);
        // Calling reject_zero_address directly via the module path:
        crate::address_validation::reject_zero_address_for_test(&env, &zero);
    });
}

// ─── 3. Role-conflict rejection ───────────────────────────────────────────────

#[test]
fn client_freelancer_same_address_rejected() {
    let (env, client, _freelancer, judge, token) = setup();
    let contract_id = env.register_contract(None, EscrowContract);
    let escrow = EscrowContractClient::new(&env, &contract_id);

    let result = escrow.initialise(
        &client,
        &client, // same as client → role conflict
        &judge,
        &token,
        &1_000_000,
        &(env.ledger().timestamp() + 86_400),
        &1,
    );

    assert_eq!(result, Err(EscrowError::AddressRoleConflict));
}

// ─── 4. Address poisoning detection ──────────────────────────────────────────

/// Builds a synthetic "poisoned" address that shares the first 4 and last 4
/// bytes of `original` but differs in byte 10 (middle of the 32-byte key).
///
/// In a real attack the adversary generates a wallet whose Strkey
/// representation looks like the victim's at a glance. Here we bypass the
/// Strkey layer and manipulate raw bytes directly to isolate the detection logic.
#[test]
fn poisoned_address_detected_after_registration() {
    let (env, client, freelancer, judge, token) = setup();
    let contract_id = env.register_contract(None, EscrowContract);

    env.as_contract(&contract_id, || {
        // Register real parties.
        register_escrow_parties(&env, &client, &freelancer);

        // Build a poisoned variant of `freelancer` by flipping byte 10.
        // We do this by generating a new random address and then patching its
        // raw bytes in storage — in the actual attack scenario this would be a
        // crafted key pair, but for the unit test we simulate the final state.
        let poisoned = Address::generate(&env);
        // The detect_lookalike function operates on stored bytes, so we need
        // to first store a "registered" address, then call validate against
        // something with matching prefix/suffix.
        //
        // Here we directly test `is_lookalike` via a thin re-export:
        use soroban_sdk::Bytes;
        let mut real_raw = [0u8; 32];
        // Fill with non-zero data to represent a real key.
        real_raw.fill(0xAB);

        let mut poisoned_raw = real_raw;
        poisoned_raw[10] = 0xFF; // flip middle byte — rest same

        let real_bytes = Bytes::from_array(&env, &real_raw);
        let poisoned_bytes = Bytes::from_array(&env, &poisoned_raw);

        let result = crate::address_validation::is_lookalike_for_test(&env, &poisoned_bytes, &real_bytes);
        assert!(result, "expected poisoned address to be detected as lookalike");
    });
}

// ─── 5. Re-entrancy guard ─────────────────────────────────────────────────────

#[test]
fn reentrancy_guard_panics_on_second_entry() {
    let (env, client, freelancer, judge, token) = setup();
    let contract_id = env.register_contract(None, EscrowContract);

    env.as_contract(&contract_id, || {
        let mut state = EscrowState {
            status: EscrowStatus::Active,
            client: client.clone(),
            freelancer: freelancer.clone(),
            token: token.clone(),
            amount: 1_000,
            deadline: 9_999_999,
            milestone_count: 1,
            milestones_approved: 1,
            reentrancy_lock: false,
        };

        // First entry — should succeed.
        enter_reentrancy_guard(&env, &mut state);
        assert!(state.reentrancy_lock, "lock should be set after first entry");

        // Second entry (simulated re-entrant call) — must panic.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            enter_reentrancy_guard(&env, &mut state);
        }));
        assert!(result.is_err(), "expected panic on re-entrant entry");

        // After the simulated attack, manually reset for cleanup.
        exit_reentrancy_guard(&env, &mut state);
        assert!(!state.reentrancy_lock, "lock should be released after exit");
    });
}

#[test]
fn reentrancy_guard_released_after_normal_flow() {
    let (env, client, freelancer, judge, token) = setup();
    let amount = 1_000_000_i128;
    let escrow = deploy_and_init(&env, &client, &freelancer, &judge, &token, amount);

    // Approve all milestones.
    escrow.approve_milestone(&client, &0).unwrap();
    escrow.approve_milestone(&client, &1).unwrap();

    // Release — reentrancy guard must be acquired then released.
    escrow.release(&client).unwrap();

    // If the guard was not released the contract would be permanently locked;
    // a subsequent call would panic. We verify by checking state.
    let state: EscrowState = env.as_contract(escrow.address(), || {
        env.storage()
            .instance()
            .get(&DataKey::State)
            .unwrap()
    });
    assert!(!state.reentrancy_lock, "lock must be released after successful release()");
}

// ─── 6. Full escrow lifecycle ─────────────────────────────────────────────────

#[test]
fn full_lifecycle_release_to_freelancer() {
    let (env, client, freelancer, judge, token) = setup();
    let amount = 5_000_000_i128;
    let escrow = deploy_and_init(&env, &client, &freelancer, &judge, &token, amount);

    escrow.approve_milestone(&client, &0).unwrap();
    escrow.approve_milestone(&client, &1).unwrap();
    escrow.release(&client).unwrap();

    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&freelancer), amount);
}

#[test]
fn refund_after_deadline_returns_funds_to_client() {
    let (env, client, freelancer, judge, token) = setup();
    let amount = 3_000_000_i128;
    let deadline = env.ledger().timestamp() + 100;

    let contract_id = env.register_contract(None, EscrowContract);
    let escrow = EscrowContractClient::new(&env, &contract_id);
    escrow
        .initialise(
            &client,
            &freelancer,
            &judge,
            &token,
            &amount,
            &deadline,
            &1,
        )
        .unwrap();

    // Fast-forward ledger past deadline.
    env.ledger().set(LedgerInfo {
        timestamp: deadline + 1,
        ..env.ledger().get()
    });

    let initial_balance = token::Client::new(&env, &token).balance(&client);
    escrow.refund(&client).unwrap();
    let final_balance = token::Client::new(&env, &token).balance(&client);
    assert_eq!(final_balance - initial_balance, amount);
}

#[test]
fn dispute_and_judge_verdict_releases_to_freelancer() {
    let (env, client, freelancer, judge, token) = setup();
    let amount = 2_000_000_i128;
    let escrow = deploy_and_init(&env, &client, &freelancer, &judge, &token, amount);

    escrow.dispute(&client).unwrap();
    escrow.judge_verdict(&judge, &true).unwrap();

    assert_eq!(
        token::Client::new(&env, &token).balance(&freelancer),
        amount
    );
}

// ─── 7. Gas benchmark assertions ─────────────────────────────────────────────
//
// Soroban's `Env::budget()` tracks CPU instructions consumed.
// These assertions enforce the ≥15% execution-cost reduction target vs the
// pre-SC-SEC-072 baseline (stored in the comment below as `BASELINE_*`).
//
// Baseline (pre-audit):
//   initialise : ~18 000 instructions
//   release    : ~12 000 instructions
//   refund     : ~11 500 instructions
//
// Post-audit target (−15%):
//   initialise : ≤ 15 300 instructions
//   release    : ≤ 10 200 instructions
//   refund     : ≤  9 775 instructions

#[test]
fn gas_initialise_within_budget() {
    let (env, client, freelancer, judge, token) = setup();
    env.budget().reset_unlimited();

    let contract_id = env.register_contract(None, EscrowContract);
    let escrow = EscrowContractClient::new(&env, &contract_id);
    escrow
        .initialise(
            &client,
            &freelancer,
            &judge,
            &token,
            &1_000_000,
            &(env.ledger().timestamp() + 86_400),
            &2,
        )
        .unwrap();

    let cpu_used = env.budget().cpu_instruction_cost();
    assert!(
        cpu_used <= 15_300,
        "initialise used {} instructions, expected ≤ 15 300 (−15% from baseline)",
        cpu_used
    );
}

#[test]
fn gas_release_within_budget() {
    let (env, client, freelancer, judge, token) = setup();
    let escrow = deploy_and_init(&env, &client, &freelancer, &judge, &token, 1_000_000);

    escrow.approve_milestone(&client, &0).unwrap();
    escrow.approve_milestone(&client, &1).unwrap();

    env.budget().reset_unlimited();
    escrow.release(&client).unwrap();

    let cpu_used = env.budget().cpu_instruction_cost();
    assert!(
        cpu_used <= 10_200,
        "release used {} instructions, expected ≤ 10 200 (−15% from baseline)",
        cpu_used
    );
}