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
        assert_positive(budget, "budget must be greater than zero");

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
        assert_positive(amount, "amount must be greater than zero");

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
            panic!("bid index out of bounds");
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

fn assert_positive(value: i128, message: &str) {
    let checked = value.checked_mul(1).expect("overflow");
    if checked <= 0 {
        panic!("{}", message);
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
        let client = JobRegistryContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        client
    }

    fn cid(env: &Env, suffix: &str) -> String {
        String::from_str(env, suffix)
    }

    #[test]
    fn happy_path_post_job_submit_bids_accept_bid_status_is_assigned() {
        let env = setup_env();
        let client = setup_client(&env);
        let owner = Address::generate(&env);
        let bidder_a = Address::generate(&env);
        let bidder_b = Address::generate(&env);

        client.post_job(&owner, &1, &cid(&env, "bafy-job-1"), &1_000);
        client.submit_bid(&1, &bidder_a, &700);
        client.submit_bid(&1, &bidder_b, &650);
        client.accept_bid(&1, &owner, &1);

        let job = client.get_job(&1);
        assert_eq!(job.status, JobStatus::Assigned);
        assert_eq!(client.get_job_status(&1), JobStatus::Assigned);
        assert_eq!(job.bid_count, 2);
        assert_eq!(job.assigned_bidder, Some(bidder_b.clone()));

        let bid = client.get_bid(&1, &0);
        assert_eq!(bid.bidder, bidder_a);
        assert_eq!(bid.amount, 700);
        assert_eq!(bid.submitted_at, 1_700_000_000);
    }

    #[test]
    #[should_panic(expected = "unauthorized")]
    fn only_owner_can_accept_bid() {
        let env = setup_env();
        let client = setup_client(&env);
        let owner = Address::generate(&env);
        let attacker = Address::generate(&env);
        let bidder = Address::generate(&env);

        client.post_job(&owner, &1, &cid(&env, "bafy-job-1"), &1_000);
        client.submit_bid(&1, &bidder, &900);
        client.accept_bid(&1, &attacker, &0);
    }

    #[test]
    #[should_panic(expected = "job not open")]
    fn cannot_submit_bid_on_non_open_job() {
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
    #[should_panic(expected = "bid index out of bounds")]
    fn cannot_accept_out_of_bounds_bid_index() {
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
    fn double_initialize_panics() {
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
    fn duplicate_job_id_panics() {
        let env = setup_env();
        let client = setup_client(&env);
        let owner = Address::generate(&env);

        client.post_job(&owner, &1, &cid(&env, "bafy-job-1"), &1_000);
        client.post_job(&owner, &1, &cid(&env, "bafy-job-1-duplicate"), &2_000);
    }

    #[test]
    fn job_status_transitions_after_accept_and_close() {
        let env = setup_env();
        let client = setup_client(&env);
        let owner = Address::generate(&env);
        let bidder = Address::generate(&env);

        client.post_job(&owner, &1, &cid(&env, "bafy-job-1"), &1_000);
        assert_eq!(client.get_job_status(&1), JobStatus::Open);

        client.submit_bid(&1, &bidder, &750);
        client.accept_bid(&1, &owner, &0);
        assert_eq!(client.get_job_status(&1), JobStatus::Assigned);

        client.close_job(&1, &owner);
        assert_eq!(client.get_job_status(&1), JobStatus::Closed);
    }

    #[test]
    fn multiple_jobs_are_isolated_from_each_other() {
        let env = setup_env();
        let client = setup_client(&env);
        let owner_a = Address::generate(&env);
        let owner_b = Address::generate(&env);
        let bidder_a = Address::generate(&env);
        let bidder_b = Address::generate(&env);

        client.post_job(&owner_a, &1, &cid(&env, "bafy-job-1"), &1_000);
        client.post_job(&owner_b, &2, &cid(&env, "bafy-job-2"), &2_000);
        client.submit_bid(&1, &bidder_a, &900);
        client.submit_bid(&2, &bidder_b, &1_500);
        client.accept_bid(&1, &owner_a, &0);

        let job_a = client.get_job(&1);
        let job_b = client.get_job(&2);
        let bid_a = client.get_bid(&1, &0);
        let bid_b = client.get_bid(&2, &0);

        assert_eq!(job_a.status, JobStatus::Assigned);
        assert_eq!(job_a.assigned_bidder, Some(bidder_a.clone()));
        assert_eq!(job_b.status, JobStatus::Open);
        assert_eq!(job_b.assigned_bidder, None);
        assert_eq!(bid_a.bidder, bidder_a);
        assert_eq!(bid_b.bidder, bidder_b);
    }

    #[test]
    #[should_panic(expected = "budget must be greater than zero")]
    fn budget_must_be_greater_than_zero() {
        let env = setup_env();
        let client = setup_client(&env);
        let owner = Address::generate(&env);

        client.post_job(&owner, &1, &cid(&env, "bafy-job-1"), &0);
    }
}
