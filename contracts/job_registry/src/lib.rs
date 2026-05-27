#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Bytes, Env, Map,
};

const PERSISTENT_TTL_BUMP: u32 = 535_680; // ~31 days
const INSTANCE_TTL_BUMP: u32 = 17_280;    // ~1 day

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
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
    InvalidExpiration = 15,
    JobExpired = 16,
    JobNotExpired = 17,
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
}

// Requirement [SC-REG-036]: Storage Packing for Bid Struct Instance Allocations.
// Groups `freelancer` address and `proposal_hash` (IPFS CID) into a single packed struct
// to minimize Soroban ledger footprint and reduce instance/persistent storage write charges.
#[contracttype]
#[derive(Clone)]
pub struct BidRecord {
    pub freelancer: Address,
    pub proposal_hash: Bytes,
}

#[contracttype]
pub enum DataKey {
    Job(u32),
    JobBids(u32),
    BidCounter(u32),
}

#[contract]
pub struct JobRegistryContract;

#[contractimpl]
impl JobRegistryContract {
    /// Create a new job. `deadline` is an absolute ledger timestamp (seconds).
    pub fn create_job(env: Env, job_id: u32, creator: Address, ipfs_cid: Bytes, deadline: u64) {
        creator.require_auth();

    /// Client posts a job with explicit `job_id`.
    /// `metadata_hash` is expected to contain CID bytes.
    pub fn post_job(
        env: Env,
        job_id: u64,
        client: Address,
        hash: Bytes,
        budget: i128,
        expires_at: u64,
    ) {
        ensure_initialized(&env);
        validate_job_input(&env, job_id, &hash, budget, expires_at);

        client.require_auth();
        post_job_with_id(&env, job_id, client.clone(), hash, budget, expires_at);

        // Keep auto-id monotonic when explicit ids are used.
        let next_job_id = read_next_job_id(&env);
        if job_id >= next_job_id {
            let updated = job_id
                .checked_add(1)
                .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::Overflow));
            env.storage().instance().set(&DataKey::NextJobId, &updated);
        }

        log!(
            &env,
            "post_job: id {} client {} budget {}",
            job_id,
            client,
            budget
        );
        env.events()
            .publish((symbol_short!("jobpost"), job_id), (client, budget));
    }

    /// Client posts a job using internal registry index allocation.
    pub fn post_job_auto(
        env: Env,
        client: Address,
        hash: Bytes,
        budget: i128,
        expires_at: u64,
    ) -> u64 {
        ensure_initialized(&env);

        let job_id = read_next_job_id(&env);
        validate_job_input(&env, job_id, &hash, budget, expires_at);

        client.require_auth();
        post_job_with_id(&env, job_id, client.clone(), hash, budget, expires_at);

        env.events().publish((symbol_short!("job_new"), job_id), creator);
    }

    /// Freelancer submits a bid. Must be before the deadline and job must be Active.
    pub fn submit_bid(env: Env, job_id: u32, bidder: Address) -> u32 {
        bidder.require_auth();

        let job: Job = env.storage().persistent()
            .get(&DataKey::Job(job_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::JobNotFound));

        if job.state != JobState::Active {
            panic_with_error!(&env, Error::NotActive);
        }
        if env.ledger().timestamp() >= job.deadline {
            panic_with_error!(&env, Error::DeadlinePassed);
        }

        let now = env.ledger().timestamp();
        if now >= job.expires_at {
            panic_with_error!(&env, JobRegistryError::JobExpired);
        }

        let bids_key = DataKey::Bids(job_id);
        let mut bids: Vec<BidRecord> = env
            .storage()
            .persistent()
            .get(&bids_key)
            .unwrap_or(Map::new(&env));

        for (_, addr) in bids.iter() {
            if addr == bidder {
                panic_with_error!(&env, Error::DuplicateBid);
            }
        }

        let counter_key = DataKey::BidCounter(job_id);
        let next_id = env.storage().instance()
            .get::<DataKey, u32>(&counter_key)
            .unwrap_or(0u32)
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));

        bids.set(next_id, bidder.clone());
        env.storage().instance().set(&bids_key, &bids);
        env.storage().instance().set(&counter_key, &next_id);
        env.storage().instance().extend_ttl(INSTANCE_TTL_BUMP, INSTANCE_TTL_BUMP);

        env.events().publish((symbol_short!("bid_new"), job_id), (next_id, bidder));
        next_id
    }

    /// Creator accepts a bid. Transitions job to Assigned and reclaims instance storage.
    pub fn accept_bid(env: Env, job_id: u32, bid_id: u32) {
        let key = DataKey::Job(job_id);
        let mut job: Job = env.storage().persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::JobNotFound));

        job.creator.require_auth();

        let now = env.ledger().timestamp();
        if now >= job.expires_at {
            panic_with_error!(&env, JobRegistryError::JobExpired);
        }

        // Requirement [SC-REG-035]: Strict ownership validation.
        // Ensures that only the original job creator/client is authorized to accept a proposal.
        if client != job.client {
            panic_with_error!(&env, JobRegistryError::Unauthorized);
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

        // Requirement [SC-REG-035]: Transition registry state cleanly to 'Assigned' (InProgress).
        job.freelancer = Some(freelancer.clone());
        job.status = JobStatus::Assigned;
        env.storage().persistent().set(&key, &job);

        log!(
            &env,
            "accept_bid: id {} client {} freelancer {}",
            job_id,
            client,
            freelancer
        );
        env.events()
            .publish((symbol_short!("accept"), job_id), freelancer);
    }

    /// Client cancels an expired job and transitions it to a terminal expired state.
    pub fn cancel_expired_job(env: Env, job_id: u64, client: Address) {
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

        let now = env.ledger().timestamp();
        if now < job.expires_at {
            panic_with_error!(&env, JobRegistryError::JobNotExpired);
        }

        job.status = JobStatus::Expired;
        env.storage().persistent().set(&key, &job);
        env.storage().persistent().remove(&DataKey::Bids(job_id));

        log!(&env, "cancel_expired_job: id {} client {}", job_id, client);
        env.events()
            .publish((symbol_short!("expired"), job_id), client);
    }

    /// Freelancer submits deliverable IPFS hash.
    pub fn submit_deliverable(env: Env, job_id: u64, freelancer: Address, hash: Bytes) {
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

        job.state = JobState::Assigned;
        job.accepted_bid_id = Some(bid_id);
        env.storage().persistent().set(&key, &job);
        env.storage().persistent().extend_ttl(&key, PERSISTENT_TTL_BUMP, PERSISTENT_TTL_BUMP);

        // Storage reclamation: purge ephemeral bid data to reclaim fees.
        env.storage().instance().remove(&bids_key);
        env.storage().instance().remove(&DataKey::BidCounter(job_id));

        let key = DataKey::Job(job_id);
        let mut job: JobRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::JobNotFound));

        if job.status != JobStatus::Assigned && job.status != JobStatus::DeliverableSubmitted {
            panic_with_error!(&env, JobRegistryError::InvalidStateTransition);
        }

        job.status = JobStatus::Disputed;
        env.storage().persistent().set(&key, &job);

        log!(&env, "mark_disputed: id {}", job_id);
        env.events().publish((symbol_short!("dispute"), job_id), ());
    }

    pub fn get_job(env: Env, job_id: u32) -> Job {
        env.storage().persistent()
            .get(&DataKey::Job(job_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::JobNotFound))
    }

    pub fn get_bids(env: Env, job_id: u32) -> Map<u32, Address> {
        env.storage().instance()
            .get(&DataKey::JobBids(job_id))
            .unwrap_or(Map::new(&env))
    }
}

