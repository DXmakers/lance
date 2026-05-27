#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Bytes, Env, Map,
};

// TTL constants (in ledgers; ~5s/ledger on Stellar)
const PERSISTENT_TTL_BUMP: u32 = 535_680; // ~31 days
const INSTANCE_TTL_BUMP: u32 = 17_280;    // ~1 day

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    JobAlreadyExists  = 1,
    JobNotFound       = 2,
    NotActive         = 3,
    DeadlinePassed    = 4,
    Unauthorized      = 5,
    BidNotFound       = 6,
    DuplicateBid      = 7,
    Overflow          = 8,
    DeadlineInPast    = 9,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum JobState {
    Active,
    Assigned,
    Closed,
}

/// Core job metadata — stored in Persistent storage.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Job {
    pub creator: Address,
    pub ipfs_cid: Bytes,
    pub state: JobState,
    pub deadline: u64,
    pub accepted_bid_id: Option<u32>,
}

/// Persistent keys: long-lived job data.
/// Instance keys: ephemeral bid data, reclaimed on assignment.
#[contracttype]
pub enum DataKey {
    // Persistent
    Job(u32),
    // Instance
    JobBids(u32),   // Map<u32, Address>  bid_id -> bidder
    BidCounter(u32),
}

#[contract]
pub struct JobRegistryContract;

