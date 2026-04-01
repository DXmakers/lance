#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, Env, Vec};

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
pub struct BidRecord {
    pub freelancer: Address,
    pub proposal_hash: Bytes,
}

#[contracttype]
pub enum DataKey {
    Job(u64),
    Bids(u64),
    Deliverable(u64),
}

#[contract]
pub struct JobRegistryContract;

#[contractimpl]
impl JobRegistryContract {
    /// Client posts a job. `metadata_hash` = IPFS CID bytes.
    pub fn post_job(env: Env, job_id: u64, client: Address, hash: Bytes, budget: i128) {
        client.require_auth();

        let key = DataKey::Job(job_id);
        if env.storage().persistent().has(&key) {
            panic!("job already exists");
        }

        let job = JobRecord {
            client,
            freelancer: None,
            metadata_hash: hash,
            budget_stroops: budget,
            status: JobStatus::Open,
        };
        env.storage().persistent().set(&key, &job);

        let bids: Vec<BidRecord> = Vec::new(&env);
        env.storage()
            .persistent()
            .set(&DataKey::Bids(job_id), &bids);
    }

    /// Freelancer submits a bid.
    pub fn submit_bid(env: Env, job_id: u64, freelancer: Address, proposal_hash: Bytes) {
        freelancer.require_auth();

        let key = DataKey::Job(job_id);
        let job: JobRecord = env.storage().persistent().get(&key).expect("job not found");
        assert!(job.status == JobStatus::Open, "job not open for bids");

        let bids_key = DataKey::Bids(job_id);
        let mut bids: Vec<BidRecord> = env
            .storage()
            .persistent()
            .get(&bids_key)
            .unwrap_or_else(|| Vec::new(&env));

        bids.push_back(BidRecord {
            freelancer,
            proposal_hash,
        });
        env.storage().persistent().set(&bids_key, &bids);
    }

    /// Client accepts a bid, locking in the freelancer.
    pub fn accept_bid(env: Env, job_id: u64, client: Address, freelancer: Address) {
        client.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: JobRecord = env.storage().persistent().get(&key).expect("job not found");

        assert!(job.status == JobStatus::Open, "job not open");
        assert!(client == job.client, "only client can accept bids");

        job.freelancer = Some(freelancer);
        job.status = JobStatus::InProgress;
        env.storage().persistent().set(&key, &job);
    }

    /// Freelancer submits deliverable IPFS hash.
    pub fn submit_deliverable(env: Env, job_id: u64, freelancer: Address, hash: Bytes) {
        freelancer.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: JobRecord = env.storage().persistent().get(&key).expect("job not found");

        assert!(job.status == JobStatus::InProgress, "job not in progress");
        assert!(
            job.freelancer == Some(freelancer.clone()),
            "not the assigned freelancer"
        );

        job.status = JobStatus::DeliverableSubmitted;
        env.storage().persistent().set(&key, &job);
        env.storage()
            .persistent()
            .set(&DataKey::Deliverable(job_id), &hash);
    }

    /// Mark job disputed (called by escrow via cross-contract invoke).
    pub fn mark_disputed(env: Env, job_id: u64) {
        let key = DataKey::Job(job_id);
        let mut job: JobRecord = env.storage().persistent().get(&key).expect("job not found");

        assert!(
            job.status == JobStatus::InProgress || job.status == JobStatus::DeliverableSubmitted,
            "invalid state for dispute"
        );

        job.status = JobStatus::Disputed;
        env.storage().persistent().set(&key, &job);
    }

    pub fn get_job(env: Env, job_id: u64) -> JobRecord {
        env.storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .expect("job not found")
    }

    pub fn get_bids(env: Env, job_id: u64) -> Vec<BidRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::Bids(job_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_deliverable(env: Env, job_id: u64) -> Bytes {
        env.storage()
            .persistent()
            .get(&DataKey::Deliverable(job_id))
            .expect("no deliverable")
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Bytes, Env};

    #[test]
    fn test_full_lifecycle() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmSomeIPFSHash");
        cc.post_job(&1u64, &client, &hash, &5000i128);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::Open);
        assert_eq!(job.freelancer, None);

        let proposal = Bytes::from_slice(&env, b"QmProposalHash");
        cc.submit_bid(&1u64, &freelancer, &proposal);

        let bids = cc.get_bids(&1u64);
        assert_eq!(bids.len(), 1);

