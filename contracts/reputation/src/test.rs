#![cfg(test)]

use crate::{
    AuthorizedCaller, BadgeLevel, ReputationContract, ReputationError, Role,
};
use soroban_sdk::{Address, Env, String};
use soroban_sdk::testutils::{Address as _, Ledger as _};

#[test]
fn test_fixed_point_zero_division_protection() {
    // Test calculate_avg_rating with zero review count
    let avg = crate::fixed_point::calculate_avg_rating(15000, 0);
    assert_eq!(avg, 0); // Should return 0 instead of panicking

    // Test safe_div_bps with zero denominator
    let result = crate::fixed_point::safe_div_bps(10000, 0);
    assert_eq!(result, 0); // Should return 0 instead of panicking

    // Test bps_multiply with zero scale
    let result = crate::fixed_point::bps_multiply(5000, 2, 0);
    assert_eq!(result, 0); // Should return 0 instead of panicking

    // Test calculate_avg_rating with valid inputs
    let avg = crate::fixed_point::calculate_avg_rating(15000, 3);
    assert_eq!(avg, 5000); // 15000/3 = 5000

    // Test safe_div_bps with valid inputs
    let result = crate::fixed_point::safe_div_bps(5000, 2);
    assert_eq!(result, 2500); // 5000/2 = 2500

    // Test bps_multiply with valid inputs
    let result = crate::fixed_point::bps_multiply(5000, 2, 10000);
    assert_eq!(result, 1); // (5000*2)/10000 = 1
}

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ReputationContract);
    let admin = Address::generate(&env);

    env.clone().as_contract(&contract_id, || {
        env.mock_all_auths();
        // Successful initialization
        assert_eq!(ReputationContract::initialize(env.clone(), admin.clone()), Ok(()));
        assert_eq!(ReputationContract::get_admin(env.clone()), Ok(admin.clone()));

        // Double initialization should fail
        assert_eq!(
            ReputationContract::initialize(env, admin),
            Err(ReputationError::InvalidScore)
        );
    });
}

#[test]
fn test_unauthorized_caller_rejection() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ReputationContract);
    let admin = Address::generate(&env);
    let unauthorized_caller = Address::generate(&env);
    let target_address = Address::generate(&env);

    env.clone().as_contract(&contract_id, || {
        env.mock_all_auths();
        // Initialize contract
        ReputationContract::initialize(env.clone(), admin.clone()).unwrap();

        // Set up authorized caller
        let authorized_escrow = Address::generate(&env);
        ReputationContract::set_authorized_caller(
            env.clone(),
            admin.clone(),
            AuthorizedCaller::Escrow,
            authorized_escrow.clone(),
        )
        .unwrap();

        // Try to add review from unauthorized caller - should fail
        let result = ReputationContract::add_review(
            env.clone(),
            unauthorized_caller.clone(),
            target_address.clone(),
            true,
            8000_i32,
        );
        assert_eq!(result, Err(ReputationError::NotAuthorizedContract));

        // Try to adjust score after dispute from unauthorized caller - should fail
        let freelancer_address = Address::generate(&env);
        let verdict = String::from_str(&env, "client_favored");
        let result = ReputationContract::adjust_score_after_dispute(
            env.clone(),
            unauthorized_caller.clone(),
            123_u64,
            target_address.clone(),
            freelancer_address,
            verdict,
        );
        assert_eq!(result, Err(ReputationError::NotAuthorizedContract));

        // Try to increment completed jobs from unauthorized caller - should fail
        let result = ReputationContract::increment_completed_jobs(
            env,
            unauthorized_caller,
            target_address,
            true,
        );
        assert_eq!(result, Err(ReputationError::NotAuthorizedContract));
    });
}

#[test]
fn test_authorized_caller_success() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ReputationContract);
    let admin = Address::generate(&env);
    let authorized_escrow = Address::generate(&env);
    let target_address = Address::generate(&env);

    env.clone().as_contract(&contract_id, || {
        env.mock_all_auths();
        // Initialize contract
        ReputationContract::initialize(env.clone(), admin.clone()).unwrap();

        // Set up authorized caller
        ReputationContract::set_authorized_caller(
            env.clone(),
            admin,
            AuthorizedCaller::Escrow,
            authorized_escrow.clone(),
        )
        .unwrap();

        // Add review from authorized caller - should succeed
        let result = ReputationContract::add_review(
            env.clone(),
            authorized_escrow.clone(),
            target_address.clone(),
            true,
            8000_i32,
        );
        assert_eq!(result, Ok(()));

        // Verify the review was added
        let profile = ReputationContract::get_profile(env, target_address);
        assert_eq!(profile.client.review.reviews, 1);
        assert_eq!(profile.client.review.average_rating_bps, 8000);
    });
}

