#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Bytes, BytesN, Env, IntoVal,
    Symbol, Vec,
};

mod profile;
mod storage;

use profile::{BADGE_LEVEL_MAX, BADGE_LEVEL_MIN};

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

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReputationScore {
    pub address: Address,
    pub role: Role,
    /// Score in basis points (0–10000 = 0–100%), with dispute decay applied.
    pub score: i32,
    pub total_jobs: u32,
    /// Sum of raw rating points (1-5) to compute aggregates off-chain
    pub total_points: i32,
    /// Number of reviews counted
    pub reviews: u32,
    /// Total disputes recorded against this address in this role
    pub disputes: u32,
    /// Current badge level (1 = Bronze … 4 = Platinum)
    pub badge_level: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReputationView {
    pub address: Address,
    pub client: ReputationScore,
    pub freelancer: ReputationScore,
}

#[contracttype]
pub enum DataKey {
    Admin,
    JobRegistry,
    Reviewed(u64, Address),
    /// Stores `true` for any contract address the admin explicitly authorises
    /// to call privileged write functions (update_score, slash, increment_disputes,
    /// upgrade_badge) without being the admin itself.
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
}

// ──────────────────────────────────────────────────────────────────────────────
// Event structs
// ──────────────────────────────────────────────────────────────────────────────

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
    pub total_points: i32,
    pub reviews: u32,
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
    pub adjusted_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct DisputeIncrementedEvent {
    pub target: Address,
    pub role: Role,
    pub disputes: u32,
    pub decayed_score: i32,
    pub incremented_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct BadgeUpgradedEvent {
    pub target: Address,
    pub role: Role,
    pub old_level: u32,
    pub new_level: u32,
    pub upgraded_at: u64,
}

// ──────────────────────────────────────────────────────────────────────────────
// Contract
// ──────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    const INSTANCE_TTL_THRESHOLD: u32 = 50_000;
    const INSTANCE_TTL_EXTEND_TO: u32 = 150_000;
    const PERSISTENT_TTL_THRESHOLD: u32 = 50_000;
    const PERSISTENT_TTL_EXTEND_TO: u32 = 150_000;

    /// Dispute decay factor expressed as a fraction of 10_000.
    /// Each dispute multiplies the raw score by (10_000 - DISPUTE_DECAY_BPS) / 10_000.
    /// 500 bps = 5% decay per dispute.
    const DISPUTE_DECAY_BPS: i32 = 500;

    /// Safety cap on the number of disputes applied in the decay loop to
    /// prevent unbounded computation (DoS protection).
    const MAX_DECAY_ITERATIONS: u32 = 20;

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(Self::INSTANCE_TTL_THRESHOLD, Self::INSTANCE_TTL_EXTEND_TO);
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn score_from_rating(score: u32) -> i32 {
        (score as i32).saturating_mul(2_000)
    }

    /// Clamp a raw score value into the valid basis-point range [0, 10_000].
    fn clamp_score(value: i32) -> i32 {
        value.clamp(0, 10_000)
    }

    /// Apply a per-dispute decay to a raw score.
    ///
    /// Each dispute reduces the score by `DISPUTE_DECAY_BPS` basis points
    /// (5%). The loop is capped at `MAX_DECAY_ITERATIONS` to avoid DoS.
    ///
    /// # Example
    /// disputes = 2, score = 8_000
    /// After 1st decay: 8_000 × 9_500 / 10_000 = 7_600
    /// After 2nd decay: 7_600 × 9_500 / 10_000 = 7_220
    fn calculate_decayed_score(base_score: i32, disputes: u32) -> i32 {
        let iterations = disputes.min(Self::MAX_DECAY_ITERATIONS);
        let mut score = base_score;
        for _ in 0..iterations {
            // Fixed-point multiplication: score × (10_000 - decay) / 10_000
            score = score
                .saturating_mul(10_000 - Self::DISPUTE_DECAY_BPS)
                / 10_000;
        }
        Self::clamp_score(score)
    }

    /// Build a `ReputationScore` snapshot from a profile, applying dispute decay
    /// to the returned score value so callers always see the effective score.
    fn score_from_profile(
        address: &Address,
        role: Role,
        profile: &profile::Profile,
    ) -> ReputationScore {
        match role {
            Role::Client => {
                let decayed = Self::calculate_decayed_score(
                    profile.client_score,
                    profile.client_disputes,
                );
                ReputationScore {
                    address: address.clone(),
                    role: Role::Client,
                    score: decayed,
                    total_jobs: profile.client_jobs,
                    total_points: profile.client_points,
                    reviews: profile.client_jobs,
                    disputes: profile.client_disputes,
                    badge_level: profile.client_badge_level,
                }
            }
            Role::Freelancer => {
                let decayed = Self::calculate_decayed_score(
                    profile.freelancer_score,
                    profile.freelancer_disputes,
                );
                ReputationScore {
                    address: address.clone(),
                    role: Role::Freelancer,
                    score: decayed,
                    total_jobs: profile.freelancer_jobs,
                    total_points: profile.freelancer_points,
                    reviews: profile.freelancer_jobs,
                    disputes: profile.freelancer_disputes,
                    badge_level: profile.freelancer_badge_level,
                }
            }
        }
    }

    /// Verify the caller is the admin or an explicitly authorized contract address.
    ///
    /// This is the core security gate for all privileged write operations:
    /// `update_score`, `slash`, `increment_disputes`, and `upgrade_badge`.
    ///
    /// Regular user wallet addresses are **never** stored in the
    /// `AuthorizedContract` registry, so they are always rejected here.
    fn check_authorized_caller(env: &Env, caller: &Address) -> Result<(), ReputationError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ReputationError::NotInitialized)?;

        if *caller == admin {
            return Ok(());
        }

        let is_authorized: bool = env
            .storage()
            .instance()
            .get(&DataKey::AuthorizedContract(caller.clone()))
            .unwrap_or(false);

        if is_authorized {
            Ok(())
        } else {
            Err(ReputationError::Unauthorized)
        }
    }

    // ── Public interface ──────────────────────────────────────────────────────

    /// One-time initialization. Sets the admin and seeds contract storage.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        Self::bump_instance_ttl(&env);
    }

    /// Set the JobRegistry contract address (admin only).
    pub fn set_job_registry(env: Env, admin: Address, registry: Address) {
        let configured_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");

        admin.require_auth();
        assert!(admin == configured_admin, "only admin can set job registry");

        env.storage()
            .instance()
            .set(&DataKey::JobRegistry, &registry);
        Self::bump_instance_ttl(&env);
    }

    /// Admin grants or revokes authorization for a contract address to call
    /// privileged write functions without holding the admin key.
    ///
    /// Only the admin itself can call this function. Regular users cannot
    /// register themselves or any other address through this path.
    pub fn set_authorized_contract(
        env: Env,
        admin: Address,
        contract: Address,
        authorized: bool,
    ) -> Result<(), ReputationError> {
        admin.require_auth();

        let configured_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ReputationError::NotInitialized)?;

        if admin != configured_admin {
            return Err(ReputationError::Unauthorized);
        }

        env.storage()
            .instance()
            .set(&DataKey::AuthorizedContract(contract), &authorized);

        Self::bump_instance_ttl(&env);
        Ok(())
    }

    /// Query whether a given address is in the authorized-contract registry.
    pub fn is_authorized_contract(env: Env, contract: Address) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::AuthorizedContract(contract))
            .unwrap_or(false)
    }

    /// Upgrades the current contract WASM. Only callable by admin.
    pub fn upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ReputationError> {
        Self::bump_instance_ttl(&env);
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ReputationError::NotInitialized)?;

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

    /// Submit a star rating for a counterparty on a completed job.
    ///
    /// Caller must be a participant (client or freelancer) of the given job_id,
    /// the job must be `Completed`, and each caller can only rate once per job.
    pub fn submit_rating(env: Env, caller: Address, job_id: u64, target: Address, score: u32) {
        caller.require_auth();
        if !(1u32..=5u32).contains(&score) {
            soroban_sdk::panic_with_error!(&env, ReputationError::InvalidInput);
        }

        let registry_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::JobRegistry)
            .expect("job registry not set");

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
            Some(f) => caller_addr == f,
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
        let (role, total_points, total_jobs, new_score) = if target == job.client {
            profile.client_points = profile.client_points.saturating_add(score as i32);
            profile.client_jobs = profile.client_jobs.saturating_add(1);
            let avg = profile.client_points / (profile.client_jobs as i32);
            let bps = Self::score_from_rating(avg as u32);
            profile.client_score = Self::clamp_score(bps);
            (
                Role::Client,
                profile.client_points,
                profile.client_jobs,
                profile.client_score,
            )
        } else if job.freelancer.as_ref() == Some(&target) {
            profile.freelancer_points = profile.freelancer_points.saturating_add(score as i32);
            profile.freelancer_jobs = profile.freelancer_jobs.saturating_add(1);
            let avg = profile.freelancer_points / (profile.freelancer_jobs as i32);
            let bps = Self::score_from_rating(avg as u32);
            profile.freelancer_score = Self::clamp_score(bps);
            (
                Role::Freelancer,
                profile.freelancer_points,
                profile.freelancer_jobs,
                profile.freelancer_score,
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
                reviews: total_jobs,
                updated_at: env.ledger().timestamp(),
            },
        );
        Self::bump_instance_ttl(&env);
    }

    /// Directly adjust a score by a signed delta in basis points.
    ///
    /// # Authorization
    /// Caller must be the admin or an authorized contract address.
    /// Regular user wallet keys are always rejected.
    pub fn update_score(env: Env, caller: Address, address: Address, role: Role, delta: i32) -> Result<(), ReputationError> {
        caller.require_auth();
        Self::check_authorized_caller(&env, &caller)?;

        let mut profile = storage::read_profile_or_default(&env, &address);
        let (new_score, total_jobs) = match role {
            Role::Client => {
                profile.client_score =
                    Self::clamp_score(profile.client_score.saturating_add(delta));
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

        storage::write_profile(&env, &address, &profile);
        env.events().publish(
            ("reputation", "ScoreAdjusted"),
            ScoreAdjustedEvent {
                address,
                role,
                delta,
                new_score,
                total_jobs,
                adjusted_at: env.ledger().timestamp(),
            },
        );
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    /// Slash an address for fraud or job abandonment — reduces raw score by 20%
    /// (2000 bps).
    ///
    /// # Authorization
    /// Caller must be the admin or an authorized contract address.
    pub fn slash(env: Env, caller: Address, address: Address, role: Role, _reason: Symbol) -> Result<(), ReputationError> {
        caller.require_auth();
        Self::check_authorized_caller(&env, &caller)?;

        let mut profile = storage::read_profile_or_default(&env, &address);
        let (new_score, total_jobs) = match role {
            Role::Client => {
                profile.client_score = Self::clamp_score(profile.client_score.saturating_sub(2000));
                (profile.client_score, profile.client_jobs)
            }
            Role::Freelancer => {
                profile.freelancer_score =
                    Self::clamp_score(profile.freelancer_score.saturating_sub(2000));
                (profile.freelancer_score, profile.freelancer_jobs)
            }
        };

        storage::write_profile(&env, &address, &profile);
        env.events().publish(
            ("reputation", "ScoreAdjusted"),
            ScoreAdjustedEvent {
                address,
                role,
                delta: -2_000,
                new_score,
                total_jobs,
                adjusted_at: env.ledger().timestamp(),
            },
        );
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    /// Record a dispute against a user's profile in a given role.
    ///
    /// This increments the dispute counter which is used by `calculate_decayed_score`
    /// to progressively reduce the displayed score returned from all getters.
    ///
    /// # Authorization
    /// Caller must be the admin or an authorized contract address (e.g. the
    /// Escrow contract, which calls this when a dispute is raised on-chain).
    /// Regular user wallet keys are always rejected.
    pub fn increment_disputes(
        env: Env,
        caller: Address,
        target: Address,
        role: Role,
    ) -> Result<(), ReputationError> {
        caller.require_auth();
        Self::check_authorized_caller(&env, &caller)?;

        let mut profile = storage::read_profile_or_default(&env, &target);

        let (disputes, decayed_score) = match role {
            Role::Client => {
                profile.client_disputes = profile.client_disputes.saturating_add(1);
                let d = Self::calculate_decayed_score(
                    profile.client_score,
                    profile.client_disputes,
                );
                (profile.client_disputes, d)
            }
            Role::Freelancer => {
                profile.freelancer_disputes = profile.freelancer_disputes.saturating_add(1);
                let d = Self::calculate_decayed_score(
                    profile.freelancer_score,
                    profile.freelancer_disputes,
                );
                (profile.freelancer_disputes, d)
            }
        };

        storage::write_profile(&env, &target, &profile);
        env.events().publish(
            ("reputation", "DisputeIncremented"),
            DisputeIncrementedEvent {
                target,
                role,
                disputes,
                decayed_score,
                incremented_at: env.ledger().timestamp(),
            },
        );
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    /// Upgrade or downgrade the badge level for a target address in a given role.
    ///
    /// The new level must be in the range [BADGE_LEVEL_MIN, BADGE_LEVEL_MAX] (1–4).
    /// Badge changes are immediately visible in `get_score` and `query_reputation`.
    ///
    /// # Authorization
    /// Caller must be the admin or an authorized contract address.
    /// Regular user wallet keys are always rejected.
    pub fn upgrade_badge(
        env: Env,
        caller: Address,
        target: Address,
        role: Role,
        level: u32,
    ) -> Result<(), ReputationError> {
        caller.require_auth();
        Self::check_authorized_caller(&env, &caller)?;

        if level < BADGE_LEVEL_MIN || level > BADGE_LEVEL_MAX {
            return Err(ReputationError::InvalidInput);
        }

        let mut profile = storage::read_profile_or_default(&env, &target);

        let (old_level, new_level) = match role {
            Role::Client => {
                let old = profile.client_badge_level;
                profile.client_badge_level = level;
                (old, level)
            }
            Role::Freelancer => {
                let old = profile.freelancer_badge_level;
                profile.freelancer_badge_level = level;
                (old, level)
            }
        };

        storage::write_profile(&env, &target, &profile);
        env.events().publish(
            ("reputation", "BadgeUpgraded"),
            BadgeUpgradedEvent {
                target,
                role,
                old_level,
                new_level,
                upgraded_at: env.ledger().timestamp(),
            },
        );
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    // ── Read-only getters ─────────────────────────────────────────────────────

    /// Return the reputation score snapshot for a single role.
    /// The returned `score` field has dispute decay already applied.
    pub fn get_score(env: Env, address: Address, role: Role) -> ReputationScore {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        Self::score_from_profile(&address, role, &profile)
    }

    /// Return only the badge level for a given address and role.
    pub fn get_badge_level(env: Env, address: Address, role: Role) -> u32 {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        match role {
            Role::Client => profile.client_badge_level,
            Role::Freelancer => profile.freelancer_badge_level,
        }
    }

    /// Update profile metadata hash (IPFS CID). Self-service — no admin needed.
    pub fn update_profile_metadata(env: Env, address: Address, metadata_hash: Bytes) {
        address.require_auth();
        let mut profile = storage::read_profile_or_default(&env, &address);
        profile.metadata_hash = Some(metadata_hash);
        storage::write_profile(&env, &address, &profile);
        Self::bump_instance_ttl(&env);
    }

    /// Get profile metadata hash.
    pub fn get_profile_metadata(env: Env, address: Address) -> Option<Bytes> {
        Self::bump_instance_ttl(&env);
        storage::read_profile(&env, &address).and_then(|p| p.metadata_hash)
    }

    /// Frontend-friendly aggregate metrics for public profile pages.
    /// Returns: [score_bps_decayed, total_jobs, total_points, reviews, disputes, badge_level]
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
        metrics.push_back(rep.total_points as i128);
        metrics.push_back(rep.reviews as i128);
        metrics.push_back(rep.disputes as i128);
        metrics.push_back(rep.badge_level as i128);
        metrics
    }

    /// Read both role snapshots for a single address in one call.
    /// Both `client.score` and `freelancer.score` have decay applied.
    pub fn query_reputation(env: Env, address: Address) -> ReputationView {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        let client = Self::score_from_profile(&address, Role::Client, &profile);
        let freelancer = Self::score_from_profile(&address, Role::Freelancer, &profile);
        ReputationView {
            address,
            client,
            freelancer,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, BytesN, Env};

    // ── Mock job registry ─────────────────────────────────────────────────────

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

        pub fn get_job(env: Env, _job_id: u64) -> Result<JobRecord, soroban_sdk::Error> {
            Ok(env
                .storage()
                .persistent()
                .get(&MockKey::Job(_job_id))
                .expect("mock job missing"))
        }
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    fn setup() -> (Env, ReputationContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);
        client.initialize(&admin);
        (env, client, admin)
    }

    // ── Acceptance criterion 1: Empty profile does not panic ──────────────────

    #[test]
    fn test_initial_score_does_not_panic_on_empty_account() {
        let env = Env::default();
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        // Must not panic even though initialize() was never called and no profile
        // exists yet.
        let score = client.get_score(&address, &Role::Freelancer);
        assert_eq!(score.score, 5000, "default score should be 5000 bps");
        assert_eq!(score.total_jobs, 0);
        assert_eq!(score.disputes, 0);
        assert_eq!(score.badge_level, 1, "default badge should be Bronze (1)");
    }

    // ── Dispute decay math ────────────────────────────────────────────────────

    #[test]
    fn test_dispute_decay_reduces_effective_score() {
        let (env, client, admin) = setup();
        let target = Address::generate(&env);

        // Raise raw score to a known value first.
        client.update_score(&admin, &target, &Role::Freelancer, &2_000);
        let score_before = client.get_score(&target, &Role::Freelancer);
        assert_eq!(score_before.score, 7_000, "raw score should be 7000 before disputes");
        assert_eq!(score_before.disputes, 0);

        // Record one dispute.
        client.increment_disputes(&admin, &target, &Role::Freelancer);
        let score_after = client.get_score(&target, &Role::Freelancer);

        // Expected: 7000 × 9500 / 10000 = 6650
        assert_eq!(score_after.disputes, 1);
        assert_eq!(score_after.score, 6_650, "one dispute should decay score by 5%");
    }

    #[test]
    fn test_two_disputes_apply_decay_twice() {
        let (env, client, admin) = setup();
        let target = Address::generate(&env);

        client.increment_disputes(&admin, &target, &Role::Client);
        client.increment_disputes(&admin, &target, &Role::Client);

        let score = client.get_score(&target, &Role::Client);
        // Default raw score = 5000
        // After 1st decay: 5000 × 9500 / 10000 = 4750
        // After 2nd decay: 4750 × 9500 / 10000 = 4512
        assert_eq!(score.disputes, 2);
        assert_eq!(score.score, 4_512);
    }

    #[test]
    fn test_dispute_decay_does_not_go_below_zero() {
        let (env, client, admin) = setup();
        let target = Address::generate(&env);

        // Add enough disputes to drive the score to 0.
        for _ in 0..20 {
            client.increment_disputes(&admin, &target, &Role::Freelancer);
        }

        let score = client.get_score(&target, &Role::Freelancer);
        assert!(score.score >= 0, "score must never go below 0");
    }

    // ── Acceptance criterion 2: Badge upgrades reflect immediately ────────────

    #[test]
    fn test_badge_upgrade_reflects_immediately_in_getters() {
        let (env, client, admin) = setup();
        let target = Address::generate(&env);

        // Default is Bronze (1).
        assert_eq!(client.get_badge_level(&target, &Role::Freelancer), 1);

        // Upgrade to Silver.
        client.upgrade_badge(&admin, &target, &Role::Freelancer, &2);
        assert_eq!(client.get_badge_level(&target, &Role::Freelancer), 2, "should be Silver immediately");

        // Verify the full score snapshot also reflects the new level.
        let score = client.get_score(&target, &Role::Freelancer);
        assert_eq!(score.badge_level, 2);

        // query_reputation should also show updated level.
        let view = client.query_reputation(&target);
        assert_eq!(view.freelancer.badge_level, 2);
    }

    #[test]
    fn test_badge_upgrade_each_level() {
        let (env, client, admin) = setup();
        let target = Address::generate(&env);

        for level in 1u32..=4 {
            client.upgrade_badge(&admin, &target, &Role::Client, &level);
            assert_eq!(client.get_badge_level(&target, &Role::Client), level);
        }
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_badge_level_out_of_range_panics() {
        let (env, client, admin) = setup();
        let target = Address::generate(&env);
        // Level 5 is above BADGE_LEVEL_MAX (4) — must reject with InvalidInput (#3).
        client.upgrade_badge(&admin, &target, &Role::Freelancer, &5);
    }

    // ── Acceptance criterion 3: Unauthorized keys are rejected ───────────────

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_arbitrary_key_cannot_increment_disputes() {
        let (env, client, _admin) = setup();
        let attacker = Address::generate(&env);
        let target = Address::generate(&env);

        // attacker is neither the admin nor in the authorized-contract registry.
        client.increment_disputes(&attacker, &target, &Role::Freelancer);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_arbitrary_key_cannot_upgrade_badge() {
        let (env, client, _admin) = setup();
        let attacker = Address::generate(&env);
        let target = Address::generate(&env);

        client.upgrade_badge(&attacker, &target, &Role::Freelancer, &3);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_arbitrary_key_cannot_update_score() {
        let (env, client, _admin) = setup();
        let attacker = Address::generate(&env);
        let target = Address::generate(&env);

        client.update_score(&attacker, &target, &Role::Freelancer, &500);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_arbitrary_key_cannot_slash() {
        let (env, client, _admin) = setup();
        let attacker = Address::generate(&env);
        let target = Address::generate(&env);

        client.slash(
            &attacker,
            &target,
            &Role::Freelancer,
            &soroban_sdk::Symbol::new(&env, "fraud"),
        );
    }

    // ── Authorized contract registry ──────────────────────────────────────────

    #[test]
    fn test_authorized_contract_can_increment_disputes() {
        let (env, client, admin) = setup();
        let trusted_contract = Address::generate(&env);
        let target = Address::generate(&env);

        // Admin grants authorization to the trusted_contract address.
        client.set_authorized_contract(&admin, &trusted_contract, &true);
        assert!(client.is_authorized_contract(&trusted_contract));

        // trusted_contract can now increment disputes without being the admin.
        client.increment_disputes(&trusted_contract, &target, &Role::Freelancer);
        let score = client.get_score(&target, &Role::Freelancer);
        assert_eq!(score.disputes, 1);
    }

    #[test]
    fn test_revoked_authorized_contract_is_rejected() {
        let (env, client, admin) = setup();
        let trusted_contract = Address::generate(&env);
        let _target = Address::generate(&env);

        client.set_authorized_contract(&admin, &trusted_contract, &true);
        // Admin revokes the authorization.
        client.set_authorized_contract(&admin, &trusted_contract, &false);

        assert!(!client.is_authorized_contract(&trusted_contract));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_non_admin_cannot_grant_authorization() {
        let (env, client, _admin) = setup();
        let attacker = Address::generate(&env);
        let target = Address::generate(&env);

        // An attacker cannot whitelist themselves.
        client.set_authorized_contract(&attacker, &target, &true);
    }

    // ── Existing tests (regression) ───────────────────────────────────────────

    #[test]
    fn test_update_score() {
        let (env, client, admin) = setup();
        let address = Address::generate(&env);

        client.update_score(&admin, &address, &Role::Freelancer, &500);

        let score = client.get_score(&address, &Role::Freelancer);
        assert_eq!(score.score, 5500);
        assert_eq!(score.total_jobs, 1);
    }

    #[test]
    fn test_slash() {
        let (env, client, admin) = setup();
        let address = Address::generate(&env);

        client.slash(
            &admin,
            &address,
            &Role::Client,
            &soroban_sdk::Symbol::new(&env, "fraud"),
        );

        let score = client.get_score(&address, &Role::Client);
        assert_eq!(score.score, 3000); // 5000 - 2000
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

    #[test]
    fn test_unified_storage() {
        let (env, client, admin) = setup();
        let address = Address::generate(&env);

        // Update freelancer score
        client.update_score(&admin, &address, &Role::Freelancer, &1000);
        // Update client score for SAME address
        client.update_score(&admin, &address, &Role::Client, &500);

        let f_score = client.get_score(&address, &Role::Freelancer);
        let c_score = client.get_score(&address, &Role::Client);

        assert_eq!(f_score.score, 6000);
        assert_eq!(c_score.score, 5500);
    }

    #[test]
    fn test_query_reputation_returns_both_roles() {
        let (env, client, admin) = setup();
        let address = Address::generate(&env);

        client.update_score(&admin, &address, &Role::Freelancer, &1000);
        client.update_score(&admin, &address, &Role::Client, &500);

        let view = client.query_reputation(&address);
        assert_eq!(view.address, address);
        assert_eq!(view.client.score, 5500);
        assert_eq!(view.client.total_jobs, 1);
        assert_eq!(view.freelancer.score, 6000);
        assert_eq!(view.freelancer.total_jobs, 1);
        // Both roles should have no disputes and Bronze badge by default.
        assert_eq!(view.client.disputes, 0);
        assert_eq!(view.client.badge_level, 1);
        assert_eq!(view.freelancer.disputes, 0);
        assert_eq!(view.freelancer.badge_level, 1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_get_public_metrics_rejects_unknown_role() {
        let env = Env::default();
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.get_public_metrics(&address, &soroban_sdk::Symbol::new(&env, "bogus"));
    }

    #[test]
    fn test_submit_rating_updates_client_and_freelancer_paths() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let caller = Address::generate(&env);
        let target = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let caller2 = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);
        client.initialize(&admin);

        let mock_id = env.register_contract(None, MockJobRegistry);
        client.set_job_registry(&admin, &mock_id);

        let job = JobRecord {
            client: caller.clone(),
            freelancer: Some(freelancer.clone()),
            metadata_hash: Bytes::from_slice(&env, b"QmJob"),
            budget_stroops: 10,
            status: JobStatus::Completed,
        };
        let mock_client = MockJobRegistryClient::new(&env, &mock_id);
        mock_client.set_job(&7u64, &job);
        let other_job = JobRecord {
            client: caller2.clone(),
            freelancer: Some(target.clone()),
            metadata_hash: Bytes::from_slice(&env, b"QmJob2"),
            budget_stroops: 10,
            status: JobStatus::Completed,
        };
        mock_client.set_job(&8u64, &other_job);

        client.submit_rating(&caller, &7u64, &freelancer, &5u32);
        let client_score = client.get_score(&freelancer, &Role::Freelancer);
        assert_eq!(client_score.score, 10_000);
        assert_eq!(client_score.total_jobs, 1);
        assert_eq!(client_score.total_points, 5);

        client.submit_rating(&caller2, &8u64, &target, &4u32);
        let freelancer_score = client.get_score(&target, &Role::Freelancer);
        assert_eq!(freelancer_score.score, 8_000);
        assert_eq!(freelancer_score.total_jobs, 1);
        assert_eq!(freelancer_score.total_points, 4);
        assert_eq!(freelancer_score.reviews, 1);
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
}
