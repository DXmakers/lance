#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, log, panic_with_error, symbol_short,
    Address, Bytes, Env, Vec,
};

const MAX_HASH_LEN: u32 = 96;

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum JobRegistryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidJobId = 3,
    InvalidBudget = 4,
    InvalidHash = 5,
    JobAlreadyExists = 6,
    JobNotFound = 7,
    JobNotOpen = 8,
    Unauthorized = 9,
    BidAlreadySubmitted = 10,
    BidNotFound = 11,
    InvalidStateTransition = 12,
    NoDeliverable = 13,
    Overflow = 14,
    BidWindowClosed = 15,
    InvalidExpiration = 16,
    JobExpired = 17,
    JobNotExpired = 18,
    CollateralNotFound = 19,
    CollateralAlreadyReleased = 20,
}

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
    pub bidding_deadline: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct BidRecord {
    pub freelancer: Address,
    pub proposal_hash: Bytes,
    pub collateral_stroops: i128,
    pub collateral_released: bool,
}

#[contracttype]
pub enum DataKey {
    Admin,
    NextJobId,
    Job(u64),
    Bids(u64),
    Deliverable(u64),
}

#[contract]
pub struct JobRegistryContract;

#[contractimpl]
impl JobRegistryContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, JobRegistryError::AlreadyInitialized);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NextJobId, &1u64);

        log!(&env, "initialized");
    }

    pub fn is_initialized(env: Env) -> bool {
        env.storage().instance().has(&DataKey::Admin)
    }

    pub fn get_admin(env: Env) -> Address {
        read_admin(&env)
    }

    pub fn get_next_job_id(env: Env) -> u64 {
        read_next_job_id(&env)
    }

    pub fn post_job(
        env: Env,
        job_id: u64,
        client: Address,
        hash: Bytes,
        budget: i128,
        bidding_deadline: u64,
        expires_at: u64,
    ) {
        ensure_initialized(&env);

        validate_job_input(
            &env,
            job_id,
            &hash,
            budget,
            bidding_deadline,
            expires_at,
        );

        client.require_auth();

        post_job_with_id(
            &env,
            job_id,
            client.clone(),
            hash,
            budget,
            bidding_deadline,
            expires_at,
        );

        let next_job_id = read_next_job_id(&env);

        if job_id >= next_job_id {
            let updated = job_id
                .checked_add(1)
                .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::Overflow));

            env.storage()
                .instance()
                .set(&DataKey::NextJobId, &updated);
        }

        env.events()
            .publish((symbol_short!("jobpost"), job_id), client);
    }

    pub fn post_job_auto(
        env: Env,
        client: Address,
        hash: Bytes,
        budget: i128,
        bidding_deadline: u64,
        expires_at: u64,
    ) -> u64 {
        ensure_initialized(&env);

        let job_id = read_next_job_id(&env);

        validate_job_input(
            &env,
            job_id,
            &hash,
            budget,
            bidding_deadline,
            expires_at,
        );

        client.require_auth();

        post_job_with_id(
            &env,
            job_id,
            client.clone(),
            hash,
            budget,
            bidding_deadline,
            expires_at,
        );

        let next = job_id
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::Overflow));

        env.storage().instance().set(&DataKey::NextJobId, &next);

        job_id
    }

    pub fn submit_bid(
        env: Env,
        job_id: u64,
        freelancer: Address,
        proposal_hash: Bytes,
        collateral_stroops: i128,
    ) {
        ensure_initialized(&env);

        validate_hash(&env, &proposal_hash);

        freelancer.require_auth();

        let key = DataKey::Job(job_id);

        let job: JobRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::JobNotFound));

        if job.status != JobStatus::Open {
            panic_with_error!(&env, JobRegistryError::JobNotOpen);
        }

        if env.ledger().timestamp() > job.bidding_deadline {
            panic_with_error!(&env, JobRegistryError::BidWindowClosed);
        }

        if env.ledger().timestamp() >= job.expires_at {
            panic_with_error!(&env, JobRegistryError::JobExpired);
        }

        if collateral_stroops < 0 {
            panic_with_error!(&env, JobRegistryError::InvalidBudget);
        }

        let bids_key = DataKey::Bids(job_id);

        let mut bids: Vec<BidRecord> = env
            .storage()
            .persistent()
            .get(&bids_key)
            .unwrap_or(Vec::new(&env));

        for bid in bids.iter() {
            if bid.freelancer == freelancer {
                panic_with_error!(&env, JobRegistryError::BidAlreadySubmitted);
            }
        }

        bids.push_back(BidRecord {
            freelancer: freelancer.clone(),
            proposal_hash,
            collateral_stroops,
            collateral_released: false,
        });

        env.storage().persistent().set(&bids_key, &bids);

        env.events()
            .publish((symbol_short!("bid"), job_id), freelancer);
    }

    pub fn accept_bid(
        env: Env,
        job_id: u64,
        client: Address,
        freelancer: Address,
    ) {
        ensure_initialized(&env);

        client.require_auth();

        let key = DataKey::Job(job_id);

        let mut job: JobRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::JobNotFound));

        if job.status != JobStatus::Open {
            panic_with_error!(&env, JobRegistryError::JobNotOpen);
        }

        if client != job.client {
            panic_with_error!(&env, JobRegistryError::Unauthorized);
        }

        if env.ledger().timestamp() >= job.expires_at {
            panic_with_error!(&env, JobRegistryError::JobExpired);
        }

        let bids: Vec<BidRecord> = env
            .storage()
            .persistent()
            .get(&DataKey::Bids(job_id))
            .unwrap_or(Vec::new(&env));

        let mut found = false;

        for bid in bids.iter() {
            if bid.freelancer == freelancer {
                found = true;
                break;
            }
        }

        if !found {
            panic_with_error!(&env, JobRegistryError::BidNotFound);
        }

        job.freelancer = Some(freelancer.clone());
        job.status = JobStatus::Assigned;

        env.storage().persistent().set(&key, &job);

        env.events()
            .publish((symbol_short!("accept"), job_id), freelancer);
    }

    pub fn refund_bid_collateral(
        env: Env,
        job_id: u64,
        freelancer: Address,
    ) {
        ensure_initialized(&env);

        freelancer.require_auth();

        release_collateral(&env, job_id, freelancer, false);
    }

    pub fn slash_bid_collateral(
        env: Env,
        job_id: u64,
        client: Address,
        freelancer: Address,
    ) {
        ensure_initialized(&env);

        client.require_auth();

        let job: JobRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::JobNotFound));

        if client != job.client {
            panic_with_error!(&env, JobRegistryError::Unauthorized);
        }

        release_collateral(&env, job_id, freelancer, true);
    }

    pub fn cancel_expired_job(
        env: Env,
        job_id: u64,
        client: Address,
    ) {
        ensure_initialized(&env);

        client.require_auth();

        let key = DataKey::Job(job_id);

        let mut job: JobRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::JobNotFound));

        if job.status != JobStatus::Open {
            panic_with_error!(&env, JobRegistryError::InvalidStateTransition);
        }

        if client != job.client {
            panic_with_error!(&env, JobRegistryError::Unauthorized);
        }

        if env.ledger().timestamp() < job.expires_at {
            panic_with_error!(&env, JobRegistryError::JobNotExpired);
        }

        job.status = JobStatus::Expired;

        env.storage().persistent().set(&key, &job);

        env.events()
            .publish((symbol_short!("expired"), job_id), client);
    }

    pub fn submit_deliverable(
        env: Env,
        job_id: u64,
        freelancer: Address,
        hash: Bytes,
    ) {
        ensure_initialized(&env);

        validate_hash(&env, &hash);

        freelancer.require_auth();

        let key = DataKey::Job(job_id);

        let mut job: JobRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::JobNotFound));

        if job.status != JobStatus::Assigned {
            panic_with_error!(&env, JobRegistryError::InvalidStateTransition);
        }

        if job.freelancer != Some(freelancer.clone()) {
            panic_with_error!(&env, JobRegistryError::Unauthorized);
        }

        job.status = JobStatus::DeliverableSubmitted;

        env.storage().persistent().set(&key, &job);

        env.storage()
            .persistent()
            .set(&DataKey::Deliverable(job_id), &hash);

        env.events()
            .publish((symbol_short!("deliver"), job_id), freelancer);
    }

    pub fn mark_disputed(env: Env, job_id: u64) {
        ensure_initialized(&env);

        let admin = read_admin(&env);

        admin.require_auth();

        let key = DataKey::Job(job_id);

        let mut job: JobRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::JobNotFound));

        if job.status != JobStatus::Assigned
            && job.status != JobStatus::DeliverableSubmitted
        {
            panic_with_error!(&env, JobRegistryError::InvalidStateTransition);
        }

        job.status = JobStatus::Disputed;

        env.storage().persistent().set(&key, &job);
    }

    pub fn get_job(env: Env, job_id: u64) -> JobRecord {
        ensure_initialized(&env);

        env.storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::JobNotFound))
    }

    pub fn get_bids(env: Env, job_id: u64) -> Vec<BidRecord> {
        ensure_initialized(&env);

        env.storage()
            .persistent()
            .get(&DataKey::Bids(job_id))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_deliverable(env: Env, job_id: u64) -> Bytes {
        ensure_initialized(&env);

        env.storage()
            .persistent()
            .get(&DataKey::Deliverable(job_id))
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::NoDeliverable))
    }
}

