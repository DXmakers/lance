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
                total_points: profile.client_points,
                reviews: profile.client_jobs,
            },
            Role::Freelancer => ReputationScore {
                address: address.clone(),
                role: Role::Freelancer,
                score: profile.freelancer_score,
                total_jobs: profile.freelancer_jobs,
                total_points: profile.freelancer_points,
                reviews: profile.freelancer_jobs,
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

    /// Update reputation after a completed job. `delta` in basis points.
    /// Score is clamped to [0, 10000].
    pub fn update_score(env: Env, address: Address, role: Role, delta: i32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

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
    }

    /// Slash address for fraud / abandonment — reduces score by 20%.
    pub fn slash(env: Env, address: Address, role: Role, _reason: Symbol) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

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
    }

    pub fn get_score(env: Env, address: Address, role: Role) -> ReputationScore {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        Self::score_from_profile(&address, role, &profile)
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
    /// Returns: [score_bps, total_jobs, total_points, reviews]
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
        client.update_score(&address, &Role::Freelancer, &500);

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
        client.update_score(&address, &Role::Freelancer, &1000);
        // Update client score for SAME address
        client.update_score(&address, &Role::Client, &500);

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
        client.update_score(&address, &Role::Freelancer, &1000);
        client.update_score(&address, &Role::Client, &500);

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
}
