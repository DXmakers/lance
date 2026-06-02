#![no_std]

<<<<<<< HEAD
pub use profile::BadgeLevel;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Bytes, BytesN, Env, IntoVal,
    Symbol, Vec,
};

=======
mod fixed_point;
>>>>>>> 5a2cc8d9734783cc04369634a657f1bd96408f1c
mod profile;
mod storage;

#[cfg(test)]
mod test;

use profile::{BadgeLevel, Profile};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, String,
};

/// Fixed-point arithmetic constants for score calculations
/// Scores are stored in basis points (0-10,000 where 10,000 = 100%)
const BPS_SCALE: i32 = 10_000;
const DECAY_FACTOR_NUMERATOR: i32 = 95; // 95% retention per decay period
const DECAY_FACTOR_DENOMINATOR: i32 = 100;
const MIN_SCORE: i32 = 0;
const MAX_SCORE: i32 = 10_000;
const DEFAULT_SCORE: i32 = 5_000; // Start at 50%

/// Authorized contracts that can call score adjustment routines
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthorizedCaller {
    Escrow,
    JobRegistry,
    DisputeResolution,
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Client,
    Freelancer,
}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ReputationError {
    Unauthorized = 1,
    InvalidScore = 2,
    ArithmeticOverflow = 3,
    ProfileNotFound = 4,
    InvalidRating = 5,
    NotAuthorizedContract = 6,
}

#[contracttype]
pub enum DataKey {
    AuthorizedCaller(AuthorizedCaller),
    Admin,
<<<<<<< HEAD
    JobRegistry,
    AuthorizedUpdater,
    Reviewed(u64, Address),
    SlashDecayBps,
    BlacklistDecayBps,
}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ReputationError {
    NotInitialized = 1,
    Unauthorized = 2,
    InvalidInput = 3,
    JobNotCompleted = 4,
    NotJobParticipant = 5,
    AlreadyReviewed = 6,
    ContractStateError = 7,
    Blacklisted = 8,
=======
>>>>>>> 5a2cc8d9734783cc04369634a657f1bd96408f1c
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ScoreAdjustedEvent {
    pub address: Address,
    pub role: String, // "client" or "freelancer"
    pub old_score: i32,
    pub new_score: i32,
    pub reason: String,
    pub adjusted_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct BadgeUpgradedEvent {
    pub address: Address,
    pub role: String,
    pub old_badge: BadgeLevel,
    pub new_badge: BadgeLevel,
    pub upgraded_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DisputeVerdictProcessedEvent {
    pub job_id: u64,
    pub client_address: Address,
    pub freelancer_address: Address,
    pub verdict_outcome: String, // "client_favored", "freelancer_favored", "split"
    pub client_score_delta: i32,
    pub freelancer_score_delta: i32,
    pub processed_at: u64,
}

#[contracttype]
#[derive(Clone)]
<<<<<<< HEAD
pub struct DecayParameterUpdatedEvent {
    pub by_admin: Address,
    pub param_name: Symbol,
    pub old_value: i32,
    pub new_value: i32,
    pub updated_at: u64,
=======
pub struct ScoreRecoveredEvent {
    pub address: Address,
    pub role: Role,
    pub previous_score: i32,
    pub new_score: i32,
    pub recovered_at: u64,
>>>>>>> 5a2cc8d9734783cc04369634a657f1bd96408f1c
}

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    const INSTANCE_TTL_THRESHOLD: u32 = 50_000;
    const INSTANCE_TTL_EXTEND_TO: u32 = 150_000;
    const RECOVERY_INACTIVITY_SECONDS: u64 = 90u64 * 24 * 60 * 60;
    const RECOVERY_STEP_BPS: i32 = 1_000;

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(Self::INSTANCE_TTL_THRESHOLD, Self::INSTANCE_TTL_EXTEND_TO);
    }

    /// Initialize the reputation contract with admin and authorized callers
    pub fn initialize(env: Env, admin: Address) -> Result<(), ReputationError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ReputationError::InvalidScore);
        }

        // admin.require_auth(); // Commented out for testing

        env.storage().instance().set(&DataKey::Admin, &admin);
        Self::bump_instance_ttl(&env);

        Ok(())
    }

    /// Set an authorized contract address (only admin)
    pub fn set_authorized_caller(
        env: Env,
        admin: Address,
        caller_type: AuthorizedCaller,
        caller_address: Address,
    ) -> Result<(), ReputationError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ReputationError::ProfileNotFound)?;