#[contractimpl]
impl JobRegistryContract {
    /// Create a new job. `deadline` is an absolute ledger timestamp (seconds).
    pub fn create_job(env: Env, job_id: u32, creator: Address, ipfs_cid: Bytes, deadline: u64) {
        creator.require_auth();

        let now = env.ledger().timestamp();
        if deadline <= now {
            panic_with_error!(&env, Error::DeadlineInPast);
        }

        let key = DataKey::Job(job_id);
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::JobAlreadyExists);
        }

        let job = Job {
            creator: creator.clone(),
            ipfs_cid,
            state: JobState::Active,
            deadline,
            accepted_bid_id: None,
        };
        env.storage().persistent().set(&key, &job);
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_BUMP, PERSISTENT_TTL_BUMP);

        // Initialise instance bid data for this job.
        let bids: Map<u32, Address> = Map::new(&env);
        env.storage()
            .instance()
            .set(&DataKey::JobBids(job_id), &bids);
        env.storage()
            .instance()
            .set(&DataKey::BidCounter(job_id), &0u32);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_BUMP, INSTANCE_TTL_BUMP);

        env.events()
            .publish((symbol_short!("job_new"), job_id), creator);
    }

    /// Freelancer submits a bid. Must be before the deadline and job must be Active.
    pub fn submit_bid(env: Env, job_id: u32, bidder: Address) -> u32 {
        bidder.require_auth();

        let key = DataKey::Job(job_id);
        let job: Job = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::JobNotFound));

        if job.state != JobState::Active {
            panic_with_error!(&env, Error::NotActive);
        }
        if env.ledger().timestamp() >= job.deadline {
            panic_with_error!(&env, Error::DeadlinePassed);
        }

        // Duplicate check
        let bids_key = DataKey::JobBids(job_id);
        let mut bids: Map<u32, Address> = env
            .storage()
            .instance()
            .get(&bids_key)
            .unwrap_or(Map::new(&env));

        // Requirement [SC-REG-035]: Enforce strict single-bid constraint per freelancer on active jobs.
        // Loops through the dynamic bid structures mapped from the Job ID to find duplicate submissions.
        for bid in bids.iter() {
            if bid.freelancer == freelancer {
                panic_with_error!(&env, JobRegistryError::BidAlreadySubmitted);
            }
        }

        let counter_key = DataKey::BidCounter(job_id);
        let bid_id: u32 = env
            .storage()
            .instance()
            .get(&counter_key)
            .unwrap_or(0u32);
        let next_id = bid_id
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));

        bids.set(next_id, bidder.clone());
        env.storage().instance().set(&bids_key, &bids);
        env.storage().instance().set(&counter_key, &next_id);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_BUMP, INSTANCE_TTL_BUMP);

        env.events()
            .publish((symbol_short!("bid_new"), job_id), (next_id, bidder));

        next_id
    }

    /// Creator accepts a bid. Transitions job to Assigned and reclaims instance storage.
    pub fn accept_bid(env: Env, job_id: u32, bid_id: u32) {
        let key = DataKey::Job(job_id);
        let mut job: Job = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::JobNotFound));

        if job.status != JobStatus::Open {
            panic_with_error!(&env, JobRegistryError::JobNotOpen);
        }

        // Requirement [SC-REG-035]: Strict ownership validation.
        // Ensures that only the original job creator/client is authorized to accept a proposal.
        if client != job.client {
            panic_with_error!(&env, JobRegistryError::Unauthorized);
        }

        if job.state != JobState::Active {
            panic_with_error!(&env, Error::NotActive);
        }
        if !found {
            panic_with_error!(&env, JobRegistryError::BidNotFound);
        }

        // Requirement [SC-REG-035]: Transition registry state cleanly to 'Assigned' (InProgress).
        job.freelancer = Some(freelancer.clone());
        job.status = JobStatus::InProgress;
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

    /// Freelancer submits deliverable IPFS hash.
    pub fn submit_deliverable(env: Env, job_id: u64, freelancer: Address, hash: Bytes) {
        ensure_initialized(&env);
        validate_hash(&env, &hash);
        freelancer.require_auth();

        let bids_key = DataKey::JobBids(job_id);
        let bids: Map<u32, Address> = env
            .storage()
            .instance()
            .get(&bids_key)
            .unwrap_or(Map::new(&env));

        if !bids.contains_key(bid_id) {
            panic_with_error!(&env, Error::BidNotFound);
        }

        // Transition state
        job.state = JobState::Assigned;
        job.accepted_bid_id = Some(bid_id);
        env.storage().persistent().set(&key, &job);
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_BUMP, PERSISTENT_TTL_BUMP);

        // ── Storage Reclamation ──────────────────────────────────────────────
        // Remove all instance keys for this job to reclaim storage fees.
        env.storage().instance().remove(&bids_key);
        env.storage()
            .instance()
            .remove(&DataKey::BidCounter(job_id));
        // ────────────────────────────────────────────────────────────────────

        env.events()
            .publish((symbol_short!("accepted"), job_id), bid_id);
    }

    /// Read a job record.
    pub fn get_job(env: Env, job_id: u32) -> Job {
        env.storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::JobNotFound))
    }

    /// Read current bids map (only available while job is Active).
    pub fn get_bids(env: Env, job_id: u32) -> Map<u32, Address> {
        env.storage()
            .instance()
            .get(&DataKey::JobBids(job_id))
            .unwrap_or(Map::new(&env))
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{Address, Bytes, Env};

    fn setup() -> (Env, JobRegistryContractClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        // Start at a non-zero timestamp so deadline arithmetic is meaningful.
        env.ledger().with_mut(|l| l.timestamp = 1_000_000);

        let creator = Address::generate(&env);
        let bidder = Address::generate(&env);
        let contract_id = env.register_contract(None, JobRegistryContract);
        let client = JobRegistryContractClient::new(&env, &contract_id);
        (env, client, creator, bidder)
    }

    fn cid(env: &Env) -> Bytes {
        Bytes::from_slice(env, b"QmTestCID")
    }

    // ── Happy path ────────────────────────────────────────────────────────────

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
    fn test_submit_bid_returns_sequential_ids() {
        let (env, cc, creator, bidder) = setup();
        cc.create_job(&1u32, &creator, &cid(&env), &2_000_000u64);

        let bidder2 = Address::generate(&env);
        let id1 = cc.submit_bid(&1u32, &bidder);
        let id2 = cc.submit_bid(&1u32, &bidder2);
        assert_eq!(id1, 1u32);
        assert_eq!(id2, 2u32);
    }

    #[test]
    fn test_accept_bid_assigns_job() {
        let (env, cc, creator, bidder) = setup();
        cc.create_job(&1u32, &creator, &cid(&env), &2_000_000u64);
        let bid_id = cc.submit_bid(&1u32, &bidder);

        cc.accept_bid(&1u32, &bid_id);

        let job = cc.get_job(&1u32);
        assert_eq!(job.state, JobState::Assigned);
        assert_eq!(job.accepted_bid_id, Some(bid_id));
    }

    // ── Storage reclamation ───────────────────────────────────────────────────

    #[test]
    fn test_instance_keys_removed_after_accept() {
        let (env, cc, creator, bidder) = setup();
        cc.create_job(&1u32, &creator, &cid(&env), &2_000_000u64);
        let bid_id = cc.submit_bid(&1u32, &bidder);
        cc.accept_bid(&1u32, &bid_id);

        // After reclamation, get_bids returns an empty map (keys gone).
        let bids = cc.get_bids(&1u32);
        assert_eq!(bids.len(), 0);

        // Verify directly via env storage that the instance keys are absent.
        env.as_contract(&cc.address, || {
            assert!(!env
                .storage()
                .instance()
                .has(&DataKey::JobBids(1u32)));
            assert!(!env
                .storage()
                .instance()
                .has(&DataKey::BidCounter(1u32)));
        });
    }

    // ── Edge cases ────────────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "Error(Contract, #1)")]
    fn test_duplicate_job_id_fails() {
        let (env, cc, creator, _) = setup();
        cc.create_job(&1u32, &creator, &cid(&env), &2_000_000u64);
        cc.create_job(&1u32, &creator, &cid(&env), &2_000_000u64);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #9)")]
    fn test_deadline_in_past_fails() {
        let (env, cc, creator, _) = setup();
        // deadline <= current timestamp (1_000_000)
        cc.create_job(&1u32, &creator, &cid(&env), &999_999u64);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_bid_after_deadline_fails() {
        let (env, cc, creator, bidder) = setup();
        cc.create_job(&1u32, &creator, &cid(&env), &1_000_100u64);

        // Advance ledger past deadline
        env.ledger().with_mut(|l| l.timestamp = 1_000_200);
        cc.submit_bid(&1u32, &bidder);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn test_duplicate_bid_fails() {
        let (env, cc, creator, bidder) = setup();
        cc.create_job(&1u32, &creator, &cid(&env), &2_000_000u64);
        cc.submit_bid(&1u32, &bidder);
        cc.submit_bid(&1u32, &bidder);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_bid_on_assigned_job_fails() {
        let (env, cc, creator, bidder) = setup();
        cc.create_job(&1u32, &creator, &cid(&env), &2_000_000u64);
        let bid_id = cc.submit_bid(&1u32, &bidder);
        cc.accept_bid(&1u32, &bid_id);

        let late_bidder = Address::generate(&env);
        cc.submit_bid(&1u32, &late_bidder);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_accept_nonexistent_bid_fails() {
        let (env, cc, creator, _) = setup();
        cc.create_job(&1u32, &creator, &cid(&env), &2_000_000u64);
        cc.accept_bid(&1u32, &99u32);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_accept_bid_twice_fails() {
        let (env, cc, creator, bidder) = setup();
        cc.create_job(&1u32, &creator, &cid(&env), &2_000_000u64);
        let bid_id = cc.submit_bid(&1u32, &bidder);
        cc.accept_bid(&1u32, &bid_id);
        cc.accept_bid(&1u32, &bid_id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_get_nonexistent_job_fails() {
        let (_env, cc, _, _) = setup();
        cc.get_job(&999u32);
    }
}
