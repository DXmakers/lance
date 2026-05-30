#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Bytes, BytesN, Env, IntoVal,
    Symbol, Vec,
};
pub use profile::BadgeLevel;

mod profile;
mod storage;
pub use profile::{BadgeMetadataEntry, BadgeTier};

use profile::{Profile, RoleMetrics};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum JobStatus {
    Open,
    Assigned,
    DeliverableSubmitted,
    Completed,
    Disputed,
    Expired,
}

#[contracttype]
#[derive(Clone)]
pub struct JobRecord {
    pub client: Address,
    pub freelancer: Option<Address>,
    pub metadata_hash: Bytes,
    pub budget_stroops: i128,
    pub expires_at: u64,
    pub status: JobStatus,
    pub bid_deadline: u64,
    pub collateral_token: Address,
    pub collateral_amount: i128,
    pub collateral_locked: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Role {
    Client,
    Freelancer,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReputationScore {
    pub address: Address,
    pub role: Role,
    pub score: i32,
    pub total_jobs: u32,
    pub total_points: i128,
    pub reviews: u32,
    /// Active badge level
    pub badge_level: u32,
    pub average_rating_bps: i32,
    pub blacklisted: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReputationView {
    pub address: Address,
    pub client: ReputationScore,
    pub freelancer: ReputationScore,
    pub is_blacklisted: bool,
}

/// Peer-to-peer validator staking record (SC-REP-044).
///
/// Tracks the cumulative stake a validator has committed against a specific
/// `(target, role)` reputation score, the net basis-point adjustment they have
/// applied, and how many adjustments they have made. Token custody itself
/// remains the responsibility of the authorized marketplace contract that
/// invokes the adjustment routine; this record is accounting-only.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ValidatorStake {
    pub validator: Address,
    pub target: Address,
    pub role: Role,
    pub staked_amount: i128,
    pub total_adjustment_bps: i32,
    pub adjustment_count: u32,
    pub last_updated: u64,
}

#[contracttype]
pub enum DataKey {
    Admin,
    JobRegistry,
    AuthorizedUpdater,
    Reviewed(u64, Address),
    AuthorizedContract(Address),
    ValidatorStake(Address, Address, Role),
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
    ProfileNotFound = 9,
    TransferBlocked = 10,
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
    pub rating: u32,
    pub new_score: i32,
    pub total_jobs: u32,
    pub total_points: i128,
    pub reviews: u32,
    pub average_rating_bps: i32,
    pub badge_level: u32,
    pub blacklisted: bool,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct ScoreAdjustedEvent {
    pub address: Address,
    pub role: Role,
    pub delta: i32,
    pub new_score: i32,
    pub total_jobs: u32,
    pub badge_level: u32,
    pub adjusted_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct AuthorizedContractUpdatedEvent {
    pub by_admin: Address,
    pub contract_address: Address,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct BlacklistUpdatedEvent {
    pub address: Address,
    pub is_blacklisted: bool,
    pub client_score: i32,
    pub freelancer_score: i32,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct TransferBlockedEvent {
    pub address: Address,
    pub blocked: bool,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct ProfileDeletedEvent {
    pub address: Address,
    pub deleted_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct ValidatorAdjustmentEvent {
    pub validator: Address,
    pub target: Address,
    pub role: Role,
    pub stake_amount: i128,
    pub requested_delta_bps: i32,
    pub effective_delta: i32,
    pub new_score: i32,
    pub adjusted_at: u64,
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
    /// Stake amount that grants a validator full (1.0x) weight on their delta.
    const FULL_VALIDATOR_STAKE: i128 = 1_000_000;
    /// Maximum absolute basis-point delta a single validator adjustment may request.
    const MAX_VALIDATOR_DELTA_BPS: i32 = 2_000;

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

    /// Weight a validator's requested basis-point delta by the fraction of the
    /// full stake they have committed, using checked fixed-point arithmetic.
    ///
    /// The requested delta is first bounded to ±`MAX_VALIDATOR_DELTA_BPS`, then
    /// scaled by `min(stake_amount / FULL_VALIDATOR_STAKE, 1.0)`. A non-zero
    /// bounded delta never rounds all the way to zero: it keeps at least its
    /// sign so a staked adjustment always moves the score by at least one bps.
    fn stake_weighted_delta(delta_bps: i32, stake_amount: i128, full_stake: i128) -> i32 {
        if stake_amount <= 0 || full_stake <= 0 {
            return 0;
        }

        let bounded_delta =
            delta_bps.clamp(-Self::MAX_VALIDATOR_DELTA_BPS, Self::MAX_VALIDATOR_DELTA_BPS);
        let stake_bps = stake_amount
            .saturating_mul(10_000)
            .checked_div(full_stake)
            .unwrap_or(0)
            .clamp(0, 10_000);
        let weighted = (bounded_delta as i128)
            .saturating_mul(stake_bps)
            .checked_div(10_000)
            .unwrap_or(0);

        if weighted == 0 && bounded_delta != 0 {
            bounded_delta.signum()
        } else {
            weighted as i32
        }
    }

    fn read_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| soroban_sdk::panic_with_error!(env, ReputationError::NotInitialized))
    }

    fn read_authorized_updater(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::AuthorizedUpdater)
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
        let is_authorized: bool = env
            .storage()
            .instance()
            .get(&DataKey::AuthorizedContract(caller_contract.clone()))
            .unwrap_or(false);
        if !is_authorized {
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
        address: &Address,
        role: Role,
        profile: &Profile,
    ) -> ReputationScore {
        let metrics = Self::role_metrics(profile, &role);
        ReputationScore {
            address: address.clone(),
            role,
            score: metrics.score,
            total_jobs: metrics.completed_jobs,
            total_points: metrics.review.total_points,
            reviews: metrics.review.reviews,
            average_rating_bps: metrics.review.average_rating_bps,
            badge_level: metrics.badge_level,
            blacklisted: profile.is_blacklisted,
        }
    }

    fn checked_add_points(env: &Env, current: i128, incoming: u32) -> i128 {
        current
            .checked_add(incoming as i128)
            .unwrap_or_else(|| soroban_sdk::panic_with_error!(env, ReputationError::ContractStateError))
    }

    fn average_rating_bps(env: &Env, total_points: i128, reviews: u32) -> i32 {
        if reviews == 0 {
            return Self::DEFAULT_SCORE_BPS;
        }

        let numerator = total_points
            .checked_mul(Self::SCORE_SCALE)
            .unwrap_or_else(|| soroban_sdk::panic_with_error!(env, ReputationError::ContractStateError));
        let denominator = (reviews as i128)
            .checked_mul(Self::MAX_RATING)
            .unwrap_or_else(|| soroban_sdk::panic_with_error!(env, ReputationError::ContractStateError));

        if denominator == 0 {
            return Self::DEFAULT_SCORE_BPS;
        }

        Self::clamp_score_i128(numerator / denominator)
    }

    fn apply_decay_bps(env: &Env, score: i32, decay_bps: i32) -> i32 {
        let decayed = (score as i128)
            .checked_mul(decay_bps as i128)
            .unwrap_or_else(|| soroban_sdk::panic_with_error!(env, ReputationError::ContractStateError))
            / Self::SCORE_SCALE;
        Self::clamp_score_i128(decayed)
    }

    fn badge_level(metrics: &RoleMetrics, is_blacklisted: bool) -> u32 {
        if is_blacklisted {
            0
        } else if metrics.completed_jobs >= 15 && metrics.score >= 9_000 {
            3
        } else if metrics.completed_jobs >= 7 && metrics.score >= 8_000 {
            2
        } else if metrics.completed_jobs >= 3 && metrics.score >= 6_000 {
            1
        } else {
            0
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

    fn apply_role_decay(env: &Env, metrics: &mut RoleMetrics, decay_bps: i32) {
        metrics.score = Self::apply_decay_bps(env, metrics.score, decay_bps);
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
            return Err(ReputationError::Unauthorized);
        }

        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        env.events().publish(
            ("reputation", "ContractUpgraded"),
            ContractUpgradedEvent {
                by_admin: caller,
                new_wasm_hash,
                upgraded_at: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        Self::bump_instance_ttl(&env);
    }

    pub fn set_job_registry(env: Env, admin: Address, registry: Address) {
        Self::require_admin(&env, &admin);
        env.storage().instance().set(&DataKey::JobRegistry, &registry);
        Self::bump_instance_ttl(&env);
    }

    pub fn set_authorized_contract(env: Env, admin: Address, contract_address: Address) {
        Self::require_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedUpdater, &contract_address);
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedContract(contract_address.clone()), &true);
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

    /// Authorize a contract address (admin only)
    pub fn authorize_contract(env: Env, admin: Address, contract: Address) {
        admin.require_auth();
        let configured_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        assert!(admin == configured_admin, "only admin can authorize contracts");

        env.storage()
            .instance()
            .set(&DataKey::AuthorizedContract(contract), &true);
        Self::bump_instance_ttl(&env);
    }

    /// Deauthorize a contract address (admin only)
    pub fn deauthorize_contract(env: Env, admin: Address, contract: Address) {
        admin.require_auth();
        let configured_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        assert!(admin == configured_admin, "only admin can deauthorize contracts");

        env.storage()
            .instance()
            .remove(&DataKey::AuthorizedContract(contract));
        Self::bump_instance_ttl(&env);
    }

    /// Check if a contract is authorized
    pub fn is_contract_authorized(env: Env, contract: Address) -> bool {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::AuthorizedContract(contract))
            .unwrap_or(false)
    }

    /// Submit a rating for a target address tied to a Job ID. Caller must be the client or freelancer
    /// on the job, and the job must be Completed.
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
                Self::apply_review(&env, &mut profile.client, score, profile.is_blacklisted);
                profile.refresh_badges();
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
                Self::apply_review(&env, &mut profile.freelancer, score, profile.is_blacklisted);
                profile.refresh_badges();
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
    pub fn update_score(env: Env, caller_contract: Address, address: Address, role: Role, delta: i32) {
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

        profile.refresh_badges();
        let new_score = Self::role_metrics(&profile, &role).score;
        let total_jobs = Self::role_metrics(&profile, &role).completed_jobs;
        let badge_level = Self::role_metrics(&profile, &role).badge_level;
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

    /// Peer-to-peer validator staking adjustment (SC-REP-044).
    ///
    /// An authorized marketplace contract relays a validator's staked vote to
    /// nudge a target's `(role)` reputation score. The requested `delta_bps` is
    /// weighted by the validator's stake (see [`stake_weighted_delta`]) before
    /// being applied through the same clamped, badge-refreshing path as
    /// `update_score`. The per-`(validator, target, role)` staking record is
    /// updated and the effective delta is returned.
    ///
    /// Auth: the call must originate from the authorized contract AND carry the
    /// validator's own authorization, so arbitrary public keys cannot stake on
    /// another validator's behalf.
    pub fn submit_validator_adjustment(
        env: Env,
        caller_contract: Address,
        validator: Address,
        target: Address,
        role: Role,
        delta_bps: i32,
        stake_amount: i128,
    ) -> i32 {
        Self::require_authorized_contract(&env, &caller_contract);
        validator.require_auth();
        if stake_amount <= 0 {
            soroban_sdk::panic_with_error!(&env, ReputationError::InvalidInput);
        }

        let mut profile = storage::read_profile_or_default(&env, &target);
        if profile.is_blacklisted {
            soroban_sdk::panic_with_error!(&env, ReputationError::Blacklisted);
        }

        let effective_delta =
            Self::stake_weighted_delta(delta_bps, stake_amount, Self::FULL_VALIDATOR_STAKE);

        let is_blacklisted = profile.is_blacklisted;
        Self::apply_manual_delta(
            Self::role_metrics_mut(&mut profile, &role),
            effective_delta,
            is_blacklisted,
        );
        profile.refresh_badges();
        let new_score = Self::role_metrics(&profile, &role).score;
        storage::write_profile(&env, &target, &profile);

        let key = DataKey::ValidatorStake(validator.clone(), target.clone(), role.clone());
        let mut stake = env
            .storage()
            .persistent()
            .get::<DataKey, ValidatorStake>(&key)
            .unwrap_or_else(|| ValidatorStake {
                validator: validator.clone(),
                target: target.clone(),
                role: role.clone(),
                staked_amount: 0,
                total_adjustment_bps: 0,
                adjustment_count: 0,
                last_updated: env.ledger().timestamp(),
            });
        stake.staked_amount = stake.staked_amount.saturating_add(stake_amount);
        stake.total_adjustment_bps = stake
            .total_adjustment_bps
            .saturating_add(effective_delta)
            .clamp(-(Self::SCORE_SCALE as i32), Self::SCORE_SCALE as i32);
        stake.adjustment_count = stake.adjustment_count.saturating_add(1);
        stake.last_updated = env.ledger().timestamp();
        env.storage().persistent().set(&key, &stake);
        env.storage().persistent().extend_ttl(
            &key,
            Self::PERSISTENT_TTL_THRESHOLD,
            Self::PERSISTENT_TTL_EXTEND_TO,
        );

        env.events().publish(
            ("reputation", "ValidatorAdjustment"),
            ValidatorAdjustmentEvent {
                validator,
                target,
                role,
                stake_amount,
                requested_delta_bps: delta_bps,
                effective_delta,
                new_score,
                adjusted_at: env.ledger().timestamp(),
            },
        );
        Self::bump_instance_ttl(&env);

        effective_delta
    }

    /// Read the cumulative validator staking record for a `(validator, target, role)`.
    /// Returns a zeroed record (never panics) when no stake exists yet.
    pub fn get_validator_stake(
        env: Env,
        validator: Address,
        target: Address,
        role: Role,
    ) -> ValidatorStake {
        Self::bump_instance_ttl(&env);
        let key = DataKey::ValidatorStake(validator.clone(), target.clone(), role.clone());
        if env.storage().persistent().has(&key) {
            env.storage().persistent().extend_ttl(
                &key,
                Self::PERSISTENT_TTL_THRESHOLD,
                Self::PERSISTENT_TTL_EXTEND_TO,
            );
        }
        env.storage()
            .persistent()
            .get::<DataKey, ValidatorStake>(&key)
            .unwrap_or(ValidatorStake {
                validator,
                target,
                role,
                staked_amount: 0,
                total_adjustment_bps: 0,
                adjustment_count: 0,
                last_updated: env.ledger().timestamp(),
            })
    }

    /// Slash address for fraud / abandonment — reduces score by 20%. Only callable by admin or authorized contract.
    pub fn slash(env: Env, caller_contract: Address, address: Address, role: Role, _reason: Symbol) {
        Self::require_authorized_contract(&env, &caller_contract);

        let mut profile = storage::read_profile_or_default(&env, &address);
        if profile.is_blacklisted {
            soroban_sdk::panic_with_error!(&env, ReputationError::Blacklisted);
        }

        let previous_score = Self::role_metrics(&profile, &role).score;
        Self::apply_role_decay(&env, Self::role_metrics_mut(&mut profile, &role), Self::SLASH_DECAY_BPS);
        profile.refresh_badges();
        let new_score = Self::role_metrics(&profile, &role).score;
        let total_jobs = Self::role_metrics(&profile, &role).completed_jobs;
        let badge_level = Self::role_metrics(&profile, &role).badge_level;
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

    pub fn blacklist_profile(env: Env, caller_contract: Address, address: Address, _reason: Symbol) {
        Self::require_authorized_contract(&env, &caller_contract);

        let mut profile = storage::read_profile_or_default(&env, &address);
        if !profile.is_blacklisted {
            profile.is_blacklisted = true;
            Self::apply_role_decay(&env, &mut profile.client, Self::BLACKLIST_DECAY_BPS);
            Self::refresh_badge(&mut profile.client, true);
            Self::apply_role_decay(
                &env,
                &mut profile.freelancer,
                Self::BLACKLIST_DECAY_BPS,
            );
            Self::refresh_badge(&mut profile.freelancer, true);
            profile.refresh_badges();
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
        match role {
            Role::Client => profile.client_badge,
            Role::Freelancer => profile.freelancer_badge,
        }
    }

    /// Admin-only: set the decentralised-storage URI for a badge tier.
    /// `uri` is typically an IPFS CID pointing to the badge image/JSON.
    pub fn set_badge_metadata(
        env: Env,
        admin: Address,
        address: Address,
        tier: BadgeTier,
        uri: Bytes,
    ) {
        let configured_admin: Address = env
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
                profile.badge_metadata.set(i, BadgeMetadataEntry { tier: tier.clone(), uri: uri.clone() });
                found = true;
                break;
            }
        }
        if !found {
            profile.badge_metadata.push_back(BadgeMetadataEntry { tier, uri });
        }

        storage::write_profile(&env, &address, &profile);
        Self::bump_instance_ttl(&env);
    }

    /// Return the metadata URI for a given badge tier, or `None` if not set.
    pub fn get_badge_metadata(
        env: Env,
        address: Address,
        tier: BadgeTier,
    ) -> Option<Bytes> {
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

    // ── Issue #408: Transfer Blockers ──────────────────────────────

    pub fn set_transfer_blocked(env: Env, admin: Address, address: Address, blocked: bool) {
        Self::require_admin(&env, &admin);
        let mut profile = storage::read_profile_or_default(&env, &address);
        profile.transfer_blocked = blocked;
        storage::write_profile(&env, &address, &profile);
        env.events().publish(
            ("reputation", "TransferBlocked"),
            TransferBlockedEvent {
                address,
                blocked,
                updated_at: env.ledger().timestamp(),
            },
        );
        Self::bump_instance_ttl(&env);
    }

    pub fn is_transfer_blocked(env: Env, address: Address) -> bool {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        profile.transfer_blocked
    }

    // ── Issue #411: Profile Existence Checkpoint ───────────────────

    pub fn profile_exists(env: Env, address: Address) -> bool {
        Self::bump_instance_ttl(&env);
        storage::profile_exists(&env, &address)
    }

    // ── Issue #412: Storage Rent Rebate on Delete ──────────────────

    pub fn delete_profile(env: Env, admin: Address, address: Address) -> bool {
        Self::require_admin(&env, &admin);
        let deleted = storage::delete_profile(&env, &address);
        if deleted {
            env.events().publish(
                ("reputation", "ProfileDeleted"),
                ProfileDeletedEvent {
                    address,
                    deleted_at: env.ledger().timestamp(),
                },
            );
        }
        Self::bump_instance_ttl(&env);
        deleted
    }

    // ── Issue #413: Bulk Reputation Lookups ────────────────────────

    pub fn get_scores_bulk(
        env: Env,
        addresses: Vec<Address>,
        role: Role,
    ) -> Vec<ReputationScore> {
        Self::bump_instance_ttl(&env);
        let mut results = Vec::new(&env);
        for addr in addresses.iter() {
            let profile = storage::read_profile_or_default(&env, &addr);
            results.push_back(Self::score_from_profile(&addr, role.clone(), &profile));
        }
        results
    }

    pub fn query_reputations_bulk(
        env: Env,
        addresses: Vec<Address>,
    ) -> Vec<ReputationView> {
        Self::bump_instance_ttl(&env);
        let mut results = Vec::new(&env);
        for addr in addresses.iter() {
            let profile = storage::read_profile_or_default(&env, &addr);
            results.push_back(ReputationView {
                address: addr.clone(),
                client: Self::score_from_profile(&addr, Role::Client, &profile),
                freelancer: Self::score_from_profile(&addr, Role::Freelancer, &profile),
                is_blacklisted: profile.is_blacklisted,
            });
        }
        results
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

        pub fn validator_adjust(
            env: Env,
            reputation: Address,
            validator: Address,
            target: Address,
            role: Role,
            delta_bps: i32,
            stake_amount: i128,
        ) -> i32 {
            let reputation_client = ReputationContractClient::new(&env, &reputation);
            let caller_contract = env.current_contract_address();
            reputation_client.submit_validator_adjustment(
                &caller_contract,
                &validator,
                &target,
                &role,
                &delta_bps,
                &stake_amount,
            )
        }
    }

    fn setup_job(
        env: &Env,
        registry: &Address,
        job_id: u64,
        client_address: &Address,
        freelancer: &Address,
    ) {
        let job = JobRecord {
            client: client_address.clone(),
            freelancer: Some(freelancer.clone()),
            metadata_hash: Bytes::from_slice(env, b"QmJob"),
            budget_stroops: 10,
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
        assert_eq!(score.badge_level, 0);
        assert!(!score.blacklisted);

        let view = client.query_reputation(&address);
        assert_eq!(view.client.score, 5_000);
        assert_eq!(view.freelancer.score, 5_000);
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
        assert_eq!(score.badge_level, 0);
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
        assert_eq!(score.badge_level, 0);
    }

    #[test]
    fn test_badge_upgrades_reflect_immediately_in_public_getters() {
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

        setup_job(&env, &registry_id, 11, &client_one, &freelancer);
        setup_job(&env, &registry_id, 12, &client_two, &freelancer);
        setup_job(&env, &registry_id, 13, &client_three, &freelancer);

        client.submit_rating(&client_one, &11, &freelancer, &5);
        let after_first = client.get_public_metrics(&freelancer, &Symbol::new(&env, "freelancer"));
        assert_eq!(after_first.get(4), Some(0));

        client.submit_rating(&client_two, &12, &freelancer, &5);
        let after_second = client.get_public_metrics(&freelancer, &Symbol::new(&env, "freelancer"));
        assert_eq!(after_second.get(4), Some(0));

        client.submit_rating(&client_three, &13, &freelancer, &5);
        let after_third = client.get_public_metrics(&freelancer, &Symbol::new(&env, "freelancer"));
        assert_eq!(after_third.get(4), Some(1));
        assert_eq!(after_third.get(5), Some(10_000));

        let score = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(score.badge_level, 1);
        assert_eq!(score.total_jobs, 3);
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
        assert_eq!(freelancer_score.badge_level, 0);

        client.submit_rating(&caller_two, &8, &target, &4);
        let second_freelancer_score = client.get_score(&target, &Role::Freelancer);
        assert_eq!(second_freelancer_score.score, 8_000);
        assert_eq!(second_freelancer_score.total_jobs, 1);
        assert_eq!(second_freelancer_score.total_points, 4);
        assert_eq!(second_freelancer_score.reviews, 1);
        assert_eq!(second_freelancer_score.average_rating_bps, 8_000);
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
        let client = ReputationContractClient::new(&env, &cid);
        client.initialize(&admin);
        client.set_authorized_contract(&admin, &admin);

        // Raise score by 1000 ΓåÆ 5000+1000 = 6000 ΓåÆ Silver
        client.update_score(&admin, &addr, &Role::Freelancer, &1000);
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
        let client = ReputationContractClient::new(&env, &cid);
        client.initialize(&admin);
        client.set_authorized_contract(&admin, &admin);

        client.update_score(&admin, &addr, &Role::Freelancer, &3000); // 5000+3000=8000
        assert_eq!(client.get_badge(&addr, &Role::Freelancer), BadgeLevel::Gold);
    }

    #[test]
    fn test_slash_downgrades_badge() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let addr = Address::generate(&env);
        let cid = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &cid);
        client.initialize(&admin);
        client.set_authorized_contract(&admin, &admin);

        // Bring to Gold first, then slash twice to drop back to Bronze
        client.update_score(&admin, &addr, &Role::Client, &3000); // 8000 ΓåÆ Gold
        assert_eq!(client.get_badge(&addr, &Role::Client), BadgeLevel::Gold);
        client.slash(&admin, &addr, &Role::Client, &soroban_sdk::Symbol::new(&env, "fraud")); // 6000 ΓåÆ Silver
        assert_eq!(client.get_badge(&addr, &Role::Client), BadgeLevel::Silver);
        client.slash(&admin, &addr, &Role::Client, &soroban_sdk::Symbol::new(&env, "fraud")); // 4000 ΓåÆ Bronze
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
        let addr = Address::generate(&env);
        let cid = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &cid);

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

        assert_eq!(client.get_badge_metadata(&addr, &BadgeTier::Silver), Some(uri_v2));
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
        let gold_uri   = Bytes::from_slice(&env, b"ipfs://Gold");
        client.set_badge_metadata(&admin, &addr, &BadgeTier::Bronze, &bronze_uri);
        client.set_badge_metadata(&admin, &addr, &BadgeTier::Gold,   &gold_uri);

        assert_eq!(client.get_badge_metadata(&addr, &BadgeTier::Bronze), Some(bronze_uri));
        assert_eq!(client.get_badge_metadata(&addr, &BadgeTier::Gold),   Some(gold_uri));
        assert_eq!(client.get_badge_metadata(&addr, &BadgeTier::Silver), None);
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

    // ── Issue #408: Transfer Blockers ──────────────────────────────

    #[test]
    fn test_transfer_blocked_by_default() {
        let env = Env::default();
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        assert!(client.is_transfer_blocked(&address));
    }

    #[test]
    fn test_admin_can_toggle_transfer_block() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);
        assert!(client.is_transfer_blocked(&address));

        client.set_transfer_blocked(&admin, &address, &false);
        assert!(!client.is_transfer_blocked(&address));

        client.set_transfer_blocked(&admin, &address, &true);
        assert!(client.is_transfer_blocked(&address));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_non_admin_cannot_toggle_transfer_block() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);
        client.set_transfer_blocked(&attacker, &address, &false);
    }

    // ── Upstream: empty account & badge upgrade tests ──────────────

    #[test]
    fn test_empty_account_load_save() {
        let env = Env::default();
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

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
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);
        client.set_authorized_contract(&admin, &admin);

        assert_eq!(client.get_badge_level(&address, &Role::Freelancer), 0);

        client.update_score(&admin, &address, &Role::Freelancer, &500);
        assert_eq!(client.get_badge_level(&address, &Role::Freelancer), 0);

        client.update_score(&admin, &address, &Role::Freelancer, &500);
        assert_eq!(client.get_badge_level(&address, &Role::Freelancer), 0);

        client.update_score(&admin, &address, &Role::Freelancer, &500);
        assert_eq!(client.get_badge_level(&address, &Role::Freelancer), 1);

        let metrics = client.get_public_metrics(&address, &soroban_sdk::Symbol::new(&env, "freelancer"));
        assert_eq!(metrics.get(0).unwrap(), 6500);
        assert_eq!(metrics.get(1).unwrap(), 3);
        assert_eq!(metrics.get(4).unwrap(), 1);
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

        client.authorize_contract(&admin, &authorized_contract);
        assert!(client.is_contract_authorized(&authorized_contract));
        assert!(!client.is_contract_authorized(&unauthorized_contract));

        client.update_score(&authorized_contract, &address, &Role::Freelancer, &100);
        let score = client.get_score(&address, &Role::Freelancer);
        assert_eq!(score.score, 5100);

        let res = client.try_update_score(&unauthorized_contract, &address, &Role::Freelancer, &100);
        assert!(res.is_err());

        client.deauthorize_contract(&admin, &authorized_contract);
        assert!(!client.is_contract_authorized(&authorized_contract));

        let res2 = client.try_update_score(&authorized_contract, &address, &Role::Freelancer, &100);
        assert!(res2.is_err());
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

        let res = client.try_submit_rating(&attacker, &7u64, &freelancer_addr, &5u32);
        assert!(res.is_err());
    }

    // ── Issue #411: Profile Existence Checkpoint ───────────────────

    #[test]
    fn test_profile_exists_returns_false_for_unknown() {
        let env = Env::default();
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        assert!(!client.profile_exists(&address));
    }

    #[test]
    fn test_profile_exists_returns_true_after_rating() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let job_client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let registry_id = env.register_contract(None, MockJobRegistry);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);
        client.set_job_registry(&admin, &registry_id);
        setup_job(&env, &registry_id, 50, &job_client, &freelancer);

        assert!(!client.profile_exists(&freelancer));
        client.submit_rating(&job_client, &50, &freelancer, &5);
        assert!(client.profile_exists(&freelancer));
    }

    // ── Issue #412: Storage Rent Rebate on Delete ──────────────────

    #[test]
    fn test_delete_profile_removes_storage() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let job_client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let registry_id = env.register_contract(None, MockJobRegistry);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);
        client.set_job_registry(&admin, &registry_id);
        setup_job(&env, &registry_id, 60, &job_client, &freelancer);

        client.submit_rating(&job_client, &60, &freelancer, &5);
        assert!(client.profile_exists(&freelancer));

        let deleted = client.delete_profile(&admin, &freelancer);
        assert!(deleted);
        assert!(!client.profile_exists(&freelancer));
    }

