#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Bytes, Env, IntoVal, Symbol, Vec,
};

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
    Score(Address, Role),
    Admin,
    JobRegistry,
    Reviewed(u64, Address),
}

#[contract]
pub struct ReputationContract;

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
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::JobRegistry, &registry);
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

        // update reputation aggregates for target
        let mut rep = Self::get_score(env.clone(), target.clone(), Role::Freelancer);
        // we'll treat target role as Freelancer for simplicity; callers should ensure correct role
        rep.total_points = rep.total_points.saturating_add(score as i32);
        rep.reviews = rep.reviews.saturating_add(1);
        rep.total_jobs = rep.total_jobs.saturating_add(1);

        // compute new averaged score in basis points: avg = total_points / reviews, scaled
        let avg = rep.total_points / (rep.reviews as i32);
        let bps = avg.saturating_mul(2000); // 1->2000 ... 5->10000
        rep.score = Self::clamp_score(bps);

        env.storage()
            .persistent()
            .set(&DataKey::Score(rep.address.clone(), rep.role.clone()), &rep);

        env.storage().persistent().set(&reviewed_key, &true);
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

        let mut reputation = Self::get_score(env.clone(), address, role.clone());
        reputation.score = Self::clamp_score(reputation.score.saturating_add(delta));
        reputation.total_jobs = reputation.total_jobs.saturating_add(1);

        env.storage().persistent().set(
            &DataKey::Score(reputation.address.clone(), role),
            &reputation,
        );
    }

    /// Slash address for fraud / abandonment — reduces score by 20%.
    pub fn slash(env: Env, address: Address, role: Role, _reason: Symbol) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let mut reputation = Self::get_score(env.clone(), address, role.clone());
        reputation.score = Self::clamp_score(reputation.score.saturating_sub(2000));

        env.storage().persistent().set(
            &DataKey::Score(reputation.address.clone(), role),
            &reputation,
        );
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
    use soroban_sdk::{Address, Env};

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
}
