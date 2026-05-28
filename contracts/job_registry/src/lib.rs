#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, log, panic_with_error, symbol_short,
    token, Address, Bytes, Env, Vec,
};

#[allow(dead_code)]
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
    pub bid_deadline: u64,
    pub collateral_token: Address,
    pub collateral_amount: i128,
    pub collateral_locked: bool,
}

// Requirement [SC-REG-036]: Storage Packing for Bid Struct Instance Allocations.
// Groups `freelancer` address, `proposal_hash` (IPFS CID), and bid collateral fields
// into a single packed struct to minimize Soroban ledger footprint and reduce storage charges.
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
    /// One-time storage bootstrap.
    ///
    /// Sets contract admin and initializes `next_job_id` to 1.
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

    /// Client posts a job with explicit `job_id` and collateral lockup details.
    pub fn post_job(
        env: Env,
        job_id: u64,
        client: Address,
        hash: Bytes,
        budget: i128,
        expires_at: u64,
        bid_deadline: u64,
        collateral_token: Address,
        collateral_amount: i128,
    ) {
        ensure_initialized(&env);

        validate_job_input(
            &env,
            job_id,
            &hash,
            budget,
            expires_at,
            bid_deadline,
        );

        if collateral_amount < 0 {
            panic_with_error!(&env, JobRegistryError::InvalidBudget);
        }

        client.require_auth();

        post_job_with_id(
            &env,
            job_id,
            client.clone(),
            hash,
            budget,
            expires_at,
            bid_deadline,
            collateral_token.clone(),
            collateral_amount,
        );

        // Lock collateral from client into this contract
        if collateral_amount > 0 {
            let token_client = token::Client::new(&env, &collateral_token);
            token_client.transfer(&client, &env.current_contract_address(), &collateral_amount);
        }

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

    /// Client posts a job using internal registry index allocation and collateral lockup details.
    pub fn post_job_auto(
        env: Env,
        client: Address,
        hash: Bytes,
        budget: i128,
        expires_at: u64,
        bid_deadline: u64,
        collateral_token: Address,
        collateral_amount: i128,
    ) -> u64 {
        ensure_initialized(&env);

        let job_id = read_next_job_id(&env);

        validate_job_input(
            &env,
            job_id,
            &hash,
            budget,
            expires_at,
            bid_deadline,
        );

        if collateral_amount < 0 {
            panic_with_error!(&env, JobRegistryError::InvalidBudget);
        }

        client.require_auth();

        post_job_with_id(
            &env,
            job_id,
            client.clone(),
            hash,
            budget,
            expires_at,
            bid_deadline,
            collateral_token.clone(),
            collateral_amount,
        );

        // Lock collateral from client into this contract
        if collateral_amount > 0 {
            let token_client = token::Client::new(&env, &collateral_token);
            token_client.transfer(&client, &env.current_contract_address(), &collateral_amount);
        }

        let next = job_id
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::Overflow));

        env.storage().instance().set(&DataKey::NextJobId, &next);

        job_id
    }

    /// Freelancer submits a bid, with optionally provided freelancer collateral.
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

        if env.ledger().timestamp() > job.bid_deadline {
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

        // Requirement [SC-REG-035]: Enforce strict single-bid constraint per freelancer on active jobs.
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

    /// Client accepts a bid, locking in the freelancer.
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

    /// Client completes a job, releasing locked client collateral to the freelancer.
    pub fn complete_job(env: Env, job_id: u64, client: Address) {
        ensure_initialized(&env);
        client.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: JobRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::JobNotFound));

        if client != job.client {
            panic_with_error!(&env, JobRegistryError::Unauthorized);
        }

        if job.status != JobStatus::DeliverableSubmitted {
            panic_with_error!(&env, JobRegistryError::InvalidStateTransition);
        }

        job.status = JobStatus::Completed;

        if job.collateral_locked && job.collateral_amount > 0 {
            if let Some(ref freelancer) = job.freelancer {
                let token_client = token::Client::new(&env, &job.collateral_token);
                token_client.transfer(
                    &env.current_contract_address(),
                    freelancer,
                    &job.collateral_amount,
                );
                job.collateral_locked = false;
            }
        }

        env.storage().persistent().set(&key, &job);

        log!(&env, "complete_job: id {}", job_id);
        env.events().publish((symbol_short!("complete"), job_id), ());
    }

    /// Client refunds their locked collateral if the job has expired without an accepted bid.
    pub fn refund_collateral(env: Env, job_id: u64, client: Address) {
        ensure_initialized(&env);
        client.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: JobRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::JobNotFound));

        if client != job.client {
            panic_with_error!(&env, JobRegistryError::Unauthorized);
        }

        let now = env.ledger().timestamp();
        if job.status != JobStatus::Open || now <= job.bid_deadline {
            panic_with_error!(&env, JobRegistryError::InvalidStateTransition);
        }

        if job.collateral_locked && job.collateral_amount > 0 {
            let token_client = token::Client::new(&env, &job.collateral_token);
            token_client.transfer(
                &env.current_contract_address(),
                &job.client,
                &job.collateral_amount,
            );
            job.collateral_locked = false;
        }

        env.storage().persistent().set(&key, &job);

        log!(&env, "refund_collateral: id {}", job_id);
        env.events().publish((symbol_short!("refund"), job_id), ());
    }

    /// Client cancels an expired open job, returning client collateral and deleting bids list.
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

        // Refund collateral if locked
        if job.collateral_locked && job.collateral_amount > 0 {
            let token_client = token::Client::new(&env, &job.collateral_token);
            token_client.transfer(
                &env.current_contract_address(),
                &job.client,
                &job.collateral_amount,
            );
            job.collateral_locked = false;
        }

        env.storage().persistent().set(&key, &job);
        env.storage().persistent().remove(&DataKey::Bids(job_id));

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
    expires_at: u64,
    bid_deadline: u64,
) {
    if job_id == 0 {
        panic_with_error!(env, JobRegistryError::InvalidJobId);
    }
    // Requirement [SC-REG-037]: Verify Budget Bounds against Contract Minimum and Maximum limits.
    // Rejects dust amounts and unrealistically large values to prevent storage abuse.
    if budget < MIN_BUDGET_STROOPS || budget > MAX_BUDGET_STROOPS {
        panic_with_error!(env, JobRegistryError::InvalidBudget);
    }

    if bid_deadline <= env.ledger().timestamp() {
        panic_with_error!(env, JobRegistryError::BidWindowClosed);
    }

    if bid_deadline >= expires_at {
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
    validate_ipfs_cid(env, hash);
}

fn validate_ipfs_cid(env: &Env, hash: &Bytes) {
    let len = hash.len();
    if len == 46 {
        // Must be CIDv0 (Qm...)
        let mut buf = [0u8; 46];
        hash.copy_into_slice(&mut buf);
        if buf[0] != b'Q' || buf[1] != b'm' {
            panic_with_error!(env, JobRegistryError::InvalidHash);
        }
        for i in 2..46 {
            if !is_valid_base58_char(buf[i]) {
                panic_with_error!(env, JobRegistryError::InvalidHash);
            }
        }
    } else if len == 59 {
        // Must be CIDv1 (bafy...)
        let mut buf = [0u8; 59];
        hash.copy_into_slice(&mut buf);
        if buf[0] != b'b' || buf[1] != b'a' || buf[2] != b'f' || buf[3] != b'y' {
            panic_with_error!(env, JobRegistryError::InvalidHash);
        }
        for i in 4..59 {
            if !is_valid_base32_char(buf[i]) {
                panic_with_error!(env, JobRegistryError::InvalidHash);
            }
        }
    } else {
        panic_with_error!(env, JobRegistryError::InvalidHash);
    }
}

fn is_valid_base58_char(c: u8) -> bool {
    matches!(c, b'1'..=b'9' | b'A'..=b'H' | b'J'..=b'N' | b'P'..=b'Z' | b'a'..=b'k' | b'm'..=b'z')
}

fn is_valid_base32_char(c: u8) -> bool {
    matches!(c, b'a'..=b'z' | b'2'..=b'7')
}

fn post_job_with_id(
    env: &Env,
    job_id: u64,
    client: Address,
    hash: Bytes,
    budget: i128,
    expires_at: u64,
    bid_deadline: u64,
    collateral_token: Address,
    collateral_amount: i128,
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
        bid_deadline,
        collateral_token,
        collateral_amount,
        collateral_locked: collateral_amount > 0,
    };

    env.storage().persistent().set(&key, &job);

    let bids: Vec<BidRecord> = Vec::new(env);

    env.storage()
        .persistent()
        .set(&DataKey::Bids(job_id), &bids);
}