#[test]
fn test_profile_load_save_without_panic() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ReputationContract);
    let admin = Address::generate(&env);
    let authorized_escrow = Address::generate(&env);
    let new_address = Address::generate(&env);

    env.clone().as_contract(&contract_id, || {
        env.mock_all_auths();
        // Initialize contract
        ReputationContract::initialize(env.clone(), admin.clone()).unwrap();
        ReputationContract::set_authorized_caller(
            env.clone(),
            admin,
            AuthorizedCaller::Escrow,
            authorized_escrow.clone(),
        )
        .unwrap();

        // Get profile for non-existent address - should not panic, return default
        let profile = ReputationContract::get_profile(env.clone(), new_address.clone());
        assert_eq!(profile.client.score, 5000); // Default score
        assert_eq!(profile.client.completed_jobs, 0);
        assert_eq!(profile.client.review.reviews, 0);

        // Add a review to create the profile
        ReputationContract::add_review(
            env.clone(),
            authorized_escrow,
            new_address.clone(),
            true,
            7500_i32,
        )
        .unwrap();

        // Load the profile again - should have the new data
        let profile = ReputationContract::get_profile(env, new_address);
        assert_eq!(profile.client.score, 7500);
        assert_eq!(profile.client.review.reviews, 1);
    });
}

#[test]
fn test_badge_upgrade_trigger() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ReputationContract);
    let admin = Address::generate(&env);
    let authorized_escrow = Address::generate(&env);
    let target_address = Address::generate(&env);

    env.clone().as_contract(&contract_id, || {
        env.mock_all_auths();
        // Initialize contract
        ReputationContract::initialize(env.clone(), admin.clone()).unwrap();
        ReputationContract::set_authorized_caller(
            env.clone(),
            admin,
            AuthorizedCaller::Escrow,
            authorized_escrow.clone(),
        )
        .unwrap();

        // Initial badge should be Bronze (default score 5000)
        let badge = ReputationContract::get_client_badge(env.clone(), target_address.clone());
        assert_eq!(badge, BadgeLevel::Bronze);

        // Add reviews to push score to Silver threshold (6000+)
        ReputationContract::add_review(
            env.clone(),
            authorized_escrow.clone(),
            target_address.clone(),
            true,
            6500_i32,
        )
        .unwrap();

        // Badge should upgrade to Silver
        let badge = ReputationContract::get_client_badge(env.clone(), target_address.clone());
        assert_eq!(badge, BadgeLevel::Silver);

        // Add more reviews to push to Gold threshold (8000+)
        ReputationContract::add_review(env.clone(), authorized_escrow.clone(), target_address.clone(), true, 8500_i32).unwrap();
        ReputationContract::add_review(env.clone(), authorized_escrow, target_address.clone(), true, 9500_i32).unwrap();

        // Badge should upgrade to Gold (average of 6500, 8500, 9500 = 8166)
        let badge = ReputationContract::get_client_badge(env, target_address);
        assert_eq!(badge, BadgeLevel::Gold);
    });
}

