#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BadgeLevel {
    None = 0,
    Bronze = 1,
    Silver = 2,
    Gold = 3,
    Platinum = 4,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Profile {
    pub owner: Address,
    pub total_score: i128,
    pub review_count: u32,
    pub completed_jobs: u32,
    pub badge: BadgeLevel,
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DataKey {
    Admin,
    AuthorizedContract,
    Profile(Address),
}

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    pub fn initialize(env: Env, admin: Address, authorized_contract: Address) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedContract, &authorized_contract);
    }

    pub fn submit_review(env: Env, caller: Address, reviewee: Address, score: u32) {
        let authorized_contract: Address = env
            .storage()
            .persistent()
            .get(&DataKey::AuthorizedContract)
            .unwrap_or_else(|| panic!("unauthorized"));

        if caller != authorized_contract {
            panic!("unauthorized");
        }

        if score < 1 || score > 5 {
            panic!("invalid score");
        }

        let mut profile: Profile = env
            .storage()
            .persistent()
            .get(&DataKey::Profile(reviewee.clone()))
            .unwrap_or_else(|| Profile {
                owner: reviewee.clone(),
                total_score: 0,
                review_count: 0,
                completed_jobs: 0,
                badge: BadgeLevel::None,
            });

        profile.total_score = profile
            .total_score
            .checked_add(score as i128)
            .unwrap_or_else(|| panic!("overflow"));
        profile.review_count = profile
            .review_count
            .checked_add(1)
            .unwrap_or_else(|| panic!("overflow"));

        Self::upgrade_badge(&env, &mut profile);

        env.storage()
            .persistent()
            .set(&DataKey::Profile(reviewee), &profile);
    }

    pub fn complete_job(env: Env, caller: Address, freelancer: Address) {
        let authorized_contract: Address = env
            .storage()
            .persistent()
            .get(&DataKey::AuthorizedContract)
            .unwrap_or_else(|| panic!("unauthorized"));

        if caller != authorized_contract {
            panic!("unauthorized");
        }

        let mut profile: Profile = env
            .storage()
            .persistent()
            .get(&DataKey::Profile(freelancer.clone()))
            .unwrap_or_else(|| Profile {
                owner: freelancer.clone(),
                total_score: 0,
                review_count: 0,
                completed_jobs: 0,
                badge: BadgeLevel::None,
            });

        profile.completed_jobs = profile
            .completed_jobs
            .checked_add(1)
            .unwrap_or_else(|| panic!("overflow"));

        Self::upgrade_badge(&env, &mut profile);

        env.storage()
            .persistent()
            .set(&DataKey::Profile(freelancer), &profile);
    }

    pub fn get_profile(env: Env, address: Address) -> Profile {
        env.storage()
            .persistent()
            .get(&DataKey::Profile(address))
            .unwrap_or_else(|| panic!("profile not found"))
    }

    pub fn get_badge(env: Env, address: Address) -> BadgeLevel {
        let profile: Profile = env
            .storage()
            .persistent()
            .get(&DataKey::Profile(address))
            .unwrap_or_else(|| panic!("profile not found"));
        profile.badge
    }

    pub fn get_average_rating(env: Env, address: Address) -> i128 {
        let profile: Profile = env
            .storage()
            .persistent()
            .get(&DataKey::Profile(address))
            .unwrap_or_else(|| panic!("profile not found"));

        if profile.review_count == 0 {
            panic!("no reviews");
        }

        let total_score = profile.total_score;
        let review_count = profile.review_count as i128;

        let average = total_score
            .checked_mul(100)
            .unwrap_or_else(|| panic!("overflow"))
            .checked_div(review_count)
            .unwrap_or_else(|| panic!("overflow"));

        average
    }

    fn upgrade_badge(env: &Env, profile: &mut Profile) {
        if profile.review_count == 0 {
            return;
        }

        let total_score = profile.total_score;
        let review_count = profile.review_count as i128;
        let avg_rating = total_score
            .checked_mul(100)
            .unwrap_or_else(|| panic!("overflow"))
            .checked_div(review_count)
            .unwrap_or_else(|| panic!("overflow"));

        let completed_jobs = profile.completed_jobs;

        let new_badge = if completed_jobs >= 50 && avg_rating >= 400 {
            BadgeLevel::Platinum
        } else if completed_jobs >= 30 && avg_rating >= 400 {
            BadgeLevel::Gold
        } else if completed_jobs >= 15 && avg_rating >= 300 {
            BadgeLevel::Silver
        } else if completed_jobs >= 5 && avg_rating >= 300 {
            BadgeLevel::Bronze
        } else {
            BadgeLevel::None
        };

        if (new_badge as u32) > (profile.badge as u32) {
            profile.badge = new_badge;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as TestAddress;
    use soroban_sdk::Env;

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        let admin = TestAddress::random(&env);
        let authorized = TestAddress::random(&env);

        ReputationContract::initialize(env.clone(), admin.clone(), authorized.clone());

        (env, admin, authorized)
    }

    #[test]
    fn test_happy_path_bronze() {
        let (env, _admin, authorized) = setup();
        let freelancer = TestAddress::random(&env);

        for _ in 0..5 {
            ReputationContract::submit_review(
                env.clone(),
                authorized.clone(),
                freelancer.clone(),
                4,
            );
        }

        for _ in 0..5 {
            ReputationContract::complete_job(
                env.clone(),
                authorized.clone(),
                freelancer.clone(),
            );
        }

        let profile = ReputationContract::get_profile(env, freelancer);
        assert_eq!(profile.badge, BadgeLevel::Bronze);
    }

    #[test]
    fn test_happy_path_platinum() {
        let (env, _admin, authorized) = setup();
        let freelancer = TestAddress::random(&env);

        for _ in 0..50 {
            ReputationContract::complete_job(
                env.clone(),
                authorized.clone(),
                freelancer.clone(),
            );
        }

        for _ in 0..50 {
            ReputationContract::submit_review(
                env.clone(),
                authorized.clone(),
                freelancer.clone(),
                5,
            );
        }

        let profile = ReputationContract::get_profile(env, freelancer);
        assert_eq!(profile.badge, BadgeLevel::Platinum);
    }

    #[test]
    fn test_badge_does_not_downgrade() {
        let (env, _admin, authorized) = setup();
        let freelancer = TestAddress::random(&env);

        for _ in 0..30 {
            ReputationContract::complete_job(
                env.clone(),
                authorized.clone(),
                freelancer.clone(),
            );
        }

        for _ in 0..30 {
            ReputationContract::submit_review(
                env.clone(),
                authorized.clone(),
                freelancer.clone(),
                5,
            );
        }

        let profile = ReputationContract::get_profile(env.clone(), freelancer.clone());
        assert_eq!(profile.badge, BadgeLevel::Gold);

        for _ in 0..30 {
            ReputationContract::submit_review(
                env.clone(),
                authorized.clone(),
                freelancer.clone(),
                1,
            );
        }

        let profile = ReputationContract::get_profile(env, freelancer);
        assert_eq!(profile.badge, BadgeLevel::Gold);
    }

    #[test]
    #[should_panic(expected = "unauthorized")]
    fn test_unauthorized_submit_review() {
        let (env, _admin, _authorized) = setup();
        let freelancer = TestAddress::random(&env);
        let caller = TestAddress::random(&env);

        ReputationContract::submit_review(env, caller, freelancer, 4);
    }

    #[test]
    #[should_panic(expected = "invalid score")]
    fn test_invalid_score_too_high() {
        let (env, _admin, authorized) = setup();
        let freelancer = TestAddress::random(&env);

        ReputationContract::submit_review(env, authorized, freelancer, 6);
    }

    #[test]
    #[should_panic(expected = "invalid score")]
    fn test_invalid_score_zero() {
        let (env, _admin, authorized) = setup();
        let freelancer = TestAddress::random(&env);

        ReputationContract::submit_review(env, authorized, freelancer, 0);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize() {
        let env = Env::default();
        let admin = TestAddress::random(&env);
        let authorized = TestAddress::random(&env);

        ReputationContract::initialize(env.clone(), admin.clone(), authorized.clone());
        ReputationContract::initialize(env, admin, authorized);
    }

    #[test]
    fn test_get_average_rating() {
        let (env, _admin, authorized) = setup();
        let freelancer = TestAddress::random(&env);

        for _ in 0..4 {
            ReputationContract::submit_review(
                env.clone(),
                authorized.clone(),
                freelancer.clone(),
                4,
            );
        }

        let avg = ReputationContract::get_average_rating(env, freelancer);
        assert_eq!(avg, 400);
    }

    #[test]
    #[should_panic(expected = "profile not found")]
    fn test_profile_not_found() {
        let env = Env::default();
        let admin = TestAddress::random(&env);
        let authorized = TestAddress::random(&env);

        ReputationContract::initialize(env.clone(), admin, authorized);

        let nonexistent = TestAddress::random(&env);
        ReputationContract::get_profile(env, nonexistent);
    }

    #[test]
    fn test_silver_threshold() {
        let (env, _admin, authorized) = setup();
        let freelancer = TestAddress::random(&env);

        for _ in 0..15 {
            ReputationContract::complete_job(
                env.clone(),
                authorized.clone(),
                freelancer.clone(),
            );
        }

        for _ in 0..15 {
            ReputationContract::submit_review(
                env.clone(),
                authorized.clone(),
                freelancer.clone(),
                3,
            );
        }

        let profile = ReputationContract::get_profile(env, freelancer);
        assert_eq!(profile.badge, BadgeLevel::Silver);
    }
}

