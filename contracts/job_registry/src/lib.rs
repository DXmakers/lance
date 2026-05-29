#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum JobStatus {
    Open,
    Assigned,
    Closed,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Job {
    pub owner: Address,
    pub cid: String,
    pub budget: i128,
    pub status: JobStatus,
    pub bid_count: u32,
    pub assigned_bidder: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Bid {
    pub bidder: Address,
    pub amount: i128,
    pub submitted_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Job(u64),
    Bid(u64, u32),
}

#[contract]
pub struct JobRegistryContract;

#[contractimpl]
impl JobRegistryContract {
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();

        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn post_job(env: Env, owner: Address, job_id: u64, cid: String, budget: i128) {
        owner.require_auth();

        let checked_budget = budget.checked_mul(1).expect("overflow");
        if checked_budget <= 0 {
            panic!("budget must be positive");
        }

        let key = DataKey::Job(job_id);
        if env.storage().persistent().has(&key) {
            panic!("job already exists");
        }

        let job = Job {
            owner,
            cid,
            budget,
            status: JobStatus::Open,
            bid_count: 0,
            assigned_bidder: None,
        };

        env.storage().persistent().set(&key, &job);
    }

    pub fn submit_bid(env: Env, job_id: u64, bidder: Address, amount: i128) {
        bidder.require_auth();

        let checked_amount = amount.checked_mul(1).expect("overflow");
        if checked_amount <= 0 {
            panic!("amount must be positive");
        }

        let key = DataKey::Job(job_id);
        let mut job: Job = env
            .storage()
            .persistent()
            .get(&key)
            .expect("job not found");

        if job.status != JobStatus::Open {
            panic!("job not open");
        }

        let bid_index = job.bid_count;
        let bid = Bid {
            bidder,
            amount,
            submitted_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Bid(job_id, bid_index), &bid);

        job.bid_count = job.bid_count.checked_add(1).expect("overflow");
        env.storage().persistent().set(&key, &job);
    }

    pub fn accept_bid(env: Env, job_id: u64, caller: Address, bid_index: u32) {
        caller.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: Job = env
            .storage()
            .persistent()
            .get(&key)
            .expect("job not found");

        if caller != job.owner {
            panic!("unauthorized");
        }
        if job.status != JobStatus::Open {
            panic!("job not open");
        }
        if bid_index >= job.bid_count {
            panic!("invalid bid index");
        }

        let bid: Bid = env
            .storage()
            .persistent()
            .get(&DataKey::Bid(job_id, bid_index))
            .expect("bid not found");

        job.status = JobStatus::Assigned;
        job.assigned_bidder = Some(bid.bidder);
        env.storage().persistent().set(&key, &job);
    }

    pub fn close_job(env: Env, job_id: u64, caller: Address) {
        caller.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: Job = env
            .storage()
            .persistent()
            .get(&key)
            .expect("job not found");

        if caller != job.owner {
            panic!("unauthorized");
        }

        job.status = JobStatus::Closed;
        env.storage().persistent().set(&key, &job);
    }

    pub fn get_job(env: Env, job_id: u64) -> Job {
        env.storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .expect("job not found")
    }

    pub fn get_bid(env: Env, job_id: u64, bid_index: u32) -> Bid {
        env.storage()
            .persistent()
            .get(&DataKey::Bid(job_id, bid_index))
            .expect("bid not found")
    }

    pub fn get_job_status(env: Env, job_id: u64) -> JobStatus {
        Self::get_job(env, job_id).status
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    fn setup_env() -> Env {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| {
            li.timestamp = 1_700_000_000;
        });
        env
    }

    fn setup_client(env: &Env) -> JobRegistryContractClient<'_> {
        let contract_id = env.register_contract(None, JobRegistryContract);
        let client = JobRegistryContractClient::new(env, &contract_id);
        let admin = Address::generate(env);
        client.initialize(&admin);
        client
    }

    fn cid(env: &Env, value: &str) -> String {
        String::from_str(env, value)
    }

    #[test]
    fn test_happy_path() {
        let env = setup_env();
        let client = setup_client(&env);
        let owner = Address::generate(&env);
        let bidder_1 = Address::generate(&env);
        let bidder_2 = Address::generate(&env);

        client.post_job(&owner, &1, &cid(&env, "bafy-job-1"), &1_000);
        client.submit_bid(&1, &bidder_1, &800);
        client.submit_bid(&1, &bidder_2, &700);
        client.accept_bid(&1, &owner, &0);

        let job = client.get_job(&1);
        assert_eq!(job.status, JobStatus::Assigned);
        assert_eq!(job.assigned_bidder, Some(bidder_1));
        assert_eq!(client.get_job_status(&1), JobStatus::Assigned);
    }

    #[test]
    #[should_panic(expected = "unauthorized")]
    fn test_unauthorized_accept_bid() {
        let env = setup_env();
        let client = setup_client(&env);
        let owner = Address::generate(&env);
        let bidder = Address::generate(&env);
        let caller = Address::generate(&env);

        client.post_job(&owner, &1, &cid(&env, "bafy-job-1"), &1_000);
        client.submit_bid(&1, &bidder, &800);
        client.accept_bid(&1, &caller, &0);
    }

    #[test]
    #[should_panic(expected = "job not open")]
    fn test_submit_bid_on_assigned_job() {
        let env = setup_env();
        let client = setup_client(&env);
        let owner = Address::generate(&env);
        let bidder = Address::generate(&env);
        let late_bidder = Address::generate(&env);

        client.post_job(&owner, &1, &cid(&env, "bafy-job-1"), &1_000);
        client.submit_bid(&1, &bidder, &800);
        client.accept_bid(&1, &owner, &0);
        client.submit_bid(&1, &late_bidder, &700);
    }

    #[test]
    #[should_panic(expected = "invalid bid index")]
    fn test_invalid_bid_index() {
        let env = setup_env();
        let client = setup_client(&env);
        let owner = Address::generate(&env);
        let bidder = Address::generate(&env);

        client.post_job(&owner, &1, &cid(&env, "bafy-job-1"), &1_000);
        client.submit_bid(&1, &bidder, &800);
        client.accept_bid(&1, &owner, &1);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, JobRegistryContract);
        let client = JobRegistryContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);

        client.initialize(&admin);
        client.initialize(&admin);
    }

    #[test]
    #[should_panic(expected = "job already exists")]
    fn test_duplicate_job_id() {
        let env = setup_env();
        let client = setup_client(&env);
        let owner = Address::generate(&env);

        client.post_job(&owner, &1, &cid(&env, "bafy-job-1"), &1_000);
        client.post_job(&owner, &1, &cid(&env, "bafy-job-duplicate"), &2_000);
    }

    #[test]
    #[should_panic(expected = "budget must be positive")]
    fn test_negative_budget() {
        let env = setup_env();
        let client = setup_client(&env);
        let owner = Address::generate(&env);

        client.post_job(&owner, &1, &cid(&env, "bafy-job-1"), &-1);
    }

    #[test]
    fn test_close_job() {
        let env = setup_env();
        let client = setup_client(&env);
        let owner = Address::generate(&env);

        client.post_job(&owner, &1, &cid(&env, "bafy-job-1"), &1_000);
        client.close_job(&1, &owner);

        assert_eq!(client.get_job_status(&1), JobStatus::Closed);
    }

    #[test]
    fn test_multiple_jobs_isolated() {
        let env = setup_env();
        let client = setup_client(&env);
        let owner_1 = Address::generate(&env);
        let owner_2 = Address::generate(&env);
        let bidder_1 = Address::generate(&env);
        let bidder_2 = Address::generate(&env);

        client.post_job(&owner_1, &1, &cid(&env, "bafy-job-1"), &1_000);
        client.post_job(&owner_2, &2, &cid(&env, "bafy-job-2"), &2_000);
        client.submit_bid(&1, &bidder_1, &800);
        client.submit_bid(&2, &bidder_2, &1_700);
        client.accept_bid(&1, &owner_1, &0);

        let job_1 = client.get_job(&1);
        let job_2 = client.get_job(&2);

        assert_eq!(job_1.status, JobStatus::Assigned);
        assert_eq!(job_1.assigned_bidder, Some(bidder_1));
        assert_eq!(job_2.status, JobStatus::Open);
        assert_eq!(job_2.assigned_bidder, None);
        assert_eq!(job_1.bid_count, 1);
        assert_eq!(job_2.bid_count, 1);
    }

    #[test]
    fn test_get_bid() {
        let env = setup_env();
        let client = setup_client(&env);
        let owner = Address::generate(&env);
        let bidder = Address::generate(&env);

        client.post_job(&owner, &1, &cid(&env, "bafy-job-1"), &1_000);
        client.submit_bid(&1, &bidder, &750);

        let bid = client.get_bid(&1, &0);
        assert_eq!(bid.bidder, bidder);
        assert_eq!(bid.amount, 750);
        assert_eq!(bid.submitted_at, 1_700_000_000);
    }
}