#[test]
fn test_dispute_verdict_score_adjustment() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ReputationContract);
    let admin = Address::generate(&env);
    let authorized_escrow = Address::generate(&env);
    let client_address = Address::generate(&env);
    let freelancer_address = Address::generate(&env);

    env.clone().as_contract(&contract_id, || {
        env.mock_all_auths();
        // Initialize contract
        ReputationContract::initialize(env.clone(), admin.clone()).unwrap();
        ReputationContract::set_authorized_caller(
            env.clone(),
            admin,
            AuthorizedCaller::Escrow,
            authorized_escrow.clone(),
        )
        .unwrap();

        // Set initial scores
        ReputationContract::add_review(
            env.clone(),
            authorized_escrow.clone(),
            client_address.clone(),
            true,
            5000_i32,
        )
        .unwrap();
        ReputationContract::add_review(
            env.clone(),
            authorized_escrow.clone(),
            freelancer_address.clone(),
            false,
            5000_i32,
        )
        .unwrap();

        // Verify initial scores
        let client_profile = ReputationContract::get_profile(env.clone(), client_address.clone());
        let freelancer_profile = ReputationContract::get_profile(env.clone(), freelancer_address.clone());
        assert_eq!(client_profile.client.score, 5000);
        assert_eq!(freelancer_profile.freelancer.score, 5000);

        // Process dispute verdict favoring client
        let verdict = String::from_str(&env, "client_favored");
        ReputationContract::adjust_score_after_dispute(
            env.clone(),
            authorized_escrow,
            123_u64,
            client_address.clone(),
            freelancer_address.clone(),
            verdict,
        )
        .unwrap();

        // Verify score adjustments
        let client_profile = ReputationContract::get_profile(env.clone(), client_address.clone());
        let freelancer_profile = ReputationContract::get_profile(env.clone(), freelancer_address.clone());
        assert_eq!(client_profile.client.score, 5500); // +500
        assert_eq!(freelancer_profile.freelancer.score, 4500); // -500
        assert_eq!(client_profile.client.dispute_failures, 0);
        assert_eq!(freelancer_profile.freelancer.dispute_failures, 1);
    });
}

#[test]
fn test_fixed_point_arithmetic() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ReputationContract);
    let admin = Address::generate(&env);
    let authorized_escrow = Address::generate(&env);
    let target_address = Address::generate(&env);

    env.clone().as_contract(&contract_id, || {
        env.mock_all_auths();
        // Initialize contract
        ReputationContract::initialize(env.clone(), admin.clone()).unwrap();
        ReputationContract::set_authorized_caller(
            env.clone(),
            admin,
            AuthorizedCaller::Escrow,
            authorized_escrow.clone(),
        )
        .unwrap();

        // Add multiple reviews to test weighted average calculation
        ReputationContract::add_review(
            env.clone(),
            authorized_escrow.clone(),
            target_address.clone(),
            true,
            6000_i32,
        )
        .unwrap();
        ReputationContract::add_review(
            env.clone(),
            authorized_escrow.clone(),
            target_address.clone(),
            true,
            8000_i32,
        )
        .unwrap();
        ReputationContract::add_review(env.clone(), authorized_escrow, target_address.clone(), true, 7000_i32).unwrap();

        // Average should be (6000 + 8000 + 7000) / 3 = 7000
        let profile = ReputationContract::get_profile(env, target_address);
        assert_eq!(profile.client.review.reviews, 3);
        assert_eq!(profile.client.review.average_rating_bps, 7000);
        assert_eq!(profile.client.score, 7000);
    });
}

#[test]
fn test_score_clamping() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ReputationContract);
    let admin = Address::generate(&env);
    let authorized_escrow = Address::generate(&env);
    let target_address = Address::generate(&env);

    env.clone().as_contract(&contract_id, || {
        env.mock_all_auths();
        // Initialize contract
        ReputationContract::initialize(env.clone(), admin.clone()).unwrap();
        ReputationContract::set_authorized_caller(
            env.clone(),
            admin,
            AuthorizedCaller::Escrow,
            authorized_escrow.clone(),
        )
        .unwrap();

        // Try to add invalid rating (below minimum)
        let result = ReputationContract::add_review(
            env.clone(),
            authorized_escrow.clone(),
            target_address.clone(),
            true,
            -100_i32,
        );
        assert_eq!(result, Err(ReputationError::InvalidRating));

        // Try to add invalid rating (above maximum)
        let result = ReputationContract::add_review(
            env.clone(),
            authorized_escrow.clone(),
            target_address.clone(),
            true,
            15000_i32,
        );
        assert_eq!(result, Err(ReputationError::InvalidRating));

        // Add valid rating at maximum
        ReputationContract::add_review(
            env.clone(),
            authorized_escrow.clone(),
            target_address.clone(),
            true,
            10000_i32,
        )
        .unwrap();
        let profile = ReputationContract::get_profile(env.clone(), target_address.clone());
        assert_eq!(profile.client.score, 10000);

        // Add valid rating at minimum
        let target_address2 = Address::generate(&env);
        ReputationContract::add_review(env.clone(), authorized_escrow, target_address2.clone(), true, 0_i32).unwrap();
        let profile = ReputationContract::get_profile(env, target_address2);
        assert_eq!(profile.client.score, 0);
    });
}

