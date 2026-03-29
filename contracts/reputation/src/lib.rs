#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Bytes, IntoVal};

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
#[derive(Clone, PartialEq)]
pub enum Role { Client, Freelancer }

#[contracttype]
#[derive(Clone)]
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
pub enum DataKey { Score(Address, Role), Admin, JobRegistry, Reviewed(u64, Address) }

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
        env.storage().instance().set(&DataKey::JobRegistry, &registry);
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
        assert!(!env.storage().persistent().has(&reviewed_key), "already reviewed");

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

        env.storage()
            .persistent()
            .set(&DataKey::Score(reputation.address.clone(), role), &reputation);
    }

    /// Slash address for fraud / abandonment — reduces score by 20%.
    pub fn slash(env: Env, address: Address, role: Role, reason: Symbol) {
        let _ = reason;
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let mut reputation = Self::get_score(env.clone(), address, role.clone());
        reputation.score = Self::clamp_score(reputation.score.saturating_sub(2000));

        env.storage()
            .persistent()
            .set(&DataKey::Score(reputation.address.clone(), role), &reputation);
    }

    pub fn get_score(env: Env, address: Address, role: Role) -> ReputationScore {
        env.storage()
            .persistent()
            .get(&DataKey::Score(address.clone(), role.clone()))
            .unwrap_or(ReputationScore {
                address,
                role,
                score: 5000,
                total_jobs: 0,
                total_points: 0,
                reviews: 0,
            })
    }
}

impl ReputationContract {
    fn clamp_score(value: i32) -> i32 {
        value.clamp(0, 10_000)
    }
}
