#![no_std]

#[cfg(test)]
extern crate std;

pub use profile::BadgeLevel;
use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Bytes, Env, IntoVal, Symbol, Vec,
};

mod profile;
mod storage;
pub use profile::{BadgeMetadataEntry, BadgeTier};

use profile::{Profile, RoleMetrics};

// Types matching Job Registry contract's public types for cross-contract decoding
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum JobStatus {
    Open,
    InProgress,
    DeliverableSubmitted,
    Completed,
    Disputed,
}

#[contracttype]
#[derive(Clone)]
pub struct JobRecord {
    pub client: Address,
    pub freelancer: Option<Address>,
    pub metadata_hash: Bytes,
    pub budget_stroops: i128,
    pub status: JobStatus,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Role {
    Client,
    Freelancer,
}

/// Badge tiers for soulbound NFT rewards. Badges are non-transferable and
/// represent achievement levels based on reputation score and completed jobs.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum BadgeTier {
    None,
    Bronze,
    Silver,
    Gold,
    Platinum,
}

/// Profile struct storing review aggregates, completed jobs count, and active badge levels.
/// Badges are soulbound (non-transferable) and stored on-chain within this Profile.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Profile {
    pub address: Address,
    pub client: ReputationScore,
    pub freelancer: ReputationScore,
    pub is_blacklisted: bool,
}

#[contracttype]
pub enum DataKey {
    Admin,
    JobRegistry,
    AuthorizedUpdater,
    AuthorizedContract(Address),
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
}

#[contracttype]
#[derive(Clone)]
pub struct ContractUpgradedEvent {
    pub by_admin: Address,
    pub new_wasm_hash: BytesN<32>,
    pub upgraded_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct ReputationUpdatedEvent {
    pub job_id: u64,
    pub caller: Address,
    pub target: Address,
    pub role: Role,
    pub badge_tier: BadgeTier,
    /// Average rating in fixed-point format (1000 = 1.0, 5000 = 5.0)
    pub avg_rating: i32,
    /// Number of completed jobs
    pub completed_jobs: u32,
    /// Total reputation score in basis points
    pub reputation_score: i32,
    /// Total review points collected
    pub total_review_points: i32,
    /// Number of reviews received
    pub review_count: u32,
    /// Last timestamp when rating was updated (for decay calculations)
    pub last_updated: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReputationScore {
    pub address: Address,
    pub role: Role,
    /// Score in basis points (0–10000 = 0–100%)
    pub score: i32,
    pub total_jobs: u32,
    /// Sum of raw rating points (1-5) to compute aggregates off-chain
    pub total_points: i32,
    /// Number of reviews counted
    pub reviews: u32,
}

#[contracttype]
pub enum DataKey {
    Score(Address, Role),
    Profile(Address, Role),
    Admin,
    JobRegistry,
    Reviewed(u64, Address),
    AuthorizedContracts,
}

#[contracttype]
#[derive(Clone)]
pub struct DecayParameterUpdatedEvent {
    pub by_admin: Address,
    pub param_name: Symbol,
    pub old_value: i32,
    pub new_value: i32,
    pub updated_at: u64,
}

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    const INSTANCE_TTL_THRESHOLD: u32 = 50_000;
    const INSTANCE_TTL_EXTEND_TO: u32 = 150_000;
    const PERSISTENT_TTL_THRESHOLD: u32 = 50_000;
    const PERSISTENT_TTL_EXTEND_TO: u32 = 150_000;
    const SCORE_SCALE: i128 = 10_000;
    const MAX_RATING: i128 = 5;
    const DEFAULT_SCORE_BPS: i32 = 5_000;
    const SLASH_DECAY_BPS: i32 = 8_000;
    const BLACKLIST_DECAY_BPS: i32 = 1_000;
    const REVIEW_DECAY_BPS_PER_DAY: i32 = 9_950;
    const SECONDS_PER_DAY: u64 = 86_400;
    /// Number of dispute failures that trigger badge revocation
    const DISPUTE_FAILURE_THRESHOLD: u32 = 3;
    /// Score penalty applied after badge revocation due to disputes
    const BADGE_REVOCATION_PENALTY_BPS: i32 = 2_000;

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(Self::INSTANCE_TTL_THRESHOLD, Self::INSTANCE_TTL_EXTEND_TO);
    }