        cc.accept_bid(&1u64, &client, &freelancer);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::InProgress);
        assert_eq!(job.freelancer, Some(freelancer.clone()));

        let deliverable = Bytes::from_slice(&env, b"QmDeliverableHash");
        cc.submit_deliverable(&1u64, &freelancer, &deliverable);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::DeliverableSubmitted);

        let d = cc.get_deliverable(&1u64);
        assert_eq!(d, deliverable);
    }

    #[test]
    #[should_panic(expected = "job not open for bids")]
    fn test_bid_on_non_open_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let freelancer1 = Address::generate(&env);
        let freelancer2 = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmHash");
        cc.post_job(&1u64, &client, &hash, &5000i128);
        cc.accept_bid(&1u64, &client, &freelancer1);

        let proposal = Bytes::from_slice(&env, b"QmLate");
        cc.submit_bid(&1u64, &freelancer2, &proposal);
    }

    #[test]
    fn test_mark_disputed_from_in_progress() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmHash");
        cc.post_job(&1u64, &client, &hash, &5000i128);
        cc.accept_bid(&1u64, &client, &freelancer);

        cc.mark_disputed(&1u64);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::Disputed);
    }

    #[test]
    fn test_mark_disputed_from_deliverable_submitted() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmHash");
        cc.post_job(&1u64, &client, &hash, &5000i128);
        cc.accept_bid(&1u64, &client, &freelancer);

        let deliverable = Bytes::from_slice(&env, b"QmDeliverable");
        cc.submit_deliverable(&1u64, &freelancer, &deliverable);

        cc.mark_disputed(&1u64);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::Disputed);
    }

    #[test]
    #[should_panic(expected = "invalid state for dispute")]
    fn test_mark_disputed_from_open_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmHash");
        cc.post_job(&1u64, &client, &hash, &5000i128);

        cc.mark_disputed(&1u64);
    }

    #[test]
    #[should_panic(expected = "job already exists")]
    fn test_duplicate_job_id() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmHash");
        cc.post_job(&1u64, &client, &hash, &5000i128);
        cc.post_job(&1u64, &client, &hash, &5000i128);
    }

    #[test]
    fn test_multiple_jobs_and_bids() {
        let env = Env::default();
        env.mock_all_auths();

        let client1 = Address::generate(&env);
        let client2 = Address::generate(&env);
        let freelancrs: Vec<Address> = Vec::from_array(
            &env,
            [
                Address::generate(&env),
                Address::generate(&env),
                Address::generate(&env),
            ],
        );

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmHash");
        cc.post_job(&1u64, &client1, &hash, &1000i128);
        cc.post_job(&2u64, &client2, &hash, &2000i128);

        let prop1 = Bytes::from_slice(&env, b"P1");
        let prop2 = Bytes::from_slice(&env, b"P2");

        for f in freelancrs.iter() {
            cc.submit_bid(&1u64, &f, &prop1);
            cc.submit_bid(&2u64, &f, &prop2);
        }

        assert_eq!(cc.get_bids(&1u64).len(), 3);
        assert_eq!(cc.get_bids(&2u64).len(), 3);
    }

    #[test]
    #[should_panic(expected = "only client can accept bids")]
    fn test_unauthorized_accept_bid() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let rando = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmHash");
        cc.post_job(&1u64, &client, &hash, &1000i128);
        cc.submit_bid(&1u64, &freelancer, &hash);

        cc.accept_bid(&1u64, &rando, &freelancer);
    }

    #[test]
    #[should_panic(expected = "job not open")]
    fn test_cannot_accept_bid_twice() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let f1 = Address::generate(&env);
        let f2 = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmHash");
        cc.post_job(&1u64, &client, &hash, &1000i128);
        cc.submit_bid(&1u64, &f1, &hash);
        cc.submit_bid(&1u64, &f2, &hash);

        cc.accept_bid(&1u64, &client, &f1);
        cc.accept_bid(&1u64, &client, &f2);
    }

    #[test]
    #[should_panic(expected = "not the assigned freelancer")]
    fn test_submit_deliverable_unauthorized() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let f1 = Address::generate(&env);
        let f2 = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmHash");
        cc.post_job(&1u64, &client, &hash, &1000i128);
        cc.submit_bid(&1u64, &f1, &hash);
        cc.accept_bid(&1u64, &client, &f1);

        cc.submit_deliverable(&1u64, &f2, &hash);
    }
}