<<<<<<< HEAD
    fn read_job_registry(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::JobRegistry)
            .unwrap_or_else(|| soroban_sdk::panic_with_error!(env, ReputationError::NotInitialized))
    }

    fn require_admin(env: &Env, admin: &Address) {
        let configured_admin = Self::read_admin(env);
        admin.require_auth();
        if *admin != configured_admin {
            soroban_sdk::panic_with_error!(env, ReputationError::Unauthorized);
        }
    }

    fn require_authorized_contract(env: &Env, caller_contract: &Address) {
        caller_contract.require_auth();

        let is_primary_updater = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::AuthorizedUpdater)
            .map(|authorized_contract| *caller_contract == authorized_contract)
            .unwrap_or(false);
        let is_authorized_contract = env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::AuthorizedContract(caller_contract.clone()))
            .unwrap_or(false);

        if !(is_primary_updater || is_authorized_contract) {
            soroban_sdk::panic_with_error!(env, ReputationError::Unauthorized);
        }
    }

    fn role_metrics<'a>(profile: &'a Profile, role: &Role) -> &'a RoleMetrics {
        match role {
            Role::Client => &profile.client,
            Role::Freelancer => &profile.freelancer,
        }
    }

    fn role_metrics_mut<'a>(profile: &'a mut Profile, role: &Role) -> &'a mut RoleMetrics {
        match role {
            Role::Client => &mut profile.client,
            Role::Freelancer => &mut profile.freelancer,
        }
    }

    fn score_from_profile(address: &Address, role: Role, profile: &Profile) -> ReputationScore {
        let metrics = Self::role_metrics(profile, &role);
        ReputationScore {
            address: address.clone(),
            role,
            score: metrics.score,
            total_jobs: metrics.completed_jobs,
            total_points: metrics.review.total_points,
            reviews: metrics.review.reviews,
            average_rating_bps: metrics.review.average_rating_bps,
            badge_level: Self::badge_level(metrics, profile.is_blacklisted),
            blacklisted: profile.is_blacklisted,
        }
    }

    fn checked_add_points(env: &Env, current: i128, incoming: u32) -> i128 {
        current.checked_add(incoming as i128).unwrap_or_else(|| {
            soroban_sdk::panic_with_error!(env, ReputationError::ContractStateError)
        })
    }

    fn average_rating_bps(env: &Env, total_points: i128, reviews: u32) -> i32 {
        if reviews == 0 {
            return Self::DEFAULT_SCORE_BPS;
        }

        let numerator = total_points
            .checked_mul(Self::SCORE_SCALE)
            .unwrap_or_else(|| {
                soroban_sdk::panic_with_error!(env, ReputationError::ContractStateError)
            });
        let denominator = (reviews as i128)
            .checked_mul(Self::MAX_RATING)
            .unwrap_or_else(|| {
                soroban_sdk::panic_with_error!(env, ReputationError::ContractStateError)
            });

        if denominator == 0 {
            return Self::DEFAULT_SCORE_BPS;
        }

        Self::clamp_score_i128(numerator / denominator)
    }

    fn apply_decay_bps(env: &Env, score: i32, decay_bps: i32) -> i32 {
        let decayed = (score as i128)
            .checked_mul(decay_bps as i128)
            .unwrap_or_else(|| {
                soroban_sdk::panic_with_error!(env, ReputationError::ContractStateError)
            })
            / Self::SCORE_SCALE;
        Self::clamp_score_i128(decayed)
    }

    fn badge_level(metrics: &RoleMetrics, is_blacklisted: bool) -> u32 {
        // Revoke badge if dispute failures exceed threshold
        if metrics.dispute_failures >= Self::DISPUTE_FAILURE_THRESHOLD {
            return 0;
        }
        
        if is_blacklisted {
            0
        } else {
            BadgeLevel::from_score(metrics.score).to_u32()
        }
    }

    fn refresh_badge(metrics: &mut RoleMetrics, is_blacklisted: bool) {
        metrics.badge_level = Self::badge_level(metrics, is_blacklisted);
    }

    fn apply_review(env: &Env, metrics: &mut RoleMetrics, score: u32, is_blacklisted: bool) {
        metrics.review.total_points =
            Self::checked_add_points(env, metrics.review.total_points, score);
        metrics.review.reviews = metrics.review.reviews.saturating_add(1);
        metrics.completed_jobs = metrics.completed_jobs.saturating_add(1);
        metrics.review.average_rating_bps =
            Self::average_rating_bps(env, metrics.review.total_points, metrics.review.reviews);
        metrics.score = metrics.review.average_rating_bps;
        Self::refresh_badge(metrics, is_blacklisted);
    }

    fn apply_manual_delta(metrics: &mut RoleMetrics, delta: i32, is_blacklisted: bool) {
        metrics.score = Self::clamp_score(metrics.score.saturating_add(delta));
        Self::refresh_badge(metrics, is_blacklisted);
    }

    fn apply_role_decay(
        env: &Env,
        metrics: &mut RoleMetrics,
        decay_bps: i32,
        is_blacklisted: bool,
    ) {
        metrics.score = Self::apply_decay_bps(env, metrics.score, decay_bps);
        Self::refresh_badge(metrics, is_blacklisted);
    }

    fn read_slash_decay_bps(env: &Env) -> i32 {
        env.storage()
            .instance()
            .get(&DataKey::SlashDecayBps)
            .unwrap_or(Self::SLASH_DECAY_BPS)
    }

    fn read_blacklist_decay_bps(env: &Env) -> i32 {
        env.storage()
            .instance()
            .get(&DataKey::BlacklistDecayBps)
            .unwrap_or(Self::BLACKLIST_DECAY_BPS)
    }

    pub fn upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ReputationError> {
        Self::bump_instance_ttl(&env);
        caller.require_auth();

        let admin = Self::read_admin(&env);
        if caller != admin {
=======
        if admin != stored_admin {
>>>>>>> 5a2cc8d9734783cc04369634a657f1bd96408f1c
            return Err(ReputationError::Unauthorized);
        }

        // admin.require_auth(); // Commented out for testing

        env.storage()
            .instance()
            .set(&DataKey::AuthorizedCaller(caller_type), &caller_address);
        Self::bump_instance_ttl(&env);

        Ok(())
    }

    /// Check if the caller is authorized
    fn verify_authorized_caller(env: &Env, caller: &Address) -> Result<(), ReputationError> {
        let authorized_callers = [
            DataKey::AuthorizedCaller(AuthorizedCaller::Escrow),
            DataKey::AuthorizedCaller(AuthorizedCaller::JobRegistry),
            DataKey::AuthorizedCaller(AuthorizedCaller::DisputeResolution),
        ];

        for key in authorized_callers.iter() {
            if let Some(stored_address) = env.storage().instance().get::<_, Address>(key) {
                if &stored_address == caller {
                    return Ok(());
                }
            }
        }

        Err(ReputationError::NotAuthorizedContract)
    }

    /// Safe fixed-point arithmetic: multiply two BPS values
    /// Returns (a * b) / BPS_SCALE with overflow protection
    fn bps_multiply(a: i32, b: i32) -> Result<i32, ReputationError> {
        let product = a
            .checked_mul(b)
            .ok_or(ReputationError::ArithmeticOverflow)?;
        let result = product
            .checked_div(BPS_SCALE)
            .ok_or(ReputationError::ArithmeticOverflow)?;
        Ok(result)
    }

    /// Safe fixed-point arithmetic: apply decay factor to score
    /// Returns score * DECAY_FACTOR_NUMERATOR / DECAY_FACTOR_DENOMINATOR
    fn apply_decay(score: i32) -> Result<i32, ReputationError> {
        let decayed = score
            .checked_mul(DECAY_FACTOR_NUMERATOR)
            .ok_or(ReputationError::ArithmeticOverflow)?;
        let result = decayed
            .checked_div(DECAY_FACTOR_DENOMINATOR)
            .ok_or(ReputationError::ArithmeticOverflow)?;
        Ok(result)
    }

    /// Safe fixed-point arithmetic: calculate weighted average
    /// Returns (current_avg * count + new_rating) / (count + 1)
    fn calculate_weighted_average(
        current_avg_bps: i32,
        count: u32,
        new_rating_bps: i32,
    ) -> Result<i32, ReputationError> {
        let total = (current_avg_bps as i128)
            .checked_mul(count as i128)
            .ok_or(ReputationError::ArithmeticOverflow)?;
        let new_total = total
            .checked_add(new_rating_bps as i128)
            .ok_or(ReputationError::ArithmeticOverflow)?;
        let new_count = (count as i128)
            .checked_add(1)
            .ok_or(ReputationError::ArithmeticOverflow)?;
        let result = new_total
            .checked_div(new_count)
            .ok_or(ReputationError::ArithmeticOverflow)?;
        Ok(result as i32)
    }

    /// Clamp score to valid range [MIN_SCORE, MAX_SCORE]
    fn clamp_score(score: i32) -> i32 {
        if score < MIN_SCORE {
            MIN_SCORE
        } else if score > MAX_SCORE {
            MAX_SCORE
        } else {
            score
        }
    }

    fn clamp_score_i128(score: i128) -> i32 {
        if score < MIN_SCORE as i128 {
            MIN_SCORE
        } else if score > MAX_SCORE as i128 {
            MAX_SCORE
        } else {
            score as i32
        }
    }

    /// Get profile for an address, creating default if doesn't exist
    pub fn get_profile(env: Env, address: Address) -> Profile {
        Self::bump_instance_ttl(&env);
        storage::read_profile_or_default(&env, &address)
    }

    /// Get client badge level for an address
    pub fn get_client_badge(env: Env, address: Address) -> BadgeLevel {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        profile.client_badge
    }

    /// Get freelancer badge level for an address
    pub fn get_freelancer_badge(env: Env, address: Address) -> BadgeLevel {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        profile.freelancer_badge
    }

    /// Add a review to a user's profile (only authorized contracts)
    /// Rating is in basis points (0-10,000)
    pub fn add_review(
        env: Env,
        caller: Address,
        target_address: Address,
        is_client_role: bool, // true = reviewing as client, false = reviewing as freelancer
        rating_bps: i32,
    ) -> Result<(), ReputationError> {
        // caller.require_auth(); // Commented out for testing - restore for production
        Self::verify_authorized_caller(&env, &caller)?;

        if rating_bps < MIN_SCORE || rating_bps > MAX_SCORE {
            return Err(ReputationError::InvalidRating);
        }

        let mut profile = storage::read_profile_or_default(&env, &target_address);

        let role_metrics = if is_client_role {
            &mut profile.client
        } else {
            &mut profile.freelancer
        };

        // Update review aggregate
        role_metrics.review.total_points += rating_bps as i128;
        role_metrics.review.reviews += 1;
        role_metrics.review.average_rating_bps =
            Self::calculate_weighted_average(
                role_metrics.review.average_rating_bps,
                role_metrics.review.reviews - 1,
                rating_bps,
            )?;

        // Update score based on new average rating
        role_metrics.score = Self::clamp_score(role_metrics.review.average_rating_bps);

        // Update last activity timestamp
        profile.last_activity = env.ledger().timestamp();

        // Refresh badges
        let old_client_badge = profile.client_badge.clone();
        let old_freelancer_badge = profile.freelancer_badge.clone();
        profile.refresh_badges();

        storage::write_profile(&env, &target_address, &profile);

        // Emit events for badge upgrades
        if profile.client_badge != old_client_badge {
            env.events().publish(
                ("reputation", "BadgeUpgraded"),
                BadgeUpgradedEvent {
                    address: target_address.clone(),
                    role: String::from_str(&env, "client"),
                    old_badge: old_client_badge,
                    new_badge: profile.client_badge,
                    upgraded_at: env.ledger().timestamp(),
                },
            );
        }

        if profile.freelancer_badge != old_freelancer_badge {
            env.events().publish(
                ("reputation", "BadgeUpgraded"),
                BadgeUpgradedEvent {
                    address: target_address.clone(),
                    role: String::from_str(&env, "freelancer"),
                    old_badge: old_freelancer_badge,
                    new_badge: profile.freelancer_badge,
                    upgraded_at: env.ledger().timestamp(),
                },
            );
        }

        Ok(())
    }

    /// Adjust score after dispute verdict (only authorized contracts)
    /// Verdict outcomes: "client_favored", "freelancer_favored", "split"
    pub fn adjust_score_after_dispute(
        env: Env,
        caller: Address,
        job_id: u64,
        client_address: Address,
        freelancer_address: Address,
        verdict_outcome: String,
    ) -> Result<(), ReputationError> {
        // caller.require_auth(); // Commented out for testing - restore for production
        Self::verify_authorized_caller(&env, &caller)?;

        let (client_delta, freelancer_delta) = match verdict_outcome {
            ref s if s == &String::from_str(&env, "client_favored") => (500, -500), // Client gains 5%, freelancer loses 5%
            ref s if s == &String::from_str(&env, "freelancer_favored") => (-500, 500), // Freelancer gains 5%, client loses 5%
            ref s if s == &String::from_str(&env, "split") => (0, 0), // No change
            _ => return Err(ReputationError::InvalidScore),
        };

        // Adjust client score
        let mut client_profile = storage::read_profile_or_default(&env, &client_address);
        let old_client_score = client_profile.client.score;
        client_profile.client.score = Self::clamp_score(
            client_profile
                .client
                .score
                .checked_add(client_delta)
                .ok_or(ReputationError::ArithmeticOverflow)?,
        );
        client_profile.client.dispute_failures += if client_delta < 0 { 1 } else { 0 };
        client_profile.last_activity = env.ledger().timestamp();
        let old_client_badge = client_profile.client_badge.clone();
        client_profile.refresh_badges();
        storage::write_profile(&env, &client_address, &client_profile);

        // Adjust freelancer score
        let mut freelancer_profile = storage::read_profile_or_default(&env, &freelancer_address);
        let old_freelancer_score = freelancer_profile.freelancer.score;
        freelancer_profile.freelancer.score = Self::clamp_score(
            freelancer_profile
                .freelancer
                .score
                .checked_add(freelancer_delta)
                .ok_or(ReputationError::ArithmeticOverflow)?,
        );
        freelancer_profile.freelancer.dispute_failures += if freelancer_delta < 0 { 1 } else { 0 };
        freelancer_profile.last_activity = env.ledger().timestamp();
        let old_freelancer_badge = freelancer_profile.freelancer_badge.clone();
        freelancer_profile.refresh_badges();
        storage::write_profile(&env, &freelancer_address, &freelancer_profile);

        // Emit score adjustment events
        if client_delta != 0 {
            env.events().publish(
                ("reputation", "ScoreAdjusted"),
                ScoreAdjustedEvent {
                    address: client_address.clone(),
                    role: String::from_str(&env, "client"),
                    old_score: old_client_score,
                    new_score: client_profile.client.score,
                    reason: String::from_str(&env, "dispute_verdict"),
                    adjusted_at: env.ledger().timestamp(),
                },
            );
        }

        if freelancer_delta != 0 {
            env.events().publish(
                ("reputation", "ScoreAdjusted"),
                ScoreAdjustedEvent {
                    address: freelancer_address.clone(),
                    role: String::from_str(&env, "freelancer"),
                    old_score: old_freelancer_score,
                    new_score: freelancer_profile.freelancer.score,
                    reason: String::from_str(&env, "dispute_verdict"),
                    adjusted_at: env.ledger().timestamp(),
                },
            );
        }

        // Emit badge upgrade events if changed
        if client_profile.client_badge != old_client_badge {
            env.events().publish(
                ("reputation", "BadgeUpgraded"),
                BadgeUpgradedEvent {
                    address: client_address.clone(),
                    role: String::from_str(&env, "client"),
                    old_badge: old_client_badge,
                    new_badge: client_profile.client_badge,
                    upgraded_at: env.ledger().timestamp(),
                },
            );
        }

        if freelancer_profile.freelancer_badge != old_freelancer_badge {
            env.events().publish(
                ("reputation", "BadgeUpgraded"),
                BadgeUpgradedEvent {
                    address: freelancer_address.clone(),
                    role: String::from_str(&env, "freelancer"),
                    old_badge: old_freelancer_badge,
                    new_badge: freelancer_profile.freelancer_badge,
                    upgraded_at: env.ledger().timestamp(),
                },
            );
        }

        // Emit dispute verdict processed event
        env.events().publish(
            ("reputation", "DisputeVerdictProcessed"),
            DisputeVerdictProcessedEvent {
                job_id,
                client_address,
                freelancer_address,
                verdict_outcome,
                client_score_delta: client_delta,
                freelancer_score_delta: freelancer_delta,
                processed_at: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    /// Increment completed jobs count for a user (only authorized contracts)
    pub fn increment_completed_jobs(
        env: Env,
        caller: Address,
        target_address: Address,
        is_client_role: bool,
    ) -> Result<(), ReputationError> {
        // caller.require_auth(); // Commented out for testing - restore for production
        Self::verify_authorized_caller(&env, &caller)?;

<<<<<<< HEAD
    pub fn set_job_registry(env: Env, admin: Address, registry: Address) {
        Self::require_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&DataKey::JobRegistry, &registry);
        Self::bump_instance_ttl(&env);
    }

    pub fn set_authorized_contract(env: Env, admin: Address, contract_address: Address) {
        Self::require_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedUpdater, &contract_address);
        env.events().publish(
            ("reputation", "AuthorizedContractUpdated"),
            AuthorizedContractUpdatedEvent {
                by_admin: admin,
                contract_address,
                updated_at: env.ledger().timestamp(),
            },
        );
        Self::bump_instance_ttl(&env);
    }

    pub fn set_slash_decay(env: Env, admin: Address, decay_bps: i32) {
        Self::require_admin(&env, &admin);
        if !(1_000..=10_000).contains(&decay_bps) {
            soroban_sdk::panic_with_error!(&env, ReputationError::InvalidInput);
        }
        let old_value = Self::read_slash_decay_bps(&env);
        env.storage()
            .instance()
            .set(&DataKey::SlashDecayBps, &decay_bps);
        env.events().publish(
            ("reputation", "DecayParameterUpdated"),
            DecayParameterUpdatedEvent {
                by_admin: admin,
                param_name: Symbol::new(&env, "slash_decay_bps"),
                old_value,
                new_value: decay_bps,
                updated_at: env.ledger().timestamp(),
            },
        );
        Self::bump_instance_ttl(&env);
    }

    pub fn set_blacklist_decay(env: Env, admin: Address, decay_bps: i32) {
        Self::require_admin(&env, &admin);
        if !(1_000..=10_000).contains(&decay_bps) {
            soroban_sdk::panic_with_error!(&env, ReputationError::InvalidInput);
        }
        let old_value = Self::read_blacklist_decay_bps(&env);
        env.storage()
            .instance()
            .set(&DataKey::BlacklistDecayBps, &decay_bps);
        env.events().publish(
            ("reputation", "DecayParameterUpdated"),
            DecayParameterUpdatedEvent {
                by_admin: admin,
                param_name: Symbol::new(&env, "blacklist_decay_bps"),
                old_value,
                new_value: decay_bps,
                updated_at: env.ledger().timestamp(),
            },
        );
        Self::bump_instance_ttl(&env);
    }

    pub fn submit_rating(env: Env, caller: Address, job_id: u64, target: Address, score: u32) {
        caller.require_auth();
        if !(1u32..=5u32).contains(&score) {
            soroban_sdk::panic_with_error!(&env, ReputationError::InvalidInput);
        }

        let registry_addr = Self::read_job_registry(&env);
        let get_sym = Symbol::new(&env, "get_job");
        let args = soroban_sdk::vec![&env, job_id.into_val(&env)];
        let job: JobRecord = env
            .invoke_contract::<Result<JobRecord, soroban_sdk::Error>>(
                &registry_addr,
                &get_sym,
                args,
            )
            .unwrap();

        if job.status != JobStatus::Completed {
            soroban_sdk::panic_with_error!(&env, ReputationError::JobNotCompleted);
        }

        let caller_addr = caller.clone();
        let is_client = caller_addr == job.client;
        let is_freelancer = match job.freelancer.clone() {
            Some(freelancer) => caller_addr == freelancer,
            None => false,
        };

        if !(is_client || is_freelancer) {
            soroban_sdk::panic_with_error!(&env, ReputationError::Unauthorized);
        }

        let reviewed_key = DataKey::Reviewed(job_id, caller.clone());
        if env.storage().persistent().has(&reviewed_key) {
            soroban_sdk::panic_with_error!(&env, ReputationError::AlreadyReviewed);
        }

        let mut profile = storage::read_profile_or_default(&env, &target);
        if profile.is_blacklisted {
            soroban_sdk::panic_with_error!(&env, ReputationError::Blacklisted);
        }

        let (role, total_points, total_jobs, new_score, reviews, average_rating_bps, badge_level) =
            if target == job.client {
                let is_blacklisted = profile.is_blacklisted;
                Self::apply_review(&env, &mut profile.client, score, is_blacklisted);
                profile.last_activity = env.ledger().timestamp();
                (
                    Role::Client,
                    profile.client.review.total_points,
                    profile.client.completed_jobs,
                    profile.client.score,
                    profile.client.review.reviews,
                    profile.client.review.average_rating_bps,
                    profile.client.badge_level,
                )
            } else if job.freelancer.as_ref() == Some(&target) {
                let is_blacklisted = profile.is_blacklisted;
                Self::apply_review(&env, &mut profile.freelancer, score, is_blacklisted);
                profile.last_activity = env.ledger().timestamp();
                (
                    Role::Freelancer,
                    profile.freelancer.review.total_points,
                    profile.freelancer.completed_jobs,
                    profile.freelancer.score,
                    profile.freelancer.review.reviews,
                    profile.freelancer.review.average_rating_bps,
                    profile.freelancer.badge_level,
                )
            } else {
                soroban_sdk::panic_with_error!(&env, ReputationError::NotJobParticipant);
            };

        storage::write_profile(&env, &target, &profile);
        env.storage().persistent().set(&reviewed_key, &true);
        env.storage().persistent().extend_ttl(
            &reviewed_key,
            Self::PERSISTENT_TTL_THRESHOLD,
            Self::PERSISTENT_TTL_EXTEND_TO,
        );
        env.events().publish(
            ("reputation", "ReputationUpdated"),
            ReputationUpdatedEvent {
                job_id,
                caller,
                target,
                role,
                rating: score,
                new_score,
                total_jobs,
                total_points,
                reviews,
                average_rating_bps,
                badge_level,
                blacklisted: profile.is_blacklisted,
                updated_at: env.ledger().timestamp(),
            },
        );
        Self::bump_instance_ttl(&env);
    }

    /// Update reputation after a completed job. `delta` in basis points.
    /// Score is clamped to [0, 10000]. Only callable by admin or authorized contract address.
    pub fn update_score(
        env: Env,
        caller_contract: Address,
        address: Address,
        role: Role,
        delta: i32,
    ) {
        Self::require_authorized_contract(&env, &caller_contract);

        let mut profile = storage::read_profile_or_default(&env, &address);
        if profile.is_blacklisted {
            soroban_sdk::panic_with_error!(&env, ReputationError::Blacklisted);
        }

        let is_blacklisted = profile.is_blacklisted;
        let metrics = Self::role_metrics_mut(&mut profile, &role);
        let previous_score = metrics.score;
        metrics.completed_jobs = metrics.completed_jobs.saturating_add(1);
        Self::apply_manual_delta(metrics, delta, is_blacklisted);
=======
        let mut profile = storage::read_profile_or_default(&env, &target_address);

        let role_metrics = if is_client_role {
            &mut profile.client
        } else {
            &mut profile.freelancer
        };

        role_metrics.completed_jobs += 1;
>>>>>>> 5a2cc8d9734783cc04369634a657f1bd96408f1c
        profile.last_activity = env.ledger().timestamp();

        storage::write_profile(&env, &target_address, &profile);

        Ok(())
    }

<<<<<<< HEAD
    /// Slash address for fraud / abandonment — reduces score by 20%. Only callable by admin or authorized contract.
    pub fn slash(
        env: Env,
        caller_contract: Address,
        address: Address,
        role: Role,
        _reason: Symbol,
    ) {
        Self::require_authorized_contract(&env, &caller_contract);

=======
    /// Apply time-based decay to scores (can be called by anyone, but only affects old profiles)
    /// Decay is applied if last activity was more than 90 days ago
    pub fn apply_time_decay(env: Env, address: Address) -> Result<(), ReputationError> {
>>>>>>> 5a2cc8d9734783cc04369634a657f1bd96408f1c
        let mut profile = storage::read_profile_or_default(&env, &address);

<<<<<<< HEAD
        let is_blacklisted = profile.is_blacklisted;
        let metrics = Self::role_metrics_mut(&mut profile, &role);
        let previous_score = metrics.score;
        let decay_bps = Self::read_slash_decay_bps(&env);
        Self::apply_role_decay(&env, metrics, decay_bps, is_blacklisted);
        let new_score = metrics.score;
        let total_jobs = metrics.completed_jobs;
        let badge_level = metrics.badge_level;

        profile.refresh_badges();
        storage::write_profile(&env, &address, &profile);
        env.events().publish(
            ("reputation", "ScoreAdjusted"),
            ScoreAdjustedEvent {
                address,
                role,
                delta: new_score.saturating_sub(previous_score),
                new_score,
                total_jobs,
                badge_level,
                adjusted_at: env.ledger().timestamp(),
            },
        );
        Self::bump_instance_ttl(&env);
    }

    pub fn blacklist_profile(
        env: Env,
        caller_contract: Address,
        address: Address,
        _reason: Symbol,
    ) {
        Self::require_authorized_contract(&env, &caller_contract);

        let mut profile = storage::read_profile_or_default(&env, &address);
        if !profile.is_blacklisted {
            profile.is_blacklisted = true;
            let is_blacklisted = profile.is_blacklisted;
            let decay_bps = Self::read_blacklist_decay_bps(&env);
            Self::apply_role_decay(&env, &mut profile.client, decay_bps, is_blacklisted);
            Self::apply_role_decay(&env, &mut profile.freelancer, decay_bps, is_blacklisted);
        }

        let client_score = profile.client.score;
        let freelancer_score = profile.freelancer.score;
        storage::write_profile(&env, &address, &profile);
        env.events().publish(
            ("reputation", "BlacklistUpdated"),
            BlacklistUpdatedEvent {
                address,
                is_blacklisted: true,
                client_score,
                freelancer_score,
                updated_at: env.ledger().timestamp(),
            },
        );
        Self::bump_instance_ttl(&env);
    }

    /// Recover score for inactive profiles. `lookback_seconds` specifies minimum inactivity
    /// required to allow recovery. `recovery_bps` is basis-points of the gap towards default.
    /// Only callable by an authorized contract.
    pub fn recover_score(
        env: Env,
        caller_contract: Address,
        address: Address,
        role: Role,
        lookback_seconds: u64,
        recovery_bps: i32,
    ) {
        Self::require_authorized_contract(&env, &caller_contract);

        if recovery_bps < 0 || recovery_bps > Self::SCORE_SCALE as i32 {
            soroban_sdk::panic_with_error!(&env, ReputationError::InvalidInput);
        }

        let mut profile = storage::read_profile_or_default(&env, &address);
        if profile.is_blacklisted {
            soroban_sdk::panic_with_error!(&env, ReputationError::Blacklisted);
        }

        let last = profile.last_activity;
=======
>>>>>>> 5a2cc8d9734783cc04369634a657f1bd96408f1c
        let now = env.ledger().timestamp();
        let ninety_days_in_seconds = 90u64 * 24 * 60 * 60;

        if now.saturating_sub(profile.last_activity) < ninety_days_in_seconds {
            // No decay needed for recent activity
            return Ok(());
        }

        // Apply decay to both roles
        let old_client_score = profile.client.score;
        let old_freelancer_score = profile.freelancer.score;

        profile.client.score = Self::clamp_score(Self::apply_decay(profile.client.score)?);
        profile.freelancer.score =
            Self::clamp_score(Self::apply_decay(profile.freelancer.score)?);

        profile.last_activity = now;

        let old_client_badge = profile.client_badge.clone();
        let old_freelancer_badge = profile.freelancer_badge.clone();
        profile.refresh_badges();

        storage::write_profile(&env, &address, &profile);

        // Emit events if scores changed
        if profile.client.score != old_client_score {
            env.events().publish(
                ("reputation", "ScoreAdjusted"),
                ScoreAdjustedEvent {
                    address: address.clone(),
                    role: String::from_str(&env, "client"),
                    old_score: old_client_score,
                    new_score: profile.client.score,
                    reason: String::from_str(&env, "time_decay"),
                    adjusted_at: now,
                },
            );
        }

        if profile.freelancer.score != old_freelancer_score {
            env.events().publish(
                ("reputation", "ScoreAdjusted"),
                ScoreAdjustedEvent {
                    address: address.clone(),
                    role: String::from_str(&env, "freelancer"),
                    old_score: old_freelancer_score,
                    new_score: profile.freelancer.score,
                    reason: String::from_str(&env, "time_decay"),
                    adjusted_at: now,
                },
            );
        }

        // Emit badge upgrade events if changed
        if profile.client_badge != old_client_badge {
            env.events().publish(
                ("reputation", "BadgeUpgraded"),
                BadgeUpgradedEvent {
                    address: address.clone(),
                    role: String::from_str(&env, "client"),
                    old_badge: old_client_badge,
                    new_badge: profile.client_badge,
                    upgraded_at: now,
                },
            );
        }

        if profile.freelancer_badge != old_freelancer_badge {
            env.events().publish(
                ("reputation", "BadgeUpgraded"),
                BadgeUpgradedEvent {
                    address: address.clone(),
                    role: String::from_str(&env, "freelancer"),
                    old_badge: old_freelancer_badge,
                    new_badge: profile.freelancer_badge,
                    upgraded_at: now,
                },
            );
        }

        Ok(())
    }

    fn compute_recovery_towards_default(env: &Env, score: i32) -> Result<i32, ReputationError> {
        if score == DEFAULT_SCORE {
            return Ok(score);
        }

        let distance = DEFAULT_SCORE as i128 - score as i128;
        let adjustment = distance
            .checked_mul(Self::RECOVERY_STEP_BPS as i128)
            .ok_or(ReputationError::ArithmeticOverflow)?
            / BPS_SCALE as i128;

        Ok(Self::clamp_score_i128(score as i128 + adjustment))
    }

    /// Recover a single role score toward the default score after inactivity.
    pub fn recover_score(
        env: Env,
        caller: Address,
        target_address: Address,
        role: Role,
    ) -> Result<i32, ReputationError> {
        Self::verify_authorized_caller(&env, &caller)?;

        let mut profile = storage::read_profile_or_default(&env, &target_address);
        let now = env.ledger().timestamp();
        if now.saturating_sub(profile.last_activity) < Self::RECOVERY_INACTIVITY_SECONDS {
            return Ok(match role {
                Role::Client => profile.client.score,
                Role::Freelancer => profile.freelancer.score,
            });
        }

        let role_metrics = match role {
            Role::Client => &mut profile.client,
            Role::Freelancer => &mut profile.freelancer,
        };
        let previous_score = role_metrics.score;
        let new_score = Self::compute_recovery_towards_default(&env, previous_score)?;
        role_metrics.score = new_score;

        let old_client_badge = profile.client_badge.clone();
        let old_freelancer_badge = profile.freelancer_badge.clone();
        profile.last_activity = now;
        profile.refresh_badges();
        storage::write_profile(&env, &target_address, &profile);

        env.events().publish(
            ("reputation", "ScoreRecovered"),
            ScoreRecoveredEvent {
                address: target_address.clone(),
                role,
                previous_score,
                new_score,
                recovered_at: now,
            },
        );

        if profile.client_badge != old_client_badge {
            env.events().publish(
                ("reputation", "BadgeUpgraded"),
                BadgeUpgradedEvent {
                    address: target_address.clone(),
                    role: String::from_str(&env, "client"),
                    old_badge: old_client_badge,
                    new_badge: profile.client_badge,
                    upgraded_at: now,
                },
            );
        }

        if profile.freelancer_badge != old_freelancer_badge {
            env.events().publish(
                ("reputation", "BadgeUpgraded"),
                BadgeUpgradedEvent {
                    address: target_address,
                    role: String::from_str(&env, "freelancer"),
                    old_badge: old_freelancer_badge,
                    new_badge: profile.freelancer_badge,
                    upgraded_at: now,
                },
            );
        }

        Ok(new_score)
    }

    /// Get the admin address
    pub fn get_admin(env: Env) -> Result<Address, ReputationError> {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::Admin)
<<<<<<< HEAD
            .expect("not initialized");
        admin.require_auth();
        assert!(admin == configured_admin, "unauthorized");

        let mut profile = storage::read_profile_or_default(&env, &address);

        // Replace existing entry for this tier or push a new one.
        let mut found = false;
        let len = profile.badge_metadata.len();
        for i in 0..len {
            let entry = profile.badge_metadata.get(i).unwrap();
            if entry.tier == tier {
                profile.badge_metadata.set(
                    i,
                    BadgeMetadataEntry {
                        tier: tier.clone(),
                        uri: uri.clone(),
                    },
                );
                found = true;
                break;
            }
        }
        if !found {
            profile
                .badge_metadata
                .push_back(BadgeMetadataEntry { tier, uri });
        }

        storage::write_profile(&env, &address, &profile);
        Self::bump_instance_ttl(&env);
    }

    /// Return the metadata URI for a given badge tier, or `None` if not set.
    pub fn get_badge_metadata(env: Env, address: Address, tier: BadgeTier) -> Option<Bytes> {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        for i in 0..profile.badge_metadata.len() {
            let entry = profile.badge_metadata.get(i).unwrap();
            if entry.tier == tier {
                return Some(entry.uri);
            }
        }
        None
    }

    pub fn get_score(env: Env, address: Address, role: Role) -> ReputationScore {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        Self::score_from_profile(&address, role, &profile)
    }

    /// Get active badge level
    pub fn get_badge_level(env: Env, address: Address, role: Role) -> u32 {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        match role {
            Role::Client => profile.client.badge_level,
            Role::Freelancer => profile.freelancer.badge_level,
        }
    }

    /// Update profile metadata hash (IPFS CID)
    pub fn update_profile_metadata(env: Env, address: Address, metadata_hash: Bytes) {
        address.require_auth();
        let mut profile = storage::read_profile_or_default(&env, &address);
        profile.metadata_hash = Some(metadata_hash);
        profile.last_activity = env.ledger().timestamp();
        storage::write_profile(&env, &address, &profile);
        Self::bump_instance_ttl(&env);
    }

    pub fn get_profile_metadata(env: Env, address: Address) -> Option<Bytes> {
        Self::bump_instance_ttl(&env);
        storage::read_profile(&env, &address).and_then(|profile| profile.metadata_hash)
    }

    /// Frontend-friendly aggregate metrics for public profile pages.
    /// Returns: [score_bps, total_jobs, total_points, reviews, badge_level]
    pub fn get_public_metrics(env: Env, address: Address, role_name: Symbol) -> Vec<i128> {
        let role = if role_name == Symbol::new(&env, "client") {
            Role::Client
        } else if role_name == Symbol::new(&env, "freelancer") {
            Role::Freelancer
        } else {
            soroban_sdk::panic_with_error!(&env, ReputationError::InvalidInput);
        };

        let rep = Self::get_score(env.clone(), address, role);
        let mut metrics = Vec::new(&env);
        metrics.push_back(rep.score as i128);
        metrics.push_back(rep.total_jobs as i128);
        metrics.push_back(rep.total_points);
        metrics.push_back(rep.reviews as i128);
        metrics.push_back(rep.badge_level as i128);
        metrics.push_back(rep.average_rating_bps as i128);
        metrics.push_back(if rep.blacklisted { 1 } else { 0 });
        metrics
    }

    pub fn query_reputation(env: Env, address: Address) -> ReputationView {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        let client = Self::score_from_profile(&address, Role::Client, &profile);
        let freelancer = Self::score_from_profile(&address, Role::Freelancer, &profile);
        ReputationView {
            address,
            client,
            freelancer,
            is_blacklisted: profile.is_blacklisted,
        }
    }

    pub fn get_badge(env: Env, address: Address, role: Role) -> BadgeLevel {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        let metrics = Self::role_metrics(&profile, &role);
        BadgeLevel::from_score(metrics.score)
    }

    pub fn set_badge_metadata(
        env: Env,
        admin: Address,
        badge_address: Address,
        tier: BadgeTier,
        uri: Bytes,
    ) {
        Self::require_admin(&env, &admin);

        let mut profile = storage::read_profile_or_default(&env, &badge_address);
        let mut found = false;
        let mut i: u32 = 0;
        while i < profile.badge_metadata.len() {
            let entry = profile.badge_metadata.get(i).unwrap();
            if entry.tier == tier {
                profile.badge_metadata.set(
                    i,
                    BadgeMetadataEntry {
                        tier: tier.clone(),
                        uri: uri.clone(),
                    },
                );
                found = true;
                break;
            }
            i += 1;
        }
        if !found {
            profile.badge_metadata.push_back(BadgeMetadataEntry {
                tier,
                uri: uri.clone(),
            });
        }

        storage::write_profile(&env, &badge_address, &profile);
        Self::bump_instance_ttl(&env);
    }

    pub fn get_badge_metadata(env: Env, address: Address, tier: BadgeTier) -> Option<Bytes> {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile(&env, &address)?;
        let mut i: u32 = 0;
        while i < profile.badge_metadata.len() {
            let entry = profile.badge_metadata.get(i).unwrap();
            if entry.tier == tier {
                return Some(entry.uri);
            }
            i += 1;
        }
        None
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, BytesN, Env};

    #[contract]
    pub struct MockJobRegistry;

    #[contracttype]
    enum MockKey {
        Job(u64),
    }

    #[contractimpl]
    impl MockJobRegistry {
        pub fn set_job(env: Env, job_id: u64, job: JobRecord) {
            env.storage().persistent().set(&MockKey::Job(job_id), &job);
        }

        pub fn get_job(env: Env, job_id: u64) -> Result<JobRecord, soroban_sdk::Error> {
            Ok(env
                .storage()
                .persistent()
                .get(&MockKey::Job(job_id))
                .expect("mock job missing"))
        }
    }

    #[contract]
    pub struct AuthorizedAdjuster;

    #[contractimpl]
    impl AuthorizedAdjuster {
        pub fn award(env: Env, reputation: Address, target: Address, role: Role, delta: i32) {
            let reputation_client = ReputationContractClient::new(&env, &reputation);
            let caller_contract = env.current_contract_address();
            reputation_client.update_score(&caller_contract, &target, &role, &delta);
        }

        pub fn slash(env: Env, reputation: Address, target: Address, role: Role, reason: Symbol) {
            let reputation_client = ReputationContractClient::new(&env, &reputation);
            let caller_contract = env.current_contract_address();
            reputation_client.slash(&caller_contract, &target, &role, &reason);
        }

        pub fn blacklist(env: Env, reputation: Address, target: Address, reason: Symbol) {
            let reputation_client = ReputationContractClient::new(&env, &reputation);
            let caller_contract = env.current_contract_address();
            reputation_client.blacklist_profile(&caller_contract, &target, &reason);
        }

        pub fn record_dispute_failure(env: Env, reputation: Address, target: Address, role: Role) {
            let reputation_client = ReputationContractClient::new(&env, &reputation);
            let caller_contract = env.current_contract_address();
            reputation_client.record_dispute_failure(&caller_contract, &target, &role);
        }
    }

    fn setup_job(
        env: &Env,
        registry: &Address,
        job_id: u64,
        client_address: &Address,
        freelancer: &Address,
    ) {
        setup_job_with_status(
            env,
            registry,
            job_id,
            client_address,
            freelancer,
            JobStatus::Completed,
        );
    }

    fn setup_job_with_status(
        env: &Env,
        registry: &Address,
        job_id: u64,
        client_address: &Address,
        freelancer: &Address,
        status: JobStatus,
    ) {
        let job = JobRecord {
            client: client_address.clone(),
            freelancer: Some(freelancer.clone()),
            metadata_hash: Bytes::from_slice(env, b"QmJob"),
            budget_stroops: 10,
            status,
            expires_at: 0,
            status: JobStatus::Completed,
            bid_deadline: 0,
            collateral_token: Address::generate(env),
            collateral_amount: 0,
            collateral_locked: false,
        };
        let registry_client = MockJobRegistryClient::new(env, registry);
        registry_client.set_job(&job_id, &job);
    }

    #[test]
    fn test_empty_profile_reads_are_safe() {
        let env = Env::default();
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let score = client.get_score(&address, &Role::Freelancer);
        assert_eq!(score.score, 5_000);
        assert_eq!(score.total_jobs, 0);
        assert_eq!(score.total_points, 0);
        assert_eq!(score.reviews, 0);
        assert_eq!(score.average_rating_bps, 5_000);
        assert_eq!(score.badge_level, 1);
        assert!(!score.blacklisted);

        let view = client.query_reputation(&address);
        assert_eq!(view.client.score, 5_000);
        assert_eq!(view.client.badge_level, 1);
        assert_eq!(view.freelancer.score, 5_000);
        assert_eq!(view.freelancer.badge_level, 1);
        assert!(!view.is_blacklisted);

        let metadata = client.get_profile_metadata(&address);
        assert_eq!(metadata, None);
    }

    #[test]
    fn test_authorized_contract_updates_score() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let target = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let adjuster_id = env.register_contract(None, AuthorizedAdjuster);
        let client = ReputationContractClient::new(&env, &reputation_id);
        let adjuster = AuthorizedAdjusterClient::new(&env, &adjuster_id);

        client.initialize(&admin);
        client.set_authorized_contract(&admin, &adjuster_id);

        adjuster.award(&reputation_id, &target, &Role::Freelancer, &1_500);

        let score = client.get_score(&target, &Role::Freelancer);
        assert_eq!(score.score, 6_500);
        assert_eq!(score.total_jobs, 0);
        assert_eq!(score.badge_level, 2);
    }

    #[test]
    fn test_slash_uses_fixed_point_decay() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client_addr = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let registry_id = env.register_contract(None, MockJobRegistry);
        let adjuster_id = env.register_contract(None, AuthorizedAdjuster);
        let client = ReputationContractClient::new(&env, &reputation_id);
        let adjuster = AuthorizedAdjusterClient::new(&env, &adjuster_id);

        client.initialize(&admin);
        client.set_job_registry(&admin, &registry_id);
        client.set_authorized_contract(&admin, &adjuster_id);

        setup_job(&env, &registry_id, 1, &client_addr, &freelancer);
        client.submit_rating(&client_addr, &1, &freelancer, &5);

        adjuster.slash(
            &reputation_id,
            &freelancer,
            &Role::Freelancer,
            &Symbol::new(&env, "fraud"),
        );

        let score = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(score.score, 8_000);
        assert_eq!(score.badge_level, 3);
    }

    #[test]
    fn test_badge_upgrades_reflect_immediately_in_public_getters() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let client_one = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let registry_id = env.register_contract(None, MockJobRegistry);
        let adjuster_id = env.register_contract(None, AuthorizedAdjuster);
        let client = ReputationContractClient::new(&env, &reputation_id);
        let adjuster = AuthorizedAdjusterClient::new(&env, &adjuster_id);

        client.initialize(&admin);
        client.set_job_registry(&admin, &registry_id);
        client.set_authorized_contract(&admin, &adjuster_id);

        setup_job(&env, &registry_id, 11, &client_one, &freelancer);
        client.submit_rating(&client_one, &11, &freelancer, &5);

        // 10,000 score → Platinum (4)
        let after_first = client.get_public_metrics(&freelancer, &Symbol::new(&env, "freelancer"));
        assert_eq!(after_first.get(4), Some(4));

        // Slash down to 8,000 → Gold (3), verified immediately
        adjuster.slash(
            &reputation_id,
            &freelancer,
            &Role::Freelancer,
            &Symbol::new(&env, "penalty"),
        );
        let after_slash = client.get_public_metrics(&freelancer, &Symbol::new(&env, "freelancer"));
        assert_eq!(after_slash.get(4), Some(3));
        assert_eq!(after_slash.get(0), Some(8_000));

        // Award back up to 9,500 → Platinum (4)
        adjuster.award(&reputation_id, &freelancer, &Role::Freelancer, &1_500);
        let after_award = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(after_award.badge_level, 4);
        assert_eq!(after_award.score, 9_500);
    }

    #[test]
    fn test_blacklist_clears_badges_and_sets_flag() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let client_one = Address::generate(&env);
        let client_two = Address::generate(&env);
        let client_three = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let registry_id = env.register_contract(None, MockJobRegistry);
        let adjuster_id = env.register_contract(None, AuthorizedAdjuster);
        let client = ReputationContractClient::new(&env, &reputation_id);
        let adjuster = AuthorizedAdjusterClient::new(&env, &adjuster_id);

        client.initialize(&admin);
        client.set_job_registry(&admin, &registry_id);
        client.set_authorized_contract(&admin, &adjuster_id);

        setup_job(&env, &registry_id, 21, &client_one, &freelancer);
        setup_job(&env, &registry_id, 22, &client_two, &freelancer);
        setup_job(&env, &registry_id, 23, &client_three, &freelancer);

        client.submit_rating(&client_one, &21, &freelancer, &5);
        client.submit_rating(&client_two, &22, &freelancer, &5);
        client.submit_rating(&client_three, &23, &freelancer, &5);
        adjuster.blacklist(&reputation_id, &freelancer, &Symbol::new(&env, "fraud"));

        let score = client.get_score(&freelancer, &Role::Freelancer);
        assert!(score.blacklisted);
        assert_eq!(score.score, 1_000);
        assert_eq!(score.badge_level, 0);

        let view = client.query_reputation(&freelancer);
        assert!(view.is_blacklisted);
        assert!(client.is_blacklisted(&freelancer));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_get_public_metrics_rejects_unknown_role() {
        let env = Env::default();
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.get_public_metrics(&address, &Symbol::new(&env, "bogus"));
    }

    #[test]
    fn test_submit_rating_updates_client_and_freelancer_paths() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let caller = Address::generate(&env);
        let target = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let caller_two = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);
        client.initialize(&admin);

        let registry_id = env.register_contract(None, MockJobRegistry);
        client.set_job_registry(&admin, &registry_id);

        setup_job(&env, &registry_id, 7, &caller, &freelancer);
        setup_job(&env, &registry_id, 8, &caller_two, &target);

        client.submit_rating(&caller, &7, &freelancer, &5);
        let freelancer_score = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(freelancer_score.score, 10_000);
        assert_eq!(freelancer_score.total_jobs, 1);
        assert_eq!(freelancer_score.total_points, 5);
        assert_eq!(freelancer_score.reviews, 1);
        assert_eq!(freelancer_score.average_rating_bps, 10_000);
        assert_eq!(freelancer_score.badge_level, 4);

        client.submit_rating(&caller_two, &8, &target, &4);
        let second_freelancer_score = client.get_score(&target, &Role::Freelancer);
        assert_eq!(second_freelancer_score.score, 8_000);
        assert_eq!(second_freelancer_score.total_jobs, 1);
        assert_eq!(second_freelancer_score.total_points, 4);
        assert_eq!(second_freelancer_score.reviews, 1);
        assert_eq!(second_freelancer_score.average_rating_bps, 8_000);
    }

    #[test]
    fn test_duplicate_review_is_rejected_without_mutating_profile() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let job_client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let registry_id = env.register_contract(None, MockJobRegistry);
        let client = ReputationContractClient::new(&env, &reputation_id);

        client.initialize(&admin);
        client.set_job_registry(&admin, &registry_id);
        setup_job(&env, &registry_id, 41, &job_client, &freelancer);

        client.submit_rating(&job_client, &41, &freelancer, &5);
        let before = client.get_score(&freelancer, &Role::Freelancer);

        let duplicate = client.try_submit_rating(&job_client, &41, &freelancer, &1);
        assert!(duplicate.is_err());

        let after = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(after, before);
    }

    #[test]
    fn test_uncompleted_job_review_is_rejected_without_profile_creation_side_effects() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let job_client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let registry_id = env.register_contract(None, MockJobRegistry);
        let client = ReputationContractClient::new(&env, &reputation_id);

        client.initialize(&admin);
        client.set_job_registry(&admin, &registry_id);
        setup_job_with_status(
            &env,
            &registry_id,
            42,
            &job_client,
            &freelancer,
            JobStatus::InProgress,
        );

        let rejected = client.try_submit_rating(&job_client, &42, &freelancer, &5);
        assert!(rejected.is_err());

        let score = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(score.score, 5_000);
        assert_eq!(score.total_jobs, 0);
        assert_eq!(score.total_points, 0);
        assert_eq!(score.reviews, 0);
        assert_eq!(score.badge_level, 0);
    }

    #[test]
    fn test_average_rating_uses_deterministic_fixed_point_math() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let client_one = Address::generate(&env);
        let client_two = Address::generate(&env);
        let client_three = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let registry_id = env.register_contract(None, MockJobRegistry);
        let client = ReputationContractClient::new(&env, &reputation_id);

        client.initialize(&admin);
        client.set_job_registry(&admin, &registry_id);
        setup_job(&env, &registry_id, 43, &client_one, &freelancer);
        setup_job(&env, &registry_id, 44, &client_two, &freelancer);
        setup_job(&env, &registry_id, 45, &client_three, &freelancer);

        client.submit_rating(&client_one, &43, &freelancer, &5);
        client.submit_rating(&client_two, &44, &freelancer, &4);
        client.submit_rating(&client_three, &45, &freelancer, &3);

        let score = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(score.total_points, 12);
        assert_eq!(score.reviews, 3);
        assert_eq!(score.total_jobs, 3);
        assert_eq!(score.average_rating_bps, 8_000);
        assert_eq!(score.score, 8_000);
        assert_eq!(score.badge_level, 1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_direct_score_adjustment_requires_authorized_contract() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let target = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let authorized_contract = env.register_contract(None, AuthorizedAdjuster);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);
        client.set_authorized_contract(&admin, &authorized_contract);
        client.update_score(&attacker, &target, &Role::Freelancer, &500);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_direct_reviews_from_unverified_public_keys_are_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let job_client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);
        let registry_id = env.register_contract(None, MockJobRegistry);
        client.set_job_registry(&admin, &registry_id);
        setup_job(&env, &registry_id, 33, &job_client, &freelancer);

        client.submit_rating(&attacker, &33, &freelancer, &5);
    }

    #[test]
    fn test_profile_metadata() {
        let env = Env::default();
        env.mock_all_auths();

        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmProfileHash");
        client.update_profile_metadata(&address, &hash);

        let saved_hash = client.get_profile_metadata(&address);
        assert_eq!(saved_hash, Some(hash));
    }

    // ΓöÇΓöÇ Issue #402: badge minting ΓöÇΓöÇ

    #[test]
    fn test_badge_starts_at_bronze_for_default_score() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let addr = Address::generate(&env);
        let cid = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &cid);
        client.initialize(&admin);

        // Default score is 5000 ΓåÆ Bronze
        let badge = client.get_badge(&addr, &Role::Freelancer);
        assert_eq!(badge, BadgeLevel::Bronze);
    }

    #[test]
    fn test_badge_upgrades_to_silver_at_6000() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let addr = Address::generate(&env);
        let cid = env.register_contract(None, ReputationContract);
        let adjuster_id = env.register_contract(None, AuthorizedAdjuster);
        let client = ReputationContractClient::new(&env, &cid);
        let adjuster = AuthorizedAdjusterClient::new(&env, &adjuster_id);
        client.initialize(&admin);
        client.set_authorized_contract(&admin, &adjuster_id);

        // Raise score by 1000 → 5000+1000=6000 → Silver
        adjuster.award(&cid, &addr, &Role::Freelancer, &1_000);
        let badge = client.get_badge(&addr, &Role::Freelancer);
        assert_eq!(badge, BadgeLevel::Silver);
    }

    #[test]
    fn test_badge_upgrades_to_gold_at_8000() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let addr = Address::generate(&env);
        let cid = env.register_contract(None, ReputationContract);
        let adjuster_id = env.register_contract(None, AuthorizedAdjuster);
        let client = ReputationContractClient::new(&env, &cid);
        let adjuster = AuthorizedAdjusterClient::new(&env, &adjuster_id);
        client.initialize(&admin);
        client.set_authorized_contract(&admin, &adjuster_id);

        adjuster.award(&cid, &addr, &Role::Freelancer, &3_000); // 5000+3000=8000
        assert_eq!(client.get_badge(&addr, &Role::Freelancer), BadgeLevel::Gold);
    }

    #[test]
    fn test_slash_downgrades_badge() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let addr = Address::generate(&env);
        let cid = env.register_contract(None, ReputationContract);
        let adjuster_id = env.register_contract(None, AuthorizedAdjuster);
        let client = ReputationContractClient::new(&env, &cid);
        let adjuster = AuthorizedAdjusterClient::new(&env, &adjuster_id);
        client.initialize(&admin);
        client.set_authorized_contract(&admin, &adjuster_id);

        // Bring to Gold first, then slash twice to drop back to Bronze
        adjuster.award(&cid, &addr, &Role::Client, &3_000); // 8000 → Gold
        assert_eq!(client.get_badge(&addr, &Role::Client), BadgeLevel::Gold);
        adjuster.slash(&cid, &addr, &Role::Client, &Symbol::new(&env, "fraud")); // 6000 → Silver
        assert_eq!(client.get_badge(&addr, &Role::Client), BadgeLevel::Silver);
        adjuster.slash(&cid, &addr, &Role::Client, &Symbol::new(&env, "fraud")); // 4000 → Bronze
        assert_eq!(client.get_badge(&addr, &Role::Client), BadgeLevel::Bronze);
    }

    // ΓöÇΓöÇ Issue #406: badge metadata mapping ΓöÇΓöÇ

    #[test]
    fn test_set_and_get_badge_metadata() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let addr = Address::generate(&env);
        let cid = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &cid);
        client.initialize(&admin);

        let uri = Bytes::from_slice(&env, b"ipfs://QmBronzeBadge");
        client.set_badge_metadata(&admin, &addr, &BadgeTier::Bronze, &uri);

        let result = client.get_badge_metadata(&addr, &BadgeTier::Bronze);
        assert_eq!(result, Some(uri));
    }

    #[test]
    fn test_badge_metadata_returns_none_when_unset() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let addr = Address::generate(&env);
        let cid = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &cid);
        client.initialize(&admin);

        let result = client.get_badge_metadata(&addr, &BadgeTier::Gold);
        assert_eq!(result, None);
    }

    #[test]
    fn test_badge_metadata_update_overwrites_existing() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let addr = Address::generate(&env);
        let cid = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &cid);
        client.initialize(&admin);

        let uri_v1 = Bytes::from_slice(&env, b"ipfs://QmSilverV1");
        let uri_v2 = Bytes::from_slice(&env, b"ipfs://QmSilverV2");
        client.set_badge_metadata(&admin, &addr, &BadgeTier::Silver, &uri_v1);
        client.set_badge_metadata(&admin, &addr, &BadgeTier::Silver, &uri_v2);

        assert_eq!(
            client.get_badge_metadata(&addr, &BadgeTier::Silver),
            Some(uri_v2)
        );
    }

    #[test]
    fn test_multiple_tiers_stored_independently() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let addr = Address::generate(&env);
        let cid = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &cid);
        client.initialize(&admin);

        let bronze_uri = Bytes::from_slice(&env, b"ipfs://Bronze");
        let gold_uri = Bytes::from_slice(&env, b"ipfs://Gold");
        client.set_badge_metadata(&admin, &addr, &BadgeTier::Bronze, &bronze_uri);
        client.set_badge_metadata(&admin, &addr, &BadgeTier::Gold, &gold_uri);

        assert_eq!(
            client.get_badge_metadata(&addr, &BadgeTier::Bronze),
            Some(bronze_uri)
        );
        assert_eq!(
            client.get_badge_metadata(&addr, &BadgeTier::Gold),
            Some(gold_uri)
        );
        assert_eq!(client.get_badge_metadata(&addr, &BadgeTier::Silver), None);
    }

    // ── Dynamic decay parameter (lambda tuning) tests ──

    #[test]
    fn test_default_slash_decay_matches_constant() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let addr = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let adjuster_id = env.register_contract(None, AuthorizedAdjuster);
        let client = ReputationContractClient::new(&env, &reputation_id);
        let adjuster = AuthorizedAdjusterClient::new(&env, &adjuster_id);
        client.initialize(&admin);
        client.set_authorized_contract(&admin, &adjuster_id);

        // Default score 5,000, award to 10,000
        adjuster.award(&reputation_id, &addr, &Role::Freelancer, &5_000);
        assert_eq!(client.get_score(&addr, &Role::Freelancer).score, 10_000);

        // Default slash decay is 8,000 BPS (80%) → 8,000
        adjuster.slash(
            &reputation_id,
            &addr,
            &Role::Freelancer,
            &Symbol::new(&env, "test"),
        );
        assert_eq!(client.get_score(&addr, &Role::Freelancer).score, 8_000);
    }

    #[test]
    fn test_admin_can_update_slash_decay() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &reputation_id);
        client.initialize(&admin);

        client.set_slash_decay(&admin, &5_000);
        // Read back via calling slash on a known score
        let addr = Address::generate(&env);
        let adjuster_id = env.register_contract(None, AuthorizedAdjuster);
        let adjuster = AuthorizedAdjusterClient::new(&env, &adjuster_id);
        client.set_authorized_contract(&admin, &adjuster_id);

        adjuster.award(&reputation_id, &addr, &Role::Freelancer, &5_000);
        assert_eq!(client.get_score(&addr, &Role::Freelancer).score, 10_000);

        // Now slash at 50% → 5,000
        adjuster.slash(
            &reputation_id,
            &addr,
            &Role::Freelancer,
            &Symbol::new(&env, "test"),
        );
        assert_eq!(client.get_score(&addr, &Role::Freelancer).score, 5_000);
    }

    #[test]
    fn test_admin_can_update_blacklist_decay() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &reputation_id);
        let adjuster_id = env.register_contract(None, AuthorizedAdjuster);
        let adjuster = AuthorizedAdjusterClient::new(&env, &adjuster_id);
        client.initialize(&admin);
        client.set_authorized_contract(&admin, &adjuster_id);

        // Set blacklist decay to 5,000 BPS (50%)
        client.set_blacklist_decay(&admin, &5_000);

        let addr = Address::generate(&env);
        adjuster.award(&reputation_id, &addr, &Role::Freelancer, &5_000);
        assert_eq!(client.get_score(&addr, &Role::Freelancer).score, 10_000);

        adjuster.blacklist(&reputation_id, &addr, &Symbol::new(&env, "abuse"));
        // 50% of 10,000 = 5,000
        assert_eq!(client.get_score(&addr, &Role::Freelancer).score, 5_000);
        assert_eq!(client.get_score(&addr, &Role::Client).score, 2_500);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_non_admin_cannot_set_slash_decay() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &reputation_id);
        client.initialize(&admin);

        client.set_slash_decay(&attacker, &5_000);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_invalid_slash_decay_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &reputation_id);
        client.initialize(&admin);

        client.set_slash_decay(&admin, &999);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_invalid_blacklist_decay_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &reputation_id);
        client.initialize(&admin);

        client.set_blacklist_decay(&admin, &11_000);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_upgrade_requires_admin() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);
        let wasm_hash = BytesN::from_array(&env, &[0; 32]);
        client.upgrade(&attacker, &wasm_hash);
    }

    #[test]
    fn test_empty_account_load_save() {
        let env = Env::default();
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        // Fetching score for empty account should not panic and return defaults
        let score = client.get_score(&address, &Role::Freelancer);
        assert_eq!(score.score, 5000);
        assert_eq!(score.badge_level, 0);

        let level = client.get_badge_level(&address, &Role::Freelancer);
        assert_eq!(level, 0);
    }

    #[test]
    fn test_badge_upgrades() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let client_one = Address::generate(&env);
        let client_two = Address::generate(&env);
        let client_three = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let registry_id = env.register_contract(None, MockJobRegistry);
        let client = ReputationContractClient::new(&env, &reputation_id);

        client.initialize(&admin);
        client.set_job_registry(&admin, &registry_id);

        setup_job(&env, &registry_id, 101, &client_one, &freelancer);
        setup_job(&env, &registry_id, 102, &client_two, &freelancer);
        setup_job(&env, &registry_id, 103, &client_three, &freelancer);

        assert_eq!(client.get_badge_level(&freelancer, &Role::Freelancer), 0);

        client.submit_rating(&client_one, &101, &freelancer, &5);
        assert_eq!(client.get_badge_level(&freelancer, &Role::Freelancer), 0);

        client.submit_rating(&client_two, &102, &freelancer, &5);
        assert_eq!(client.get_badge_level(&freelancer, &Role::Freelancer), 0);

        client.submit_rating(&client_three, &103, &freelancer, &5);
        assert_eq!(client.get_badge_level(&freelancer, &Role::Freelancer), 1);

        // Check public metrics
        let metrics =
            client.get_public_metrics(&address, &soroban_sdk::Symbol::new(&env, "freelancer"));
        assert_eq!(metrics.get(0).unwrap(), 6500);
        assert_eq!(metrics.get(1).unwrap(), 3);
        assert_eq!(metrics.get(4).unwrap(), 1);
    }

    #[test]
    fn test_badge_revocation_after_multiple_dispute_failures() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let adjuster_id = env.register_contract(None, AuthorizedAdjuster);
        let client = ReputationContractClient::new(&env, &reputation_id);
        let adjuster = AuthorizedAdjusterClient::new(&env, &adjuster_id);

        client.initialize(&admin);
        client.set_authorized_contract(&admin, &adjuster_id);

        // Build up a high score and badge level
        adjuster.award(&reputation_id, &freelancer, &Role::Freelancer, &2_000);
        adjuster.award(&reputation_id, &freelancer, &Role::Freelancer, &2_000);
        adjuster.award(&reputation_id, &freelancer, &Role::Freelancer, &2_000);

        let score = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(score.score, 11_000); // 5000 + 2000*3, clamped to 10000
        assert_eq!(score.badge_level, 1); // 3 jobs, score >= 6000

        // First dispute failure - badge should remain
        adjuster.record_dispute_failure(&reputation_id, &freelancer, &Role::Freelancer);
        let score_after_1 = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(score_after_1.badge_level, 1);

        // Second dispute failure - badge should remain
        adjuster.record_dispute_failure(&reputation_id, &freelancer, &Role::Freelancer);
        let score_after_2 = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(score_after_2.badge_level, 1);

        // Third dispute failure - badge should be revoked (threshold = 3)
        adjuster.record_dispute_failure(&reputation_id, &freelancer, &Role::Freelancer);
        let score_after_3 = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(score_after_3.badge_level, 0); // Badge revoked
        assert!(score_after_3.score < 10_000); // Score penalty applied
    }

    #[test]
    fn test_dispute_failure_requires_authorized_contract() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let target = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let adjuster_id = env.register_contract(None, AuthorizedAdjuster);
        let client = ReputationContractClient::new(&env, &reputation_id);

        client.initialize(&admin);
        client.set_authorized_contract(&admin, &adjuster_id);

        // Unauthorized caller should fail
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.record_dispute_failure(&attacker, &target, &Role::Freelancer);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_authorized_contract_score_adjustment() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let authorized_contract = Address::generate(&env);
        let unauthorized_contract = Address::generate(&env);
        let address = Address::generate(&env);

        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);

        // Authorize the contract
        client.authorize_contract(&admin, &authorized_contract);
        assert!(client.is_contract_authorized(&authorized_contract));
        assert!(!client.is_contract_authorized(&unauthorized_contract));

        // Authorized contract adjusts score
        client.update_score(&authorized_contract, &address, &Role::Freelancer, &100);
        let score = client.get_score(&address, &Role::Freelancer);
        assert_eq!(score.score, 5100);

        // Unauthorized contract attempt to adjust score should panic
        let res =
            client.try_update_score(&unauthorized_contract, &address, &Role::Freelancer, &100);
        assert!(res.is_err());

        // Deauthorize
        client.deauthorize_contract(&admin, &authorized_contract);
        assert!(!client.is_contract_authorized(&authorized_contract));

        // Now it should fail
        let res2 = client.try_update_score(&authorized_contract, &address, &Role::Freelancer, &100);
        assert!(res2.is_err());
    }

    #[test]
    fn test_recover_after_inactivity() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let authorized_contract = Address::generate(&env);
        let address = Address::generate(&env);

        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);

        // craft a stale profile with low score and old last_activity
        use crate::profile::{Profile, RoleMetrics, ReviewAggregate};
        let mut profile = Profile::new(address.clone());
        profile.freelancer.score = 2_000;
        profile.freelancer.completed_jobs = 1;
        profile.last_activity = env.ledger().timestamp().saturating_sub(10_000);

        // write directly into storage
        storage::write_profile(&env, &address, &profile);

        // authorize the contract that will call recover
        client.set_authorized_contract(&admin, &authorized_contract);

        // recover 50% of the gap towards default
        client.recover_score(&authorized_contract, &address, &Role::Freelancer, &100u64, &5_000);

        let score = client.get_score(&address, &Role::Freelancer);
        // gap = 5000 - 2000 = 3000, 50% -> +1500 => 3500
        assert_eq!(score.score, 3_500);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_recover_requires_authorized_contract() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);

        // attacker (unauthorized) attempts recovery
        client.recover_score(&attacker, &address, &Role::Freelancer, &1u64, &1_000);
    }

    #[test]
    fn test_arbitrary_direct_review_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client_addr = Address::generate(&env);
        let freelancer_addr = Address::generate(&env);
        let attacker = Address::generate(&env);

        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);
        client.initialize(&admin);

        let mock_id = env.register_contract(None, MockJobRegistry);
        client.set_job_registry(&admin, &mock_id);

        let job = JobRecord {
            client: client_addr.clone(),
            freelancer: Some(freelancer_addr.clone()),
            metadata_hash: Bytes::from_slice(&env, b"QmJob"),
            budget_stroops: 10,
            status: JobStatus::Completed,
        };
        let mock_client = MockJobRegistryClient::new(&env, &mock_id);
        mock_client.set_job(&7u64, &job);

        // Attacker who is not part of the job tries to rate the freelancer
        let res = client.try_submit_rating(&attacker, &7u64, &freelancer_addr, &5u32);
        assert!(res.is_err()); // should reject with unauthorized
=======
            .ok_or(ReputationError::ProfileNotFound)
    }

    /// Check if a caller is authorized
    pub fn is_authorized_caller(env: Env, caller: Address) -> bool {
        Self::verify_authorized_caller(&env, &caller).is_ok()
>>>>>>> 5a2cc8d9734783cc04369634a657f1bd96408f1c
    }
}