    fn clamp_score(value: i32) -> i32 {
        value.clamp(0, 10_000)
    }

    fn clamp_score_i128(value: i128) -> i32 {
        Self::clamp_score(value.clamp(0, Self::SCORE_SCALE) as i32)
    }

    fn read_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| soroban_sdk::panic_with_error!(env, ReputationError::NotInitialized))
    }

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

    fn score_from_profile(
        env: &Env,
        address: &Address,
        role: Role,
        profile: &Profile,
    ) -> ReputationScore {
        let metrics = Self::role_metrics(profile, &role);
        let score = Self::decayed_metric_score(env, metrics);
        ReputationScore {
            address: address.clone(),
            role,
            score,
            total_jobs: metrics.completed_jobs,
            total_points: metrics.review.total_points,
            reviews: metrics.review.reviews,
            average_rating_bps: metrics.review.average_rating_bps,
            badge_level: Self::badge_level_for_score(score, metrics, profile.is_blacklisted),
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
            return 0;
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

    fn apply_exponential_decay_bps(env: &Env, score: i32, since: u64) -> i32 {
        if score <= 0 {
            return Self::clamp_score(score);
        }

        let now = env.ledger().timestamp();
        if now <= since {
            return Self::clamp_score(score);
        }

        let elapsed_days = now.saturating_sub(since) / Self::SECONDS_PER_DAY;
        if elapsed_days == 0 {
            return Self::clamp_score(score);
        }

        let mut value = score as i128;
        let factor = Self::REVIEW_DECAY_BPS_PER_DAY as i128;
        let mut days = elapsed_days;
        while days > 0 {
            value = value.checked_mul(factor).unwrap_or_else(|| {
                soroban_sdk::panic_with_error!(env, ReputationError::ContractStateError)
            }) / Self::SCORE_SCALE;
            if value == 0 {
                break;
            }
            days -= 1;
        }

        Self::clamp_score_i128(value)
    }

    fn decayed_metric_score(env: &Env, metrics: &RoleMetrics) -> i32 {
        if metrics.review.reviews == 0 {
            return metrics.score;
        }
        Self::apply_exponential_decay_bps(env, metrics.score, metrics.review.last_reviewed_at)
    }

    fn badge_level(metrics: &RoleMetrics, is_blacklisted: bool) -> u32 {
        Self::badge_level_for_score(metrics.score, metrics, is_blacklisted)
    }

    fn badge_level_for_score(score: i32, metrics: &RoleMetrics, is_blacklisted: bool) -> u32 {
        // Revoke badge if dispute failures exceed threshold
        if metrics.dispute_failures >= Self::DISPUTE_FAILURE_THRESHOLD {
            return 0;
        }

        if is_blacklisted {
            0
        } else {
            BadgeLevel::from_score(score).to_u32()
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
        metrics.review.last_reviewed_at = env.ledger().timestamp();
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

    fn compute_recovery_towards_default(score: i32, recovery_bps: i32) -> i32 {
        let gap = Self::DEFAULT_SCORE_BPS.saturating_sub(score);
        let recovered =
            score.saturating_add(((gap as i128 * recovery_bps as i128) / Self::SCORE_SCALE) as i32);
        Self::clamp_score(recovered)
    }

    fn apply_dispute_failure(metrics: &mut RoleMetrics, is_blacklisted: bool) {
        metrics.dispute_failures = metrics.dispute_failures.saturating_add(1);
        if metrics.dispute_failures >= Self::DISPUTE_FAILURE_THRESHOLD {
            metrics.score = Self::clamp_score(
                metrics
                    .score
                    .saturating_sub(Self::BADGE_REVOCATION_PENALTY_BPS),
            );
        }
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
}

/// Badge tier determination logic
impl ReputationContract {
    /// Determine badge tier based on reputation score and completed jobs.
    /// Tiers:
    /// - Bronze: score >= 6000 BPS and completed_jobs >= 5
    /// - Silver: score >= 7500 BPS and completed_jobs >= 15
    /// - Gold: score >= 9000 BPS and completed_jobs >= 30
    /// - Platinum: score >= 9500 BPS and completed_jobs >= 50
    fn calculate_badge_tier(score: i32, completed_jobs: u32) -> BadgeTier {
        if score >= 9500 && completed_jobs >= 50 {
            BadgeTier::Platinum
        } else if score >= 9000 && completed_jobs >= 30 {
            BadgeTier::Gold
        } else if score >= 7500 && completed_jobs >= 15 {
            BadgeTier::Silver
        } else if score >= 6000 && completed_jobs >= 5 {
            BadgeTier::Bronze
        } else {
            BadgeTier::None
        }
    }
}

#[contractimpl]
impl ReputationContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Set the JobRegistry contract address (admin only)
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
            .set(&DataKey::JobRegistry, &registry);
    }

    pub fn authorize_contract(env: Env, admin: Address, contract_address: Address) {
        Self::require_admin(&env, &admin);
        env.storage().instance().set(
            &DataKey::AuthorizedContract(contract_address.clone()),
            &true,
        );
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

    pub fn deauthorize_contract(env: Env, admin: Address, contract_address: Address) {
        Self::require_admin(&env, &admin);
        env.storage()
            .instance()
            .remove(&DataKey::AuthorizedContract(contract_address));
        Self::bump_instance_ttl(&env);
    }

    pub fn is_contract_authorized(env: Env, contract_address: Address) -> bool {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get::<_, bool>(&DataKey::AuthorizedContract(contract_address))
            .unwrap_or(false)
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
        // caller must authorize
        caller.require_auth();

        // validate score in 1..=5
        assert!((1u32..=5u32).contains(&score), "score out of range");

        // ensure job registry is configured
        let registry_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::JobRegistry)
            .expect("job registry not set");

        // call JobRegistry.get_job(job_id) and decode into local JobRecord
        let get_sym = Symbol::new(&env, "get_job");
        let args = soroban_sdk::vec![&env, job_id.into_val(&env)];
        let job: JobRecord = env.invoke_contract::<JobRecord>(&registry_addr, &get_sym, args);

        // verify job is completed (ratings only allowed after completion)
        assert!(job.status == JobStatus::Completed, "job not completed");

        // verify caller is participant
        let caller_addr = caller.clone();
        let is_client = caller_addr == job.client;
        let is_freelancer = match job.freelancer.clone() {
            Some(f) => caller_addr == f,
            None => false,
        };
        assert!(is_client || is_freelancer, "unauthorized to rate");

        // prevent double review
        let reviewed_key = DataKey::Reviewed(job_id, caller.clone());
        assert!(
            !env.storage().persistent().has(&reviewed_key),
            "already reviewed"
        );

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

        // Update review metrics
        profile.total_review_points = profile
            .total_review_points
            .saturating_add(score as i32);
        profile.review_count = profile.review_count.saturating_add(1);
        profile.completed_jobs = profile.completed_jobs.saturating_add(1);

        let is_blacklisted = profile.is_blacklisted;
        let (new_score, total_jobs, badge_level, previous_score) = {
            let metrics = Self::role_metrics_mut(&mut profile, &role);
            let previous_score = metrics.score;
            metrics.completed_jobs = metrics.completed_jobs.saturating_add(1);
            Self::apply_manual_delta(metrics, delta, is_blacklisted);
            (
                metrics.score,
                metrics.completed_jobs,
                metrics.badge_level,
                previous_score,
            )
        };
        profile.last_activity = env.ledger().timestamp();

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

    /// Slash address for fraud / abandonment — reduces score by 20%. Only callable by admin or authorized contract.
    pub fn slash(
        env: Env,
        caller_contract: Address,
        address: Address,
        role: Role,
        _reason: Symbol,
    ) {
        Self::require_authorized_contract(&env, &caller_contract);

        let mut profile = storage::read_profile_or_default(&env, &address);
        if profile.is_blacklisted {
            soroban_sdk::panic_with_error!(&env, ReputationError::Blacklisted);
        }

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

        env.storage().persistent().set(&reviewed_key, &true);
    }

    /// Update reputation after a completed job. `delta` in basis points.
    /// Score is clamped to [0, 10000].
    /// Triggers badge upgrade check automatically.
    pub fn update_score(env: Env, address: Address, role: Role, delta: i32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let mut reputation = Self::get_score(env.clone(), address.clone(), role.clone());
        reputation.score = reputation.score.saturating_add(delta).clamp(0, 10_000);
        reputation.total_jobs = reputation.total_jobs.saturating_add(1);

        env.storage().persistent().set(
            &DataKey::Score(reputation.address.clone(), role.clone()),
            &reputation,
        );

        // Also update Profile for badge tracking
        if role == Role::Freelancer {
            let mut profile = Self::load_profile(env.clone(), address.clone(), role.clone());
            profile.completed_jobs = profile.completed_jobs.saturating_add(1);
            profile.reputation_score = reputation.score;
            profile.last_updated = env.ledger().timestamp();

        let is_blacklisted = profile.is_blacklisted;
        let metrics = Self::role_metrics_mut(&mut profile, &role);
        let previous_badge_level = metrics.badge_level;
        let previous_score = metrics.score;

        Self::apply_dispute_failure(metrics, is_blacklisted);

        let new_badge_level = metrics.badge_level;
        let new_score = metrics.score;
        let dispute_failures = metrics.dispute_failures;
        let score_penalty_applied = previous_score != new_score;

        profile.last_activity = env.ledger().timestamp();
        storage::write_profile(&env, &address, &profile);

        env.events().publish(
            ("reputation", "DisputeFailureRecorded"),
            DisputeFailureRecordedEvent {
                address,
                role,
                dispute_failures,
                previous_badge_level,
                new_badge_level,
                score_penalty_applied,
                new_score,
                recorded_at: env.ledger().timestamp(),
            },
        );
        Self::bump_instance_ttl(&env);
    }

    pub fn is_blacklisted(env: Env, address: Address) -> bool {
        Self::bump_instance_ttl(&env);
        storage::read_profile(&env, &address)
            .map(|profile| profile.is_blacklisted)
            .unwrap_or(false)
    }

    /// Return the current badge level for an address/role pair.
    pub fn get_badge(env: Env, address: Address, role: Role) -> BadgeLevel {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        let score = Self::score_from_profile(&env, &address, role, &profile);
        BadgeLevel::from_score(score.score)
    }

    /// Slash address for fraud / abandonment — reduces score by 20%.
    /// Also applies decay to badge if applicable.
    pub fn slash(env: Env, address: Address, role: Role, _reason: Symbol) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
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

        let mut reputation = Self::get_score(env.clone(), address.clone(), role.clone());
        reputation.score = reputation.score.saturating_sub(2000).clamp(0, 10_000);

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
        Self::score_from_profile(&env, &address, role, &profile)
    }

            let new_tier =
                Self::calculate_badge_tier(profile.reputation_score, profile.completed_jobs);
            profile.badge_tier = new_tier;

            Self::save_profile(env, &profile);
        }
    }

    pub fn get_score(env: Env, address: Address, role: Role) -> ReputationScore {
        env.storage()
            .persistent()
            .get(&DataKey::Score(address.clone(), role.clone()))
            .unwrap_or_else(|| ReputationScore {
                address,
                role,
                score: 5000,
                total_jobs: 0,
                total_points: 0,
                reviews: 0,
            })
    }

    /// Frontend-friendly aggregate metrics for public profile pages.
    /// Returns: [score_bps, total_jobs, total_points, reviews]
    pub fn get_public_metrics(env: Env, address: Address, role_name: Symbol) -> Vec<i128> {
        let role = if role_name == Symbol::new(&env, "client") {
            Role::Client
        } else {
            Role::Freelancer
        };
        let rep = Self::get_score(env.clone(), address, role);

        let mut metrics = Vec::new(&env);
        metrics.push_back(rep.score as i128);
        metrics.push_back(rep.total_jobs as i128);
        metrics.push_back(rep.total_points as i128);
        metrics.push_back(rep.reviews as i128);
        metrics
    }

    pub fn query_reputation(env: Env, address: Address) -> ReputationView {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        let client = Self::score_from_profile(&env, &address, Role::Client, &profile);
        let freelancer = Self::score_from_profile(&env, &address, Role::Freelancer, &profile);
        ReputationView {
            address,
            client,
            freelancer,
            is_blacklisted: profile.is_blacklisted,
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
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
            bid_deadline: 0,
            collateral_token: Address::generate(env),
            collateral_amount: 0,
            collateral_locked: false,
        };
        let registry_client = MockJobRegistryClient::new(env, registry);
        registry_client.set_job(&job_id, &job);
    }

    #[test]
    fn test_initial_score() {
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
        assert_eq!(score.total_jobs, 1);
        assert_eq!(score.badge_level, 2);
    }

    #[test]
    fn test_profile_load_save_empty_account() {
        // Test that profiles load and save correctly without panicking on empty accounts
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);

        // Load profile from empty account - should not panic
        let profile = client.get_profile(&address, &Role::Freelancer);

        let score = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(score.score, 8_000);
        assert_eq!(score.badge_level, 3);
    }

    #[test]
    fn test_badge_tier_none() {
        // Test that Badge::None is assigned to new accounts
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
    fn test_update_score() {
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

        client.initialize(&admin);
        client.update_score(&address, &Role::Freelancer, &500);

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
    fn test_badge_upgrade_to_bronze() {
        // Test that badge upgrades to Bronze when score >= 6000 BPS and completed_jobs >= 5
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);

        // Accumulate score and jobs to reach Bronze tier
        for _ in 0..5 {
            client.update_score(&address, &Role::Freelancer, &300);
        }

        // Score should now be 5000 + (300*5) = 6500 BPS
        // Completed jobs should be 5
        let profile = client.get_profile(&address, &Role::Freelancer);
        assert_eq!(profile.reputation_score, 6500);
        assert_eq!(profile.completed_jobs, 5);
        assert_eq!(profile.badge_tier, BadgeTier::Bronze);
    }

    #[test]
    fn test_badge_upgrade_to_silver() {
        // Test badge upgrade to Silver: score >= 7500 BPS, completed_jobs >= 15
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);
        client.set_job_registry(&admin, &registry_id);
        setup_job_with_status(
            &env,
            &registry_id,
            42,
            &job_client,
            &freelancer,
            JobStatus::Assigned,
        );

        let rejected = client.try_submit_rating(&job_client, &42, &freelancer, &5);
        assert!(rejected.is_err());

        let score = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(score.score, 5_000);
        assert_eq!(score.total_jobs, 0);
        assert_eq!(score.total_points, 0);
        assert_eq!(score.reviews, 0);
        assert_eq!(score.badge_level, 1);
    }

        // Reach Silver tier
        for _ in 0..15 {
            client.update_score(&address, &Role::Freelancer, &200);
        }

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
        assert_eq!(score.badge_level, 3);
    }

    #[test]
    fn test_reputation_score_decays_from_review_timestamp() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let client_addr = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let registry_id = env.register_contract(None, MockJobRegistry);
        let client = ReputationContractClient::new(&env, &reputation_id);

        client.initialize(&admin);
        client.set_job_registry(&admin, &registry_id);
        setup_job(&env, &registry_id, 46, &client_addr, &freelancer);

        client.submit_rating(&client_addr, &46, &freelancer, &5);
        assert_eq!(
            client.get_score(&freelancer, &Role::Freelancer).score,
            10_000
        );

        env.ledger().with_mut(|ledger| {
            ledger.timestamp += ReputationContract::SECONDS_PER_DAY;
        });

        let decayed = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(decayed.score, 9_950);
        assert_eq!(decayed.average_rating_bps, 10_000);
        assert_eq!(decayed.reviews, 1);
    }

    #[test]
    fn test_badge_upgrade_to_gold() {
        // Test badge upgrade to Gold: score >= 9000 BPS, completed_jobs >= 30
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);

        // Reach Gold tier
        for _ in 0..30 {
            client.update_score(&address, &Role::Freelancer, &150);
        }

        // Score should be 5000 + (150*30) = 9500 BPS
        let profile = client.get_profile(&address, &Role::Freelancer);
        assert_eq!(profile.reputation_score, 9500);
        assert_eq!(profile.completed_jobs, 30);
        assert_eq!(profile.badge_tier, BadgeTier::Gold);
    }

    #[test]
    fn test_badge_upgrade_to_platinum() {
        // Test badge upgrade to Platinum: score >= 9500 BPS, completed_jobs >= 50
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

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
    fn test_badge_level_changes_immediately() {
        // Test that badge level changes reflect immediately after score update
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

        client.initialize(&admin);

        // Verify initial state
        let profile1 = client.get_profile(&address, &Role::Freelancer);
        assert_eq!(profile1.badge_tier, BadgeTier::None);

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
    fn test_slash() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);
        client.slash(
            &address,
            &Role::Client,
            &soroban_sdk::Symbol::new(&env, "fraud"),
        );

        let score = client.get_score(&address, &Role::Client);
        assert_eq!(score.score, 3000); // 5000 - 2000
    }

    #[test]
    fn test_unverified_review_rejected() {
        // Test that arbitrary direct reviews from unverified public keys are rejected
        // This test verifies the authorization check in submit_rating
        let env = Env::default();

        let admin = Address::generate(&env);
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        // Fetching score for empty account should not panic and return defaults
        let score = client.get_score(&address, &Role::Freelancer);
        assert_eq!(score.score, 5000);
        assert_eq!(score.badge_level, 1);

        let level = client.get_badge_level(&address, &Role::Freelancer);
        assert_eq!(level, 1);
    }

    #[test]
    fn test_badge_upgrades() {
        let env = Env::default();
        env.mock_all_auths();
        client.initialize(&admin);
        env.mock_all_auths_allow_last();

        setup_job(&env, &registry_id, 101, &client_one, &freelancer);
        setup_job(&env, &registry_id, 102, &client_two, &freelancer);
        setup_job(&env, &registry_id, 103, &client_three, &freelancer);

        assert_eq!(client.get_badge_level(&freelancer, &Role::Freelancer), 1);

        client.submit_rating(&client_one, &101, &freelancer, &5);
        assert_eq!(client.get_badge_level(&freelancer, &Role::Freelancer), 4);

        client.submit_rating(&client_two, &102, &freelancer, &5);
        assert_eq!(client.get_badge_level(&freelancer, &Role::Freelancer), 4);

        client.submit_rating(&client_three, &103, &freelancer, &5);
        assert_eq!(client.get_badge_level(&freelancer, &Role::Freelancer), 4);

        // Check public metrics
        let metrics =
            client.get_public_metrics(&freelancer, &soroban_sdk::Symbol::new(&env, "freelancer"));
        assert_eq!(metrics.get(0).unwrap(), 10_000);
        assert_eq!(metrics.get(1).unwrap(), 3);
        assert_eq!(metrics.get(4).unwrap(), 4);
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
        assert_eq!(score.score, 10_000);
        assert_eq!(score.badge_level, 4);

        // First dispute failure - badge should remain
        adjuster.record_dispute_failure(&reputation_id, &freelancer, &Role::Freelancer);
        let score_after_1 = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(score_after_1.badge_level, 4);

        // Second dispute failure - badge should remain
        adjuster.record_dispute_failure(&reputation_id, &freelancer, &Role::Freelancer);
        let score_after_2 = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(score_after_2.badge_level, 4);

        // Third dispute failure - badge should be revoked (threshold = 3)
        adjuster.record_dispute_failure(&reputation_id, &freelancer, &Role::Freelancer);
        let score_after_3 = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(score_after_3.badge_level, 0); // Badge revoked
        assert!(score_after_3.score < 10_000); // Score penalty applied
    }

    #[test]
    fn test_fixed_point_arithmetic() {
        // Test fixed-point arithmetic for safe rating calculations
        
        // Test calculate_avg_rating
        let avg_rating = fixed_point::calculate_avg_rating(15000, 3); // 15000/3 = 5000 = 5.0
        assert_eq!(avg_rating, 5000);

        let avg_rating = fixed_point::calculate_avg_rating(9000, 3); // 9000/3 = 3000 = 3.0
        assert_eq!(avg_rating, 3000);

        let avg_rating = fixed_point::calculate_avg_rating(4500, 2); // 4500/2 = 2250 = 2.25
        assert_eq!(avg_rating, 2250);

        // Edge case: zero count should return 0
        let avg_rating = fixed_point::calculate_avg_rating(5000, 0);
        assert_eq!(avg_rating, 0);
    }

    #[test]
    fn test_fixed_point_decay() {
        // Test exponential decay function
        let initial = 10000;

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

        // 2 periods: 10000 * 0.99 * 0.99 = 9801
        let result = fixed_point::apply_decay(initial, 2);
        assert_eq!(result, 9801);

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
    fn test_badge_downgrade_on_slash() {
        // Test that badge is downgraded when score is reduced
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);
        env.ledger().with_mut(|ledger| {
            ledger.timestamp = 20_000;
        });

        // craft a stale profile with low score and old last_activity
        use crate::profile::Profile;
        let mut profile = Profile::new(&env, address.clone());
        profile.freelancer.score = 2_000;
        profile.freelancer.completed_jobs = 1;
        profile.last_activity = 10_000;

        // write directly into storage
        env.as_contract(&contract_id, || {
            storage::write_profile(&env, &address, &profile);
        });

        // authorize the contract that will call recover
        client.set_authorized_contract(&admin, &authorized_contract);

        // recover 50% of the gap towards default
        client.recover_score(
            &authorized_contract,
            &address,
            &Role::Freelancer,
            &100u64,
            &5_000,
        );

        let profile2 = client.get_profile(&address, &Role::Freelancer);
        assert_eq!(profile2.reputation_score, 4500); // 6500 - 2000
        assert_eq!(profile2.badge_tier, BadgeTier::None); // Below Bronze threshold
    }

    #[test]
    fn test_profile_timestamp_updated() {
        // Test that profile last_updated timestamp is set
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
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
            expires_at: 0,
            status: JobStatus::Completed,
            bid_deadline: 0,
            collateral_token: Address::generate(&env),
            collateral_amount: 0,
            collateral_locked: false,
        };
        let mock_client = MockJobRegistryClient::new(&env, &mock_id);
        mock_client.set_job(&7u64, &job);

        // Attacker who is not part of the job tries to rate the freelancer
        let res = client.try_submit_rating(&attacker, &7u64, &freelancer_addr, &5u32);
        assert!(res.is_err()); // should reject with unauthorized
    }
}

