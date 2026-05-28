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

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReputationScore {
    pub address: Address,
    pub role: Role,
    /// Score in basis points (0\u201310000 = 0\u2013100%)
    pub score: i32,
    pub total_jobs: u32,
    pub total_points: i128,
    pub reviews: u32,
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
        let authorized_contract = Self::read_authorized_updater(env);
        caller_contract.require_auth();
        if *caller_contract != authorized_contract {
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

    fn score_from_profile(address: &Address, role: Role, profile: &profile::Profile) -> ReputationScore {
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

    fn apply_review(env: &Env, metrics: &mut RoleMetrics, score: u32) {
        metrics.review.total_points =
            Self::checked_add_points(env, metrics.review.total_points, score);
        metrics.review.reviews = metrics.review.reviews.saturating_add(1);
        metrics.completed_jobs = metrics.completed_jobs.saturating_add(1);
        metrics.review.average_rating_bps =
            Self::average_rating_bps(env, metrics.review.total_points, metrics.review.reviews);
        metrics.score = metrics.review.average_rating_bps;
    }

    fn apply_manual_delta(metrics: &mut RoleMetrics, delta: i32) {
        metrics.score = Self::clamp_score(metrics.score.saturating_add(delta));
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
                Self::apply_review(&env, &mut profile.client, score);
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
                Self::apply_review(&env, &mut profile.freelancer, score);
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

    pub fn update_score(env: Env, caller_contract: Address, address: Address, role: Role, delta: i32) {
        Self::require_authorized_contract(&env, &caller_contract);

        let mut profile = storage::read_profile_or_default(&env, &address);
        let (new_score, total_jobs) = match role {
            Role::Client => {
                profile.client_score = Self::clamp_score(profile.client_score.saturating_add(delta));
                profile.client_jobs = profile.client_jobs.saturating_add(1);
                (profile.client_score, profile.client_jobs)
            }
            Role::Freelancer => {
                profile.freelancer_score =
                    Self::clamp_score(profile.freelancer_score.saturating_add(delta));
                profile.freelancer_jobs = profile.freelancer_jobs.saturating_add(1);
                (profile.freelancer_score, profile.freelancer_jobs)
            }
        };
        if profile.is_blacklisted {
            soroban_sdk::panic_with_error!(&env, ReputationError::Blacklisted);
        }

        let previous_score = Self::role_metrics(&profile, &role).score;
        Self::apply_manual_delta(Self::role_metrics_mut(&mut profile, &role), delta);
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
            Self::apply_role_decay(
                &env,
                &mut profile.freelancer,
                Self::BLACKLIST_DECAY_BPS,
            );
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

    pub fn get_score(env: Env, address: Address, role: Role) -> ReputationScore {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        Self::score_from_profile(&address, role, &profile)
    }

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

    // ── Badge functions ────────────────────────────────────────────

    pub fn get_badge(env: Env, address: Address, role: Role) -> BadgeLevel {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        let metrics = Self::role_metrics(&profile, &role);
        BadgeLevel::from_score(metrics.score)
    }

    pub fn set_badge_metadata(
        env: Env,
        admin: Address,
        address: Address,
        tier: BadgeTier,
        uri: Bytes,
    ) {
        Self::require_admin(&env, &admin);
        let mut profile = storage::read_profile_or_default(&env, &address);

        // Remove existing entry for this tier, then push new one
        let mut new_entries = soroban_sdk::Vec::new(&env);
        for entry in profile.badge_metadata.iter() {
            if entry.tier != tier {
                new_entries.push_back(entry);
            }
        }
        new_entries.push_back(BadgeMetadataEntry { tier, uri });
        profile.badge_metadata = new_entries;

        storage::write_profile(&env, &address, &profile);
        Self::bump_instance_ttl(&env);
    }

    pub fn get_badge_metadata(
        env: Env,
        address: Address,
        tier: BadgeTier,
    ) -> Option<Bytes> {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        for entry in profile.badge_metadata.iter() {
            if entry.tier == tier {
                return Some(entry.uri);
            }
        }
        None
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
            env.storage()
                .persistent()
                .set(&MockKey::Job(job_id), &job);
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
            status: JobStatus::Completed,
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
        assert_eq!(score.badge_level, BadgeLevel::Silver as u32);
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
        assert_eq!(score.badge_level, BadgeLevel::Gold as u32);
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
        assert_eq!(after_first.get(4), Some(BadgeLevel::Platinum as i128));

        client.submit_rating(&client_two, &12, &freelancer, &5);
        let after_second = client.get_public_metrics(&freelancer, &Symbol::new(&env, "freelancer"));
        assert_eq!(after_second.get(4), Some(BadgeLevel::Platinum as i128));

        client.submit_rating(&client_three, &13, &freelancer, &5);
        let after_third = client.get_public_metrics(&freelancer, &Symbol::new(&env, "freelancer"));
        assert_eq!(after_third.get(4), Some(BadgeLevel::Platinum as i128));
        assert_eq!(after_third.get(5), Some(10_000));

        let score = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(score.badge_level, BadgeLevel::Platinum as u32);
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
        assert_eq!(freelancer_score.badge_level, BadgeLevel::Platinum as u32);

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

    // --- SC-REP-050: Contract-to-Contract Auth Gating Tests ---

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_unauthorized_contract_update_score_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let authorized_id = env.register_contract(None, AuthorizedAdjuster);
        let unauthorized_id = env.register_contract(None, AuthorizedAdjuster);
        let target = Address::generate(&env);
        let client = ReputationContractClient::new(&env, &reputation_id);

        client.initialize(&admin);
        // Only `authorized_id` is registered; `unauthorized_id` must be rejected.
        client.set_authorized_contract(&admin, &authorized_id);

        let unauthorized_client = AuthorizedAdjusterClient::new(&env, &unauthorized_id);
        unauthorized_client.award(&reputation_id, &target, &Role::Freelancer, &500);
    }

    #[test]
    fn test_authorized_contract_can_be_replaced_by_admin() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let target = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let old_adjuster_id = env.register_contract(None, AuthorizedAdjuster);
        let new_adjuster_id = env.register_contract(None, AuthorizedAdjuster);
        let client = ReputationContractClient::new(&env, &reputation_id);
        let new_adjuster = AuthorizedAdjusterClient::new(&env, &new_adjuster_id);

        client.initialize(&admin);
        client.set_authorized_contract(&admin, &old_adjuster_id);

        // Admin rotates the authorized contract to a new address.
        client.set_authorized_contract(&admin, &new_adjuster_id);

        // New authorized contract can modify scores.
        new_adjuster.award(&reputation_id, &target, &Role::Client, &2_000);
        let score = client.get_score(&target, &Role::Client);
        assert_eq!(score.score, 7_000);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_slash_requires_authorized_contract() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let target = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let authorized_id = env.register_contract(None, AuthorizedAdjuster);
        let rogue_id = env.register_contract(None, AuthorizedAdjuster);
        let client = ReputationContractClient::new(&env, &reputation_id);
        let rogue = AuthorizedAdjusterClient::new(&env, &rogue_id);

        client.initialize(&admin);
        client.set_authorized_contract(&admin, &authorized_id);

        rogue.slash(
            &reputation_id,
            &target,
            &Role::Freelancer,
            &Symbol::new(&env, "fraud"),
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_blacklist_requires_authorized_contract() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let target = Address::generate(&env);
        let reputation_id = env.register_contract(None, ReputationContract);
        let authorized_id = env.register_contract(None, AuthorizedAdjuster);
        let rogue_id = env.register_contract(None, AuthorizedAdjuster);
        let client = ReputationContractClient::new(&env, &reputation_id);
        let rogue = AuthorizedAdjusterClient::new(&env, &rogue_id);

        client.initialize(&admin);
        client.set_authorized_contract(&admin, &authorized_id);

        rogue.blacklist(&reputation_id, &target, &Symbol::new(&env, "fraud"));
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

    // ── Issue #406: badge metadata mapping ──

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
}
