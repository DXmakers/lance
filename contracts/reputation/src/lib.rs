#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Bytes, BytesN, Env, IntoVal,
    Symbol, Vec,
};

mod profile;
mod storage;

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
    /// Score in basis points (0–10000 = 0–100%)
    pub score: i32,
    pub total_jobs: u32,
    /// Sum of raw rating points (1-5) to compute aggregates off-chain
    pub total_points: i32,
    /// Number of reviews counted
    pub reviews: u32,
    /// Active badge level
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

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    const INSTANCE_TTL_THRESHOLD: u32 = 50_000;
    const INSTANCE_TTL_EXTEND_TO: u32 = 150_000;
    const PERSISTENT_TTL_THRESHOLD: u32 = 50_000;
    const PERSISTENT_TTL_EXTEND_TO: u32 = 150_000;

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(Self::INSTANCE_TTL_THRESHOLD, Self::INSTANCE_TTL_EXTEND_TO);
    }

    fn score_from_rating(score: u32) -> i32 {
        (score as i32).saturating_mul(2_000)
    }

    fn score_from_profile(
        address: &Address,
        role: Role,
        profile: &profile::Profile,
    ) -> ReputationScore {
        match role {
            Role::Client => ReputationScore {
                address: address.clone(),
                role: Role::Client,
                score: profile.client_score,
                total_jobs: profile.client_jobs,
                total_points: if profile.client_reviews_weight == 0 {
                    profile.client_points
                } else {
                    profile.client_points / 10_000
                },
                reviews: profile.client_jobs,
                badge_level: profile.client_badge_level,
            },
            Role::Freelancer => ReputationScore {
                address: address.clone(),
                role: Role::Freelancer,
                score: profile.freelancer_score,
                total_jobs: profile.freelancer_jobs,
                total_points: if profile.freelancer_reviews_weight == 0 {
                    profile.freelancer_points
                } else {
                    profile.freelancer_points / 10_000
                },
                reviews: profile.freelancer_jobs,
                badge_level: profile.freelancer_badge_level,
            },
        }
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

    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        Self::bump_instance_ttl(&env);
    }

    /// Set the JobRegistry contract address (admin only)
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
            let (points, weight) = if profile.client_reviews_weight == 0 {
                ((score as i32) * 10_000, 10_000)
            } else {
                ((profile.client_points * 9) / 10 + (score as i32) * 10_000,
                 (profile.client_reviews_weight * 9) / 10 + 10_000)
            };
            profile.client_points = points;
            profile.client_reviews_weight = weight;
            profile.client_jobs = profile.client_jobs.saturating_add(1);
            
            let avg_rating = (((points as i64) * 10_000) / (weight as i64)) as i32;
            let new_score = Self::clamp_score(avg_rating / 5);
            profile.client_score = new_score;
            profile.client_badge_level = Self::recalculate_badge_level(new_score, profile.client_jobs);
            (
                Role::Client,
                profile.client_points,
                profile.client_jobs,
                profile.client_score,
            )
        } else if job.freelancer.as_ref() == Some(&target) {
            let (points, weight) = if profile.freelancer_reviews_weight == 0 {
                ((score as i32) * 10_000, 10_000)
            } else {
                ((profile.freelancer_points * 9) / 10 + (score as i32) * 10_000,
                 (profile.freelancer_reviews_weight * 9) / 10 + 10_000)
            };
            profile.freelancer_points = points;
            profile.freelancer_reviews_weight = weight;
            profile.freelancer_jobs = profile.freelancer_jobs.saturating_add(1);
            
            let avg_rating = (((points as i64) * 10_000) / (weight as i64)) as i32;
            let new_score = Self::clamp_score(avg_rating / 5);
            profile.freelancer_score = new_score;
            profile.freelancer_badge_level = Self::recalculate_badge_level(new_score, profile.freelancer_jobs);
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
                total_points: if role == Role::Client {
                    profile.client_points / 10_000
                } else {
                    profile.freelancer_points / 10_000
                },
                reviews: total_jobs,
                updated_at: env.ledger().timestamp(),
            },
        );
        Self::bump_instance_ttl(&env);
    }

    /// Update reputation after a completed job. `delta` in basis points.
    /// Score is clamped to [0, 10000]. Only callable by admin or authorized contract address.
    pub fn update_score(env: Env, caller: Address, address: Address, role: Role, delta: i32) {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");

        let is_auth = caller == admin || env.storage().instance().get(&DataKey::AuthorizedContract(caller.clone())).unwrap_or(false);
        if !is_auth {
            soroban_sdk::panic_with_error!(&env, ReputationError::Unauthorized);
        }

        let mut profile = storage::read_profile_or_default(&env, &address);
        let (new_score, total_jobs) = match role {
            Role::Client => {
                profile.client_score =
                    Self::clamp_score(profile.client_score.saturating_add(delta));
                profile.client_jobs = profile.client_jobs.saturating_add(1);
                profile.client_badge_level = Self::recalculate_badge_level(profile.client_score, profile.client_jobs);
                (profile.client_score, profile.client_jobs)
            }
            Role::Freelancer => {
                profile.freelancer_score =
                    Self::clamp_score(profile.freelancer_score.saturating_add(delta));
                profile.freelancer_jobs = profile.freelancer_jobs.saturating_add(1);
                profile.freelancer_badge_level = Self::recalculate_badge_level(profile.freelancer_score, profile.freelancer_jobs);
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
    }

    /// Slash address for fraud / abandonment — reduces score by 20%. Only callable by admin or authorized contract.
    pub fn slash(env: Env, caller: Address, address: Address, role: Role, _reason: Symbol) {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");

        let is_auth = caller == admin || env.storage().instance().get(&DataKey::AuthorizedContract(caller.clone())).unwrap_or(false);
        if !is_auth {
            soroban_sdk::panic_with_error!(&env, ReputationError::Unauthorized);
        }

        let mut profile = storage::read_profile_or_default(&env, &address);
        let (new_score, total_jobs) = match role {
            Role::Client => {
                profile.client_score = Self::clamp_score(profile.client_score.saturating_sub(2000));
                profile.client_badge_level = Self::recalculate_badge_level(profile.client_score, profile.client_jobs);
                (profile.client_score, profile.client_jobs)
            }
            Role::Freelancer => {
                profile.freelancer_score =
                    Self::clamp_score(profile.freelancer_score.saturating_sub(2000));
                profile.freelancer_badge_level = Self::recalculate_badge_level(profile.freelancer_score, profile.freelancer_jobs);
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
            Role::Client => profile.client_badge_level,
            Role::Freelancer => profile.freelancer_badge_level,
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

    /// Get profile metadata hash
    pub fn get_profile_metadata(env: Env, address: Address) -> Option<Bytes> {
        Self::bump_instance_ttl(&env);
        storage::read_profile(&env, &address).and_then(|p| p.metadata_hash)
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
        metrics.push_back(rep.total_points as i128);
        metrics.push_back(rep.reviews as i128);
        metrics.push_back(rep.badge_level as i128);
        metrics
    }

    /// Read both role snapshots for a single address in one call.
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

impl ReputationContract {
    fn clamp_score(value: i32) -> i32 {
        value.clamp(0, 10_000)
    }

    fn recalculate_badge_level(score: i32, completed_jobs: u32) -> u32 {
        if completed_jobs >= 15 && score >= 9000 {
            3
        } else if completed_jobs >= 7 && score >= 8000 {
            2
        } else if completed_jobs >= 3 && score >= 6000 {
            1
        } else {
            0
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

        pub fn get_job(env: Env, _job_id: u64) -> Result<JobRecord, soroban_sdk::Error> {
            Ok(env
                .storage()
                .persistent()
                .get(&MockKey::Job(_job_id))
                .expect("mock job missing"))
        }
    }

    #[test]
    fn test_initial_score() {
        let env = Env::default();
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let score = client.get_score(&address, &Role::Freelancer);
        assert_eq!(score.score, 5000);
        assert_eq!(score.total_jobs, 0);
    }

    #[test]
    fn test_update_score() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);
        client.update_score(&admin, &address, &Role::Freelancer, &500);

        let score = client.get_score(&address, &Role::Freelancer);
        assert_eq!(score.score, 5500);
        assert_eq!(score.total_jobs, 1);
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
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);

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
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);
        client.update_score(&admin, &address, &Role::Freelancer, &1000);
        client.update_score(&admin, &address, &Role::Client, &500);

        let view = client.query_reputation(&address);
        assert_eq!(view.address, address);
        assert_eq!(view.client.score, 5500);
        assert_eq!(view.client.total_jobs, 1);
        assert_eq!(view.client.total_points, 0);
        assert_eq!(view.freelancer.score, 6000);
        assert_eq!(view.freelancer.total_jobs, 1);
        assert_eq!(view.freelancer.total_points, 0);
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
        let address = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.initialize(&admin);

        // Initially level 0
        assert_eq!(client.get_badge_level(&address, &Role::Freelancer), 0);

        // Level 1: score >= 6000 and completed_jobs >= 3
        // First job: score 5500
        client.update_score(&admin, &address, &Role::Freelancer, &500);
        assert_eq!(client.get_badge_level(&address, &Role::Freelancer), 0);

        // Second job: score 6000, total_jobs = 2
        client.update_score(&admin, &address, &Role::Freelancer, &500);
        assert_eq!(client.get_badge_level(&address, &Role::Freelancer), 0);

        // Third job: score 6500, total_jobs = 3 -> Should upgrade to level 1!
        client.update_score(&admin, &address, &Role::Freelancer, &500);
        assert_eq!(client.get_badge_level(&address, &Role::Freelancer), 1);

        // Check public metrics
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
