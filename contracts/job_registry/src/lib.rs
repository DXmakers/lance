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
pub enum Error {
    JobAlreadyExists = 1,
    JobNotFound      = 2,
    NotActive        = 3,
    DeadlinePassed   = 4,
    Unauthorized     = 5,
    BidNotFound      = 6,
    DuplicateBid     = 7,
    Overflow         = 8,
    DeadlineInPast   = 9,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum JobState {
    Active,
    Assigned,
    Closed,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Job {
    pub creator: Address,
    pub ipfs_cid: Bytes,
    pub state: JobState,
    pub deadline: u64,
    pub accepted_bid_id: Option<u32>,
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

        if deadline <= env.ledger().timestamp() {
            panic_with_error!(&env, Error::DeadlineInPast);
        }

        let key = DataKey::Job(job_id);
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, Error::JobAlreadyExists);
        }

        env.storage().persistent().set(&key, &Job {
            creator: creator.clone(),
            ipfs_cid,
            state: JobState::Active,
            deadline,
            accepted_bid_id: None,
        });
        env.storage().persistent().extend_ttl(&key, PERSISTENT_TTL_BUMP, PERSISTENT_TTL_BUMP);

        env.storage().instance().set(&DataKey::JobBids(job_id), &Map::<u32, Address>::new(&env));
        env.storage().instance().set(&DataKey::BidCounter(job_id), &0u32);
        env.storage().instance().extend_ttl(INSTANCE_TTL_BUMP, INSTANCE_TTL_BUMP);

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

        let bids_key = DataKey::JobBids(job_id);
        let mut bids: Map<u32, Address> = env.storage().instance()
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

        if job.state != JobState::Active {
            panic_with_error!(&env, Error::NotActive);
        }

        let bids_key = DataKey::JobBids(job_id);
        let bids: Map<u32, Address> = env.storage().instance()
            .get(&bids_key)
            .unwrap_or(Map::new(&env));

        if !bids.contains_key(bid_id) {
            panic_with_error!(&env, Error::BidNotFound);
        }

        job.state = JobState::Assigned;
        job.accepted_bid_id = Some(bid_id);
        env.storage().persistent().set(&key, &job);
        env.storage().persistent().extend_ttl(&key, PERSISTENT_TTL_BUMP, PERSISTENT_TTL_BUMP);

        // Storage reclamation: purge ephemeral bid data to reclaim fees.
        env.storage().instance().remove(&bids_key);
        env.storage().instance().remove(&DataKey::BidCounter(job_id));

        env.events().publish((symbol_short!("accepted"), job_id), bid_id);
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

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
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

    fn cid(env: &Env) -> Bytes {
        Bytes::from_slice(env, b"QmTestCID")
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
    fn test_submit_bid_returns_sequential_ids() {
        let (env, cc, creator, bidder) = setup();
        cc.create_job(&1u32, &creator, &cid(&env), &2_000_000u64);
        let bidder2 = Address::generate(&env);
        assert_eq!(cc.submit_bid(&1u32, &bidder), 1u32);
        assert_eq!(cc.submit_bid(&1u32, &bidder2), 2u32);
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

    #[test]
    fn test_instance_keys_removed_after_accept() {
        let (env, cc, creator, bidder) = setup();
        cc.create_job(&1u32, &creator, &cid(&env), &2_000_000u64);
        let bid_id = cc.submit_bid(&1u32, &bidder);
        cc.accept_bid(&1u32, &bid_id);
        assert_eq!(cc.get_bids(&1u32).len(), 0);
        env.as_contract(&cc.address, || {
            assert!(!env.storage().instance().has(&DataKey::JobBids(1u32)));
            assert!(!env.storage().instance().has(&DataKey::BidCounter(1u32)));
        });
    }

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
        cc.create_job(&1u32, &creator, &cid(&env), &999_999u64);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_bid_after_deadline_fails() {
        let (env, cc, creator, bidder) = setup();
        cc.create_job(&1u32, &creator, &cid(&env), &1_000_100u64);
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
        cc.submit_bid(&1u32, &Address::generate(&env));
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