fn ensure_initialized(env: &Env) {
    if !env.storage().instance().has(&DataKey::Admin) {
        panic_with_error!(env, JobRegistryError::NotInitialized);
    }
}

fn read_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, JobRegistryError::NotInitialized))
}

fn read_next_job_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextJobId)
        .unwrap_or_else(|| panic_with_error!(env, JobRegistryError::NotInitialized))
}

fn validate_job_input(
    env: &Env,
    job_id: u64,
    hash: &Bytes,
    budget: i128,
    bidding_deadline: u64,
    expires_at: u64,
) {
    if job_id == 0 {
        panic_with_error!(env, JobRegistryError::InvalidJobId);
    }

    if budget <= 0 {
        panic_with_error!(env, JobRegistryError::InvalidBudget);
    }

    if bidding_deadline <= env.ledger().timestamp() {
        panic_with_error!(env, JobRegistryError::BidWindowClosed);
    }

    if bidding_deadline >= expires_at {
        panic_with_error!(env, JobRegistryError::InvalidExpiration);
    }

    validate_hash(env, hash);
    validate_expiration(env, expires_at);
}

fn validate_expiration(env: &Env, expires_at: u64) {
    let now = env.ledger().timestamp();

    if expires_at == 0 || expires_at <= now {
        panic_with_error!(env, JobRegistryError::InvalidExpiration);
    }
}