fn ensure_initialized(env: &Env) {
    if !env.storage().instance().has(&DataKey::Admin) {
        panic_with_error!(env, JobRegistryError::NotInitialized);
    }
}

fn read_admin(env: &Env) -> Address {
    ensure_initialized(env);
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, JobRegistryError::NotInitialized))
}

fn read_next_job_id(env: &Env) -> u64 {
    ensure_initialized(env);
    env.storage()
        .instance()
        .get(&DataKey::NextJobId)
        .unwrap_or_else(|| panic_with_error!(env, JobRegistryError::NotInitialized))
}

fn validate_job_input(env: &Env, job_id: u64, hash: &Bytes, budget: i128, expires_at: u64) {
    if job_id == 0 {
        panic_with_error!(env, JobRegistryError::InvalidJobId);
    }
    if budget <= 0 {
        panic_with_error!(env, JobRegistryError::InvalidBudget);
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

    fn setup() -> (Env, JobRegistryContractClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_000_000);
        let creator = Address::generate(&env);
        let bidder = Address::generate(&env);
        let contract_id = env.register_contract(None, JobRegistryContract);
        let client = JobRegistryContractClient::new(&env, &contract_id);
        (env, client, creator, bidder)
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
    fn test_create_job_success() {
        let (env, cc, creator, _) = setup();
        cc.create_job(&1u32, &creator, &cid(&env), &2_000_000u64);
        let job = cc.get_job(&1u32);
        assert_eq!(job.state, JobState::Active);
        assert_eq!(job.creator, creator);
        assert_eq!(job.accepted_bid_id, None);
    }

    #[test]
    #[should_panic]
    fn test_post_job_before_initialize_panics() {
        let (env, cc, _admin, client, _) = setup();
        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);
    }

    #[test]
    fn test_post_job_auto_allocates_sequential_ids() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash1 = Bytes::from_slice(&env, b"QmHash1");
        let hash2 = Bytes::from_slice(&env, b"QmHash2");
        let expires_at1 = future_expires_at(&env);
        let expires_at2 = future_expires_at(&env);

        let id1 = cc.post_job_auto(&client, &hash1, &5000i128, &expires_at1);
        let id2 = cc.post_job_auto(&client, &hash2, &7000i128, &expires_at2);

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
        cc.post_job(&42u64, &client, &hash, &5000i128, &expires_at);

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
        cc.post_job(&1u64, &client, &empty, &5000i128, &expires_at);
    }

    #[test]
    fn test_full_lifecycle() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmSomeIPFSHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

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
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

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
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

        cc.accept_bid(&1u64, &client, &freelancer);
    }

    #[test]
    fn test_mark_disputed_from_assigned() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

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
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

        cc.mark_disputed(&1u64);
    }

    #[test]
    #[should_panic]
    fn test_submit_bid_after_expiration_panics() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

        env.ledger().set_timestamp(expires_at + 1);

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal);
    }

    #[test]
    #[should_panic]
    fn test_accept_bid_after_expiration_panics() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal);

        env.ledger().set_timestamp(expires_at + 1);
        cc.accept_bid(&1u64, &client, &freelancer);
    }

    #[test]
    fn test_cancel_expired_job_by_client() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

        env.ledger().set_timestamp(expires_at + 1);
        cc.cancel_expired_job(&1u64, &client);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::Expired);
    }

    #[test]
    #[should_panic]
    fn test_cancel_expired_job_before_expiration_panics() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

        cc.cancel_expired_job(&1u64, &client);
    }

    #[test]
    #[should_panic]
    fn test_get_deliverable_without_submission_panics() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

        cc.get_deliverable(&1u64);
    }
}