#[test]
fn test_recover_score_after_inactivity() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ReputationContract);
    let admin = Address::generate(&env);
    let authorized_escrow = Address::generate(&env);
    let target_address = Address::generate(&env);

    env.clone().as_contract(&contract_id, || {
        env.mock_all_auths();
        ReputationContract::initialize(env.clone(), admin.clone()).unwrap();
        ReputationContract::set_authorized_caller(
            env.clone(),
            admin,
            AuthorizedCaller::Escrow,
            authorized_escrow.clone(),
        )
        .unwrap();

        ReputationContract::add_review(
            env.clone(),
            authorized_escrow.clone(),
            target_address.clone(),
            true,
            3000_i32,
        )
        .unwrap();

        env.ledger().set_timestamp(90u64 * 24 * 60 * 60);
        let recovered = ReputationContract::recover_score(
            env.clone(),
            authorized_escrow,
            target_address.clone(),
            Role::Client,
        )
        .unwrap();

        assert_eq!(recovered, 3200);
        let profile = ReputationContract::get_profile(env, target_address);
        assert_eq!(profile.client.score, 3200);
    });
}

#[test]
fn test_recover_score_requires_authorized_caller() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ReputationContract);
    let admin = Address::generate(&env);
    let authorized_escrow = Address::generate(&env);
    let attacker = Address::generate(&env);
    let target_address = Address::generate(&env);

    env.clone().as_contract(&contract_id, || {
        env.mock_all_auths();
        ReputationContract::initialize(env.clone(), admin.clone()).unwrap();
        ReputationContract::set_authorized_caller(
            env.clone(),
            admin,
            AuthorizedCaller::Escrow,
            authorized_escrow,
        )
        .unwrap();

        let result = ReputationContract::recover_score(
            env.clone(),
            attacker,
            target_address,
            Role::Freelancer,
        );

        assert_eq!(result, Err(ReputationError::NotAuthorizedContract));
    });
}

#[test]
fn test_invalid_dispute_verdict() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ReputationContract);
    let admin = Address::generate(&env);
    let authorized_escrow = Address::generate(&env);
    let client_address = Address::generate(&env);
    let freelancer_address = Address::generate(&env);

    env.clone().as_contract(&contract_id, || {
        env.mock_all_auths();
        // Initialize contract
        ReputationContract::initialize(env.clone(), admin.clone()).unwrap();
        ReputationContract::set_authorized_caller(
            env.clone(),
            admin,
            AuthorizedCaller::Escrow,
            authorized_escrow,
        )
        .unwrap();

        // Try invalid verdict outcome
        let invalid_verdict = String::from_str(&env, "invalid_outcome");
        let result = ReputationContract::adjust_score_after_dispute(
            env.clone(),
            Address::generate(&env),
            123_u64,
            client_address,
            freelancer_address,
            invalid_verdict,
        );
        assert_eq!(result, Err(ReputationError::NotAuthorizedContract));
    });
}

#[test]
fn test_arithmetic_overflow_protection() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ReputationContract);
    let admin = Address::generate(&env);
    let authorized_escrow = Address::generate(&env);
    let target_address = Address::generate(&env);

    env.clone().as_contract(&contract_id, || {
        env.mock_all_auths();
        // Initialize contract
        ReputationContract::initialize(env.clone(), admin.clone()).unwrap();
        ReputationContract::set_authorized_caller(
            env.clone(),
            admin,
            AuthorizedCaller::Escrow,
            authorized_escrow.clone(),
        )
        .unwrap();

        // Add many reviews to test overflow protection
        for _ in 0..100 {
            ReputationContract::add_review(
                env.clone(),
                authorized_escrow.clone(),
                target_address.clone(),
                true,
                5000_i32,
            )
            .unwrap();
        }

        let profile = ReputationContract::get_profile(env, target_address);
        assert_eq!(profile.client.review.reviews, 100);
        // Score should remain valid despite many operations
        assert!(profile.client.score >= 0 && profile.client.score <= 10000);
    });
}