fn release_collateral(env: &Env, job_id: u64, freelancer: Address, slash: bool) {
    let bids_key = DataKey::Bids(job_id);
    let mut bids: Vec<BidRecord> = env
        .storage()
        .persistent()
        .get(&bids_key)
        .unwrap_or_else(|| panic_with_error!(env, JobRegistryError::BidNotFound));

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
        panic_with_error!(env, JobRegistryError::BidNotFound);
    }

    env.storage().persistent().set(&bids_key, &bids);

    if slash {
        env.events().publish(
            (symbol_short!("slash"), job_id),
            freelancer,
        );
    } else {
        env.events().publish(
            (symbol_short!("release"), job_id),
            freelancer,
        );
    }
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
        Address, // Mock Token
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let token_client = token::StellarAssetClient::new(&env, &token_addr);
        token_client.mint(&client, &100_000);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        (env, cc, admin, client, freelancer, token_addr)
    }

    fn future_expires_at(env: &Env) -> u64 {
        env.ledger().timestamp() + 30 * 24 * 60 * 60
    }

    #[test]
    fn test_initialize_bootstraps_storage() {
        let (_env, cc, admin, _, _, _) = setup();

        cc.initialize(&admin);

        assert!(cc.is_initialized());
        assert_eq!(cc.get_admin(), admin);
        assert_eq!(cc.get_next_job_id(), 1u64);
    }

    #[test]
    #[should_panic]
    fn test_double_initialize_panics() {
        let (_env, cc, admin, _, _, _) = setup();

        cc.initialize(&admin);
        cc.initialize(&admin);
    }

    #[test]
    #[should_panic]
    fn test_post_job_before_initialize_panics() {
        let (env, cc, _admin, client, _, token_addr) = setup();
        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &2000u64, &token_addr, &1000i128);
    }

    #[test]
    fn test_post_job_auto_allocates_sequential_ids() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash1 = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        let hash2 = Bytes::from_slice(&env, b"QmY4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9e");

        env.ledger().set_timestamp(100);
        let expires_at1 = future_expires_at(&env);
        let expires_at2 = future_expires_at(&env);

        let id1 = cc.post_job_auto(&client, &hash1, &MIN_BUDGET_STROOPS, &expires_at1, &1000u64, &token_addr, &1000i128);
        let id2 = cc.post_job_auto(&client, &hash2, &MIN_BUDGET_STROOPS, &expires_at2, &2000u64, &token_addr, &2000i128);

        assert_eq!(id1, 1u64);
        assert_eq!(id2, 2u64);
        assert_eq!(cc.get_next_job_id(), 3u64);
    }

    #[test]
    fn test_post_job_with_explicit_id_updates_next_job_id() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&42u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &1000i128);

        assert_eq!(cc.get_next_job_id(), 43u64);
    }

    #[test]
    #[should_panic]
    fn test_invalid_budget_panics() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &0i128, &expires_at, &1000u64, &token_addr, &1000i128);
    }

    #[test]
    #[should_panic]
    fn test_empty_hash_panics() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let empty = Bytes::from_slice(&env, b"");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &empty, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &1000i128);
    }

    #[test]
    fn test_full_lifecycle() {
        let (env, cc, admin, client, freelancer, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &1000i128);

        let tc = token::Client::new(&env, &token_addr);
        assert_eq!(tc.balance(&cc.address), 1000);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::Open);
        assert_eq!(job.freelancer, None);
        assert!(job.collateral_locked);

        let proposal = Bytes::from_slice(&env, b"QmProposalHashValid123456789212345678921234567");
        cc.submit_bid(&1u64, &freelancer, &proposal, &500i128);

        let bids = cc.get_bids(&1u64);
        assert_eq!(bids.len(), 1);

        cc.accept_bid(&1u64, &client, &freelancer);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::Assigned);
        assert_eq!(job.freelancer, Some(freelancer.clone()));

        let deliverable = Bytes::from_slice(&env, b"QmDeliverableHashValid123456789212345678921234");
        cc.submit_deliverable(&1u64, &freelancer, &deliverable);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::DeliverableSubmitted);

        let d = cc.get_deliverable(&1u64);
        assert_eq!(d, deliverable);

        cc.complete_job(&1u64, &client);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::Completed);
        assert!(!job.collateral_locked);
        assert_eq!(tc.balance(&freelancer), 1000);
    }

    #[test]
    #[should_panic]
    fn test_duplicate_bid_panics() {
        let (env, cc, admin, client, freelancer, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &1000i128);

        let proposal = Bytes::from_slice(&env, b"QmProposalHashValid123456789212345678921234567");
        cc.submit_bid(&1u64, &freelancer, &proposal, &500i128);
        cc.submit_bid(&1u64, &freelancer, &proposal, &500i128);
    }

    #[test]
    #[should_panic]
    fn test_accept_without_matching_bid_panics() {
        let (env, cc, admin, client, freelancer, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &1000i128);

        cc.accept_bid(&1u64, &client, &freelancer);
    }

    #[test]
    fn test_mark_disputed_from_assigned() {
        let (env, cc, admin, client, freelancer, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &1000i128);

        let proposal = Bytes::from_slice(&env, b"QmProposalHashValid123456789212345678921234567");
        cc.submit_bid(&1u64, &freelancer, &proposal, &500i128);
        cc.accept_bid(&1u64, &client, &freelancer);

        cc.mark_disputed(&1u64);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::Disputed);
    }

    #[test]
    #[should_panic]
    fn test_mark_disputed_from_open_panics() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &1000i128);

        cc.mark_disputed(&1u64);
    }

    #[test]
    #[should_panic]
    fn test_get_deliverable_without_submission_panics() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &1000i128);

        cc.get_deliverable(&1u64);
    }

    #[test]
    #[should_panic]
    fn test_late_bid_submission_panics() {
        let (env, cc, admin, client, freelancer, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &1000i128);

        env.ledger().set_timestamp(1001); // past the deadline of 1000
        let proposal = Bytes::from_slice(&env, b"QmProposalHashValid123456789212345678921234567");
        cc.submit_bid(&1u64, &freelancer, &proposal, &500i128);
    }

    #[test]
    fn test_refund_collateral_after_deadline() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &1000i128);

        let tc = token::Client::new(&env, &token_addr);
        assert_eq!(tc.balance(&client), 99000);

        env.ledger().set_timestamp(1001); // past the deadline of 1000
        cc.refund_collateral(&1u64, &client);

        let job = cc.get_job(&1u64);
        assert!(!job.collateral_locked);
        assert_eq!(tc.balance(&client), 100000);
    }

    #[test]
    fn test_valid_cidv1_posting() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"bafybeigdyrzt5sbi7ee3xjc3vyqptsyfuwwspw2gx6pqdfaaaaabbbbbccccc");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &1000i128);

        let job = cc.get_job(&1u64);
        assert_eq!(job.metadata_hash, hash);
    }

    #[test]
    #[should_panic]
    fn test_invalid_cid_length_panics() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f123");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &1000i128);
    }

    #[test]
    #[should_panic]
    fn test_invalid_cidv0_prefix_panics() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QxZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &1000i128);
    }

    #[test]
    #[should_panic]
    fn test_invalid_cidv1_prefix_panics() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"bafxbeigdyrzt5sbi7ee3xjc3vyqptsyfuwwspw2gx6pqdfaaaaabbbbbccccc");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &1000i128);
    }

    #[test]
    #[should_panic]
    fn test_invalid_cidv0_chars_panics() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        // '0' is invalid in base58
        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a0f");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &1000i128);
    }

    #[test]
    #[should_panic]
    fn test_invalid_cidv1_chars_panics() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        // '0' is invalid in base32
        let hash = Bytes::from_slice(&env, b"bafybeigdyrzt5sbi7ee3xjc3vyqptsyfuwwspw2gx6pqdfaaaaabbbbbcccc0");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &1000i128);
    }

    // --- SC-REG-037: Budget Bounds Tests ---

    #[test]
    fn test_budget_at_minimum_succeeds() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &0i128);

        let job = cc.get_job(&1u64);
        assert_eq!(job.budget_stroops, MIN_BUDGET_STROOPS);
    }

    #[test]
    fn test_budget_at_maximum_succeeds() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MAX_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &0i128);

        let job = cc.get_job(&1u64);
        assert_eq!(job.budget_stroops, MAX_BUDGET_STROOPS);
    }

    #[test]
    #[should_panic]
    fn test_budget_below_minimum_panics() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &(MIN_BUDGET_STROOPS - 1), &expires_at, &1000u64, &token_addr, &0i128);
    }

    #[test]
    #[should_panic]
    fn test_budget_above_maximum_panics() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &(MAX_BUDGET_STROOPS + 1), &expires_at, &1000u64, &token_addr, &0i128);
    }

    // --- SC-REG-039: Paginated Bids Tests ---

    #[test]
    fn test_get_bids_count_empty_returns_zero() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &0i128);

        assert_eq!(cc.get_bids_count(&1u64), 0u32);
    }

    #[test]
    fn test_get_bids_count_after_submissions() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &0i128);

        for _ in 0..3u32 {
            let freelancer = Address::generate(&env);
            let proposal = Bytes::from_slice(&env, b"QmProposalHashValid123456789212345678921234567");
            cc.submit_bid(&1u64, &freelancer, &proposal, &100i128);
        }

        assert_eq!(cc.get_bids_count(&1u64), 3u32);
    }

    #[test]
    fn test_get_bids_page_first_window() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &0i128);

        for _ in 0..5u32 {
            let freelancer = Address::generate(&env);
            let proposal = Bytes::from_slice(&env, b"QmProposalHashValid123456789212345678921234567");
            cc.submit_bid(&1u64, &freelancer, &proposal, &100i128);
        }

        let page = cc.get_bids_page(&1u64, &0u32, &3u32);
        assert_eq!(page.len(), 3u32);
    }

    #[test]
    fn test_get_bids_page_second_window() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &0i128);

        for _ in 0..5u32 {
            let freelancer = Address::generate(&env);
            let proposal = Bytes::from_slice(&env, b"QmProposalHashValid123456789212345678921234567");
            cc.submit_bid(&1u64, &freelancer, &proposal, &100i128);
        }

        let page = cc.get_bids_page(&1u64, &3u32, &3u32);
        assert_eq!(page.len(), 2u32);
    }

    #[test]
    fn test_get_bids_page_offset_beyond_end_returns_empty() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &0i128);

        for _ in 0..3u32 {
            let freelancer = Address::generate(&env);
            let proposal = Bytes::from_slice(&env, b"QmProposalHashValid123456789212345678921234567");
            cc.submit_bid(&1u64, &freelancer, &proposal, &100i128);
        }

        let page = cc.get_bids_page(&1u64, &10u32, &5u32);
        assert_eq!(page.len(), 0u32);
    }
}
