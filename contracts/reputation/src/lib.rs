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
}

#[contracttype]
#[derive(Clone)]
pub struct ContractUpgradedEvent {
    pub by_admin: Address,
    pub new_wasm_hash: BytesN<32>,
    pub upgraded_at: u64,
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
        let job: JobRecord = env
            .invoke_contract::<Result<JobRecord, soroban_sdk::Error>>(
                &registry_addr,
                &get_sym,
                args,
            )
            .unwrap();

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

        // update reputation aggregates for target
        let mut profile = storage::read_profile_or_default(&env, &target);

        // We assume target is a freelancer for now in submit_rating
        // In a more complex system, we might need to know which role was rated.
        profile.freelancer_points = profile.freelancer_points.saturating_add(score as i32);
        profile.freelancer_jobs = profile.freelancer_jobs.saturating_add(1);

        // compute new averaged score in basis points: avg = total_points / jobs, scaled
        let avg = profile.freelancer_points / (profile.freelancer_jobs as i32);
        let bps = avg.saturating_mul(2000); // 1->2000 ... 5->10000
        profile.freelancer_score = Self::clamp_score(bps);

        storage::write_profile(&env, &target, &profile);
        env.storage().persistent().set(&reviewed_key, &true);
        env.storage().persistent().extend_ttl(
            &reviewed_key,
            Self::PERSISTENT_TTL_THRESHOLD,
            Self::PERSISTENT_TTL_EXTEND_TO,
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
        match role {
            Role::Client => {
                profile.client_score =
                    Self::clamp_score(profile.client_score.saturating_add(delta));
                profile.client_jobs = profile.client_jobs.saturating_add(1);
            }
            Role::Freelancer => {
                profile.freelancer_score =
                    Self::clamp_score(profile.freelancer_score.saturating_add(delta));
                profile.freelancer_jobs = profile.freelancer_jobs.saturating_add(1);
            }
        }

        storage::write_profile(&env, &address, &profile);
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
        match role {
            Role::Client => {
                profile.client_score = Self::clamp_score(profile.client_score.saturating_sub(2000));
            }
            Role::Freelancer => {
                profile.freelancer_score =
                    Self::clamp_score(profile.freelancer_score.saturating_sub(2000));
            }
        }

        storage::write_profile(&env, &address, &profile);
        Self::bump_instance_ttl(&env);
    }

    pub fn get_score(env: Env, address: Address, role: Role) -> ReputationScore {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        match role {
            Role::Client => ReputationScore {
                address,
                role: Role::Client,
                score: profile.client_score,
                total_jobs: profile.client_jobs,
                total_points: profile.client_points,
                reviews: profile.client_jobs, // reviews and total_jobs are unified
            },
            Role::Freelancer => ReputationScore {
                address,
                role: Role::Freelancer,
                score: profile.freelancer_score,
                total_jobs: profile.freelancer_jobs,
                total_points: profile.freelancer_points,
                reviews: profile.freelancer_jobs,
            },
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
    /// Returns: [score_bps, total_jobs, total_points, reviews]
    pub fn get_public_metrics(env: Env, address: Address, role_name: Symbol) -> Vec<i128> {
        Self::bump_instance_ttl(&env);
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
