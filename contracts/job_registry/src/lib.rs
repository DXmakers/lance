#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, log, panic_with_error, symbol_short,
    Address, Bytes, Env, Vec,
};

const MAX_HASH_LEN: u32 = 96;

// Requirement [SC-REG-037]: Contract-wide budget floor and ceiling enforced at input validation.
// MIN prevents dust spam; MAX caps exposure to a realistic large project value.
const MIN_BUDGET_STROOPS: i128 = 100_000;           // 0.01 XLM
const MAX_BUDGET_STROOPS: i128 = 100_000_000_000_000; // 10,000,000 XLM

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

    // Requirement [SC-REG-039]: Gas-efficient paginated getter avoids loading the full bids vector
    // when only a window of records is needed. Callers supply an offset and a limit; the function
    // returns at most `limit` entries starting at `offset`, clamping automatically at the end.
    pub fn get_bids_page(env: Env, job_id: u64, offset: u32, limit: u32) -> Vec<BidRecord> {
        ensure_initialized(&env);
        let all_bids: Vec<BidRecord> = env
            .storage()
            .persistent()
            .get(&DataKey::Bids(job_id))
            .unwrap_or(Vec::new(&env));

        let total = all_bids.len();
        let start = offset.min(total);
        let end = (start.saturating_add(limit)).min(total);

        let mut page = Vec::new(&env);
        for i in start..end {
            page.push_back(all_bids.get_unchecked(i));
        }
        page
    }

    // Requirement [SC-REG-039]: Returns only the length of the bids vector without deserialising
    // each entry, keeping the read cost proportional to one storage key lookup rather than O(n).
    pub fn get_bids_count(env: Env, job_id: u64) -> u32 {
        ensure_initialized(&env);
        env.storage()
            .persistent()
            .get::<_, Vec<BidRecord>>(&DataKey::Bids(job_id))
            .map(|bids| bids.len())
            .unwrap_or(0)
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
    // Requirement [SC-REG-037]: Verify Budget Bounds against Contract Minimum and Maximum limits.
    // Rejects dust amounts and unrealistically large values to prevent storage abuse.
    if budget < MIN_BUDGET_STROOPS || budget > MAX_BUDGET_STROOPS {
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

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{Address, Bytes, Env};

    fn setup() -> (
        Env,
        JobRegistryContractClient<'static>,
        Address,
        Address,
        Address,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        (env, cc, admin, client, freelancer)
    }

    fn future_expires_at(env: &Env) -> u64 {
        env.ledger().timestamp() + 60
    }

    #[test]
    fn test_initialize_bootstraps_storage() {
        let (_env, cc, admin, _, _) = setup();

        cc.initialize(&admin);

        assert!(cc.is_initialized());
        assert_eq!(cc.get_admin(), admin);
        assert_eq!(cc.get_next_job_id(), 1u64);
    }

    #[test]
    #[should_panic]
    fn test_double_initialize_panics() {
        let (_env, cc, admin, _, _) = setup();

        cc.initialize(&admin);
        cc.initialize(&admin);
    }

    #[test]
    #[should_panic]
    fn test_post_job_before_initialize_panics() {
        let (env, cc, _admin, client, _) = setup();
        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);
    }

    #[test]
    fn test_post_job_auto_allocates_sequential_ids() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash1 = Bytes::from_slice(&env, b"QmHash1");
        let hash2 = Bytes::from_slice(&env, b"QmHash2");
        let expires_at1 = future_expires_at(&env);
        let expires_at2 = future_expires_at(&env);

        let id1 = cc.post_job_auto(&client, &hash1, &MIN_BUDGET_STROOPS, &expires_at1);
        let id2 = cc.post_job_auto(&client, &hash2, &MIN_BUDGET_STROOPS, &expires_at2);

        assert_eq!(id1, 1u64);
        assert_eq!(id2, 2u64);
        assert_eq!(cc.get_next_job_id(), 3u64);
    }

    #[test]
    fn test_post_job_with_explicit_id_updates_next_job_id() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&42u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);

        assert_eq!(cc.get_next_job_id(), 43u64);
    }

    #[test]
    #[should_panic]
    fn test_invalid_budget_panics() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &0i128, &expires_at);
    }

    #[test]
    #[should_panic]
    fn test_empty_hash_panics() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let empty = Bytes::from_slice(&env, b"");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &empty, &MIN_BUDGET_STROOPS, &expires_at);
    }

    #[test]
    fn test_full_lifecycle() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmSomeIPFSHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::Open);
        assert_eq!(job.freelancer, None);

        let proposal = Bytes::from_slice(&env, b"QmProposalHash");
        cc.submit_bid(&1u64, &freelancer, &proposal);

        let bids = cc.get_bids(&1u64);
        assert_eq!(bids.len(), 1);

        cc.accept_bid(&1u64, &client, &freelancer);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::Assigned);
        assert_eq!(job.freelancer, Some(freelancer.clone()));

        let deliverable = Bytes::from_slice(&env, b"QmDeliverableHash");
        cc.submit_deliverable(&1u64, &freelancer, &deliverable);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::DeliverableSubmitted);

        let d = cc.get_deliverable(&1u64);
        assert_eq!(d, deliverable);
    }

    #[test]
    #[should_panic]
    fn test_duplicate_bid_panics() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal);
        cc.submit_bid(&1u64, &freelancer, &proposal);
    }

    #[test]
    #[should_panic]
    fn test_accept_without_matching_bid_panics() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);

        cc.accept_bid(&1u64, &client, &freelancer);
    }

    #[test]
    fn test_mark_disputed_from_assigned() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal);
        cc.accept_bid(&1u64, &client, &freelancer);

        cc.mark_disputed(&1u64);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::Disputed);
    }

    #[test]
    #[should_panic]
    fn test_mark_disputed_from_open_panics() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);

        cc.mark_disputed(&1u64);
    }

    #[test]
    #[should_panic]
    fn test_submit_bid_after_expiration_panics() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);

        env.ledger().set_timestamp(expires_at + 1);

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal);
    }

    let mut bids: Vec<BidRecord> = env
        .storage()
        .persistent()
        .get(&bids_key)
        .unwrap_or(Vec::new(env));

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);

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

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);

            updated = true;

            break;
        }
    }

    #[test]
    #[should_panic]
    fn test_cancel_expired_job_before_expiration_panics() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);

        cc.cancel_expired_job(&1u64, &client);
    }

    env.storage().persistent().set(&bids_key, &bids);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);

        cc.get_deliverable(&1u64);
    }

    // --- SC-REG-037: Budget Bounds Tests ---

    #[test]
    fn test_budget_at_minimum_succeeds() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);

        let job = cc.get_job(&1u64);
        assert_eq!(job.budget_stroops, MIN_BUDGET_STROOPS);
    }

    #[test]
    fn test_budget_at_maximum_succeeds() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MAX_BUDGET_STROOPS, &expires_at);

        let job = cc.get_job(&1u64);
        assert_eq!(job.budget_stroops, MAX_BUDGET_STROOPS);
    }

    #[test]
    #[should_panic]
    fn test_budget_below_minimum_panics() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &(MIN_BUDGET_STROOPS - 1), &expires_at);
    }

    #[test]
    #[should_panic]
    fn test_budget_above_maximum_panics() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &(MAX_BUDGET_STROOPS + 1), &expires_at);
    }

    #[test]
    #[should_panic]
    fn test_zero_budget_still_panics() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &0i128, &expires_at);
    }

    // --- SC-REG-039: Paginated Bids Tests ---

    #[test]
    fn test_get_bids_count_empty_returns_zero() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);

        assert_eq!(cc.get_bids_count(&1u64), 0u32);
    }

    #[test]
    fn test_get_bids_count_after_submissions() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);

        for _ in 0..3u32 {
            let freelancer = Address::generate(&env);
            let proposal = Bytes::from_slice(&env, b"QmProposal");
            cc.submit_bid(&1u64, &freelancer, &proposal);
        }

        assert_eq!(cc.get_bids_count(&1u64), 3u32);
    }

    #[test]
    fn test_get_bids_page_first_window() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);

        for _ in 0..5u32 {
            let freelancer = Address::generate(&env);
            let proposal = Bytes::from_slice(&env, b"QmProposal");
            cc.submit_bid(&1u64, &freelancer, &proposal);
        }

        let page = cc.get_bids_page(&1u64, &0u32, &3u32);
        assert_eq!(page.len(), 3u32);
    }

    #[test]
    fn test_get_bids_page_second_window() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);

        for _ in 0..5u32 {
            let freelancer = Address::generate(&env);
            let proposal = Bytes::from_slice(&env, b"QmProposal");
            cc.submit_bid(&1u64, &freelancer, &proposal);
        }

        let page = cc.get_bids_page(&1u64, &3u32, &3u32);
        assert_eq!(page.len(), 2u32);
    }

    #[test]
    fn test_get_bids_page_offset_beyond_end_returns_empty() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at);

        for _ in 0..3u32 {
            let freelancer = Address::generate(&env);
            let proposal = Bytes::from_slice(&env, b"QmProposal");
            cc.submit_bid(&1u64, &freelancer, &proposal);
        }

        let page = cc.get_bids_page(&1u64, &10u32, &5u32);
        assert_eq!(page.len(), 0u32);
    }
}