    #[test]
    fn test_delete_nonexistent_profile_returns_false() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);
        let deleted = client.delete_profile(&admin, &address);
        assert!(!deleted);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_delete_profile_requires_admin() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);
        client.delete_profile(&attacker, &address);
    }

    // ── Issue #413: Bulk Reputation Lookups ────────────────────────

    #[test]
    fn test_get_scores_bulk_empty() {
        let env = Env::default();
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let addresses = Vec::new(&env);
        let results = client.get_scores_bulk(&addresses, &Role::Freelancer);
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_get_scores_bulk_returns_defaults_for_unknown() {
        let env = Env::default();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let mut addresses = Vec::new(&env);
        addresses.push_back(a.clone());
        addresses.push_back(b.clone());

        let results = client.get_scores_bulk(&addresses, &Role::Freelancer);
        assert_eq!(results.len(), 2);
        assert_eq!(results.get_unchecked(0).score, 5_000);
        assert_eq!(results.get_unchecked(1).score, 5_000);
    }

    #[test]
    fn test_query_reputations_bulk() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let job_client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let registry_id = env.register_contract(None, MockJobRegistry);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);
        client.set_job_registry(&admin, &registry_id);
        setup_job(&env, &registry_id, 70, &job_client, &freelancer);
        client.submit_rating(&job_client, &70, &freelancer, &4);

        let mut addresses = Vec::new(&env);
        addresses.push_back(freelancer.clone());
        addresses.push_back(job_client.clone());

        let results = client.query_reputations_bulk(&addresses);
        assert_eq!(results.len(), 2);

        let freelancer_view = results.get_unchecked(0);
        assert_eq!(freelancer_view.freelancer.score, 8_000);
        assert_eq!(freelancer_view.freelancer.total_jobs, 1);

        let client_view = results.get_unchecked(1);
        assert_eq!(client_view.client.score, 5_000);
        assert_eq!(client_view.client.total_jobs, 0);
    }

    // ── SC-REP-044: Peer-to-Peer Validator Staking ─────────────────

    #[test]
    fn test_validator_stake_adjustment_is_weighted_and_recorded() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();

        let admin = Address::generate(&env);
        let validator = Address::generate(&env);
        let target = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let adjuster_id = env.register_contract(None, AuthorizedAdjuster);
        let client = ReputationContractClient::new(&env, &reputation_id);
        let adjuster = AuthorizedAdjusterClient::new(&env, &adjuster_id);

        client.initialize(&admin);
        client.set_authorized_contract(&admin, &adjuster_id);

        // Half the full stake (500k / 1M) halves a +1000 bps request to +500.
        let effective = adjuster.validator_adjust(
            &reputation_id,
            &validator,
            &target,
            &Role::Freelancer,
            &1_000,
            &500_000,
        );
        assert_eq!(effective, 500);

        // Default score 5000 + 500 = 5500.
        let score = client.get_score(&target, &Role::Freelancer);
        assert_eq!(score.score, 5_500);

        let stake = client.get_validator_stake(&validator, &target, &Role::Freelancer);
        assert_eq!(stake.staked_amount, 500_000);
        assert_eq!(stake.total_adjustment_bps, 500);
        assert_eq!(stake.adjustment_count, 1);
    }

    #[test]
    fn test_validator_stake_accumulates_across_adjustments() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();

        let admin = Address::generate(&env);
        let validator = Address::generate(&env);
        let target = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let adjuster_id = env.register_contract(None, AuthorizedAdjuster);
        let client = ReputationContractClient::new(&env, &reputation_id);
        let adjuster = AuthorizedAdjusterClient::new(&env, &adjuster_id);

        client.initialize(&admin);
        client.set_authorized_contract(&admin, &adjuster_id);

        adjuster.validator_adjust(&reputation_id, &validator, &target, &Role::Freelancer, &1_000, &500_000);
        adjuster.validator_adjust(&reputation_id, &validator, &target, &Role::Freelancer, &1_000, &500_000);

        let stake = client.get_validator_stake(&validator, &target, &Role::Freelancer);
        assert_eq!(stake.staked_amount, 1_000_000);
        assert_eq!(stake.total_adjustment_bps, 1_000);
        assert_eq!(stake.adjustment_count, 2);

        // 5000 + 500 + 500 = 6000.
        assert_eq!(client.get_score(&target, &Role::Freelancer).score, 6_000);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_validator_adjustment_rejects_unauthorized_caller() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let validator = Address::generate(&env);
        let target = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);

        // `attacker` is not an authorized contract → Unauthorized (#2).
        client.submit_validator_adjustment(
            &attacker,
            &validator,
            &target,
            &Role::Freelancer,
            &1_000,
            &500_000,
        );
    }

    #[test]
    fn test_empty_validator_stake_reads_are_safe() {
        let env = Env::default();
        let validator = Address::generate(&env);
        let target = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let stake = client.get_validator_stake(&validator, &target, &Role::Freelancer);
        assert_eq!(stake.staked_amount, 0);
        assert_eq!(stake.total_adjustment_bps, 0);
        assert_eq!(stake.adjustment_count, 0);
    }
}
