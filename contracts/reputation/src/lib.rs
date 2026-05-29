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
    pub average_rating_bps: i32,
    pub badge_level: u32,
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

#[contracttype]
pub enum DataKey {
    Admin,
    JobRegistry,
    AuthorizedUpdater,
    Reviewed(u64, Address),
    AuthorizedContract(Address),
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
pub struct DisputeFailureRecordedEvent {
    pub address: Address,
    pub role: Role,
    pub dispute_failures: u32,
    pub previous_badge_level: u32,
    pub new_badge_level: u32,
    pub score_penalty_applied: bool,
    pub new_score: i32,
    pub recorded_at: u64,
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
        // Revoke badge if dispute failures exceed threshold
        if metrics.dispute_failures >= Self::DISPUTE_FAILURE_THRESHOLD {
            return 0;
        }
        
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

    fn apply_role_decay(env: &Env, metrics: &mut RoleMetrics, decay_bps: i32, is_blacklisted: bool) {
        metrics.score = Self::apply_decay_bps(env, metrics.score, decay_bps);
        Self::refresh_badge(metrics, is_blacklisted);
    }

    /// Record a dispute failure and apply badge revocation if threshold is exceeded
    fn record_dispute_failure(env: &Env, metrics: &mut RoleMetrics, is_blacklisted: bool) {
        metrics.dispute_failures = metrics.dispute_failures.saturating_add(1);
        
        // If dispute failures exceed threshold, revoke badge and apply penalty
        if metrics.dispute_failures >= Self::DISPUTE_FAILURE_THRESHOLD {
            let previous_badge_level = metrics.badge_level;
            metrics.score = Self::apply_decay_bps(env, metrics.score, Self::BADGE_REVOCATION_PENALTY_BPS);
            Self::refresh_badge(metrics, is_blacklisted);
            
            // Badge was revoked if it went from >0 to 0
            if previous_badge_level > 0 && metrics.badge_level == 0 {
                // Badge revocation occurred
            }
        } else {
            Self::refresh_badge(metrics, is_blacklisted);
        }
    }

    fn compute_recovery_towards_default(current: i32, recovery_bps: i32) -> i32 {
        // Move `current` towards DEFAULT_SCORE_BPS by `recovery_bps` (bps of the gap)
        let gap = (Self::DEFAULT_SCORE_BPS as i128) - (current as i128);
        if gap == 0 {
            return current;
        }
        let adj = (gap * (recovery_bps as i128)) / (Self::SCORE_SCALE as i128);
        let result = (current as i128) + adj;
        // clamp to valid range
        Self::clamp_score_i128(result)
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
        Self::require_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedContract(contract), &true);
        Self::bump_instance_ttl(&env);
    }

    /// Deauthorize a contract address (admin only)
    pub fn deauthorize_contract(env: Env, admin: Address, contract: Address) {
        Self::require_admin(&env, &admin);
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
        profile.last_activity = env.ledger().timestamp();
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

    /// Slash address for fraud / abandonment — reduces score by 20%. Only callable by admin or authorized contract.
    pub fn slash(env: Env, caller_contract: Address, address: Address, role: Role, _reason: Symbol) {
        Self::require_authorized_contract(&env, &caller_contract);

        let mut profile = storage::read_profile_or_default(&env, &address);
        if profile.is_blacklisted {
            soroban_sdk::panic_with_error!(&env, ReputationError::Blacklisted);
        }

        let is_blacklisted = profile.is_blacklisted;
        let metrics = Self::role_metrics_mut(&mut profile, &role);
        let previous_score = metrics.score;
        Self::apply_role_decay(&env, metrics, Self::SLASH_DECAY_BPS, is_blacklisted);
        profile.last_activity = env.ledger().timestamp();
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

    pub fn blacklist_profile(env: Env, caller_contract: Address, address: Address, _reason: Symbol) {
        Self::require_authorized_contract(&env, &caller_contract);

        let mut profile = storage::read_profile_or_default(&env, &address);
        if !profile.is_blacklisted {
            profile.is_blacklisted = true;
            let is_blacklisted = profile.is_blacklisted;
            Self::apply_role_decay(&env, &mut profile.client, Self::BLACKLIST_DECAY_BPS, is_blacklisted);
            Self::apply_role_decay(
                &env,
                &mut profile.freelancer,
                Self::BLACKLIST_DECAY_BPS,
                is_blacklisted,
            );
            profile.last_activity = env.ledger().timestamp();
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
        let now = env.ledger().timestamp();
        if now <= last || now.saturating_sub(last) < lookback_seconds {
            soroban_sdk::panic_with_error!(&env, ReputationError::InvalidInput);
        }

        let is_blacklisted = profile.is_blacklisted;
        let metrics = Self::role_metrics_mut(&mut profile, &role);
        let previous_score = metrics.score;
        let new_score = Self::compute_recovery_towards_default(previous_score, recovery_bps);
        metrics.score = new_score;
        Self::refresh_badge(metrics, is_blacklisted);
        let total_jobs = metrics.completed_jobs;
        let badge_level = metrics.badge_level;
        profile.last_activity = now;

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

    /// Record a dispute failure for an address. If dispute failures exceed threshold,
    /// the badge is revoked and a score penalty is applied. Only callable by authorized contract.
    pub fn record_dispute_failure(
        env: Env,
        caller_contract: Address,
        address: Address,
        role: Role,
    ) {
        Self::require_authorized_contract(&env, &caller_contract);

        let mut profile = storage::read_profile_or_default(&env, &address);
        if profile.is_blacklisted {
            soroban_sdk::panic_with_error!(&env, ReputationError::Blacklisted);
        }

        let is_blacklisted = profile.is_blacklisted;
        let metrics = Self::role_metrics_mut(&mut profile, &role);
        let previous_badge_level = metrics.badge_level;
        let previous_score = metrics.score;
        
        Self::record_dispute_failure(&env, metrics, is_blacklisted);
        
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
        assert_eq!(score.total_jobs, 0);
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

        let metrics = client.get_public_metrics(&freelancer, &soroban_sdk::Symbol::new(&env, "freelancer"));
        assert_eq!(metrics.get(0).unwrap(), 10_000);
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
        let res = client.try_update_score(&unauthorized_contract, &address, &Role::Freelancer, &100);
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
    }
}