fn validate_hash(env: &Env, hash: &Bytes) {
    let len = hash.len();

    if len == 0 || len > MAX_HASH_LEN {
        panic_with_error!(env, JobRegistryError::InvalidHash);
    }
}

fn post_job_with_id(
    env: &Env,
    job_id: u64,
    client: Address,
    hash: Bytes,
    budget: i128,
    bidding_deadline: u64,
    expires_at: u64,
) {
    let key = DataKey::Job(job_id);

    if env.storage().persistent().has(&key) {
        panic_with_error!(env, JobRegistryError::JobAlreadyExists);
    }

    let job = JobRecord {
        client,
        freelancer: None,
        metadata_hash: hash,
        budget_stroops: budget,
        expires_at,
        status: JobStatus::Open,
        bidding_deadline,
    };

    env.storage().persistent().set(&key, &job);

    let bids: Vec<BidRecord> = Vec::new(env);

    env.storage()
        .persistent()
        .set(&DataKey::Bids(job_id), &bids);
}

fn release_collateral(
    env: &Env,
    job_id: u64,
    freelancer: Address,
    slashed: bool,
) {
    let bids_key = DataKey::Bids(job_id);

    let mut bids: Vec<BidRecord> = env
        .storage()
        .persistent()
        .get(&bids_key)
        .unwrap_or(Vec::new(env));

    let mut updated = false;

    for i in 0..bids.len() {
        let mut bid = bids.get(i).unwrap();

        if bid.freelancer == freelancer {
            if bid.collateral_released {
                panic_with_error!(
                    env,
                    JobRegistryError::CollateralAlreadyReleased
                );
            }

            bid.collateral_released = true;

            bids.set(i, bid);

            updated = true;

            break;
        }
    }

    if !updated {
        panic_with_error!(env, JobRegistryError::CollateralNotFound);
    }

    env.storage().persistent().set(&bids_key, &bids);

    env.events()
        .publish((symbol_short!("collat"), job_id), (freelancer, slashed));
}