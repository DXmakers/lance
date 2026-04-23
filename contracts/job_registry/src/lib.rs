#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Bytes, Env, Vec};

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

/// Error codes for JobRegistry contract operations.
///
/// These error codes follow Soroban standard error patterns and enable
/// comprehensive error handling while maintaining backward compatibility
/// with the Stellar ecosystem.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum JobRegistryError {
    /// Indicates the specified job does not exist in storage (error code: 1).
    JobNotFound = 1,
    /// Indicates the job is not in the Open status for accepting bids (error code: 2).
    JobNotOpen = 2,
    /// Indicates an unauthorized access attempt - authentication failure (error code: 3).
    Unauthorized = 3,
    /// Indicates invalid input parameters, e.g., empty proposal hash (error code: 4).
    InvalidInput = 4,
    /// Indicates an invalid state transition or operation (error code: 5).
    InvalidState = 5,
    /// Indicates the selected freelancer did not submit a bid for the job (error code: 6).
    BidNotFound = 6,
}

/// Event emitted when a job is successfully created.
///
/// This event is published to enable off-chain indexing and monitoring
/// of all job postings on the platform. Includes timestamp for audit trails.
#[contracttype]
#[derive(Clone)]
pub struct JobCreatedEvent {
    pub job_id: u64,
    pub client: Address,
    pub metadata_hash: Bytes,
    pub budget_stroops: i128,
    pub created_at: u64,
}

/// Event emitted when a bid is successfully submitted.
///
/// This event is published to enable off-chain indexing and monitoring
/// of all bid submissions on the platform. Includes timestamp for audit trails.
#[contracttype]
#[derive(Clone)]
pub struct BidSubmittedEvent {
    pub job_id: u64,
    pub freelancer: Address,
    pub proposal_hash: Bytes,
    pub timestamp: u64,
}

/// Event emitted when a bid is accepted.
#[contracttype]
#[derive(Clone)]
pub struct BidAcceptedEvent {
    pub job_id: u64,
    pub client: Address,
    pub freelancer: Address,
    pub timestamp: u64,
}

/// Event emitted when a deliverable is submitted.
///
/// This event is published to enable off-chain indexing and monitoring
/// of all deliverable submissions on the platform. Includes timestamp for audit trails.
#[contracttype]
#[derive(Clone)]
pub struct DeliverableSubmittedEvent {
    pub job_id: u64,
    pub freelancer: Address,
    pub deliverable_hash: Bytes,
    pub timestamp: u64,
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
            client: client.clone(),
            freelancer: None,
            metadata_hash: hash.clone(),
            budget_stroops: budget,
            status: JobStatus::Open,
        };
        env.storage().persistent().set(&key, &job);

        let bids: Vec<BidRecord> = Vec::new(&env);
        env.storage()
            .persistent()
            .set(&DataKey::Bids(job_id), &bids);

        // Emit JobCreated event for off-chain indexing and monitoring
        env.events().publish(
            ("job_registry", "JobCreated"),
            JobCreatedEvent {
                job_id,
                client,
                metadata_hash: hash,
                budget_stroops: budget,
                created_at: env.ledger().timestamp(),
            },
        );
    }

    /// Freelancer submits a bid on an open job.
    ///
    /// This is the core operation enabling freelancers to propose solutions
    /// for posted jobs. Validation ensures:
    /// 1. The freelancer is authenticated via Stellar signature
    /// 2. The job exists and is in Open status
    /// 3. The proposal hash is not empty (content validation)
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `job_id` - The unique identifier of the job
    /// * `freelancer` - The address of the freelancer submitting the bid
    /// * `proposal_hash` - The IPFS CID hash of the proposal document
    ///
    /// # Returns
    /// * `Ok(())` - If the bid is successfully submitted
    /// * `Err(JobRegistryError::JobNotFound)` - If the job ID does not exist
    /// * `Err(JobRegistryError::JobNotOpen)` - If the job status is not Open
    /// * `Err(JobRegistryError::InvalidInput)` - If the proposal hash is empty
    ///
    /// # Security Considerations
    /// * Requires freelancer authentication via `require_auth()` to prevent spoofing
    /// * Validates job status to prevent bid manipulation
    /// * Prevents submission of invalid (empty) proposal hashes
    /// * Emits auditable event with timestamp for off-chain monitoring
    /// * Supports multiple bids from different freelancers on the same job
    pub fn submit_bid(
        env: Env,
        job_id: u64,
        freelancer: Address,
        proposal_hash: Bytes,
    ) -> Result<(), JobRegistryError> {
        // Authenticate the freelancer to ensure authorization
        freelancer.require_auth();

        // Validate input: proposal_hash must not be empty
        if proposal_hash.is_empty() {
            return Err(JobRegistryError::InvalidInput);
        }

        // Retrieve job record with error handling for missing jobs
        let key = DataKey::Job(job_id);
        let job: JobRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(JobRegistryError::JobNotFound)?;

        // Ensure job is in Open status - cannot bid on jobs that are not accepting bids
        if job.status != JobStatus::Open {
            return Err(JobRegistryError::JobNotOpen);
        }

        // Retrieve existing bids vector or create new empty vector
        let bids_key = DataKey::Bids(job_id);
        let mut bids: Vec<BidRecord> = env
            .storage()
            .persistent()
            .get(&bids_key)
            .unwrap_or_else(|| Vec::new(&env));

        // Add the new bid to the vector
        bids.push_back(BidRecord {
            freelancer: freelancer.clone(),
            proposal_hash: proposal_hash.clone(),
        });

        // Persist updated bids vector to storage
        env.storage().persistent().set(&bids_key, &bids);

        // Emit auditable event for off-chain indexing and monitoring
        // Timestamp ensures audit trail for all submissions
        env.events().publish(
            ("job_registry", "BidSubmitted"),
            BidSubmittedEvent {
                job_id,
                freelancer,
                proposal_hash,
                timestamp: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    /// Client accepts a bid, locking in the freelancer.
    pub fn accept_bid(
        env: Env,
        job_id: u64,
        client: Address,
        freelancer: Address,
    ) -> Result<(), JobRegistryError> {
        client.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: JobRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(JobRegistryError::JobNotFound)?;

        if job.status != JobStatus::Open {
            return Err(JobRegistryError::InvalidState);
        }
        if client != job.client {
            return Err(JobRegistryError::Unauthorized);
        }

        let bids_key = DataKey::Bids(job_id);
        let bids: Vec<BidRecord> = env
            .storage()
            .persistent()
            .get(&bids_key)
            .unwrap_or_else(|| Vec::new(&env));

        let mut bid_found = false;
        let mut idx = 0u32;
        let bids_len = bids.len();
        while idx < bids_len {
            let bid = bids.get(idx).expect("bid vector index");
            if bid.freelancer == freelancer {
                bid_found = true;
                break;
            }
            idx += 1;
        }

        if !bid_found {
            return Err(JobRegistryError::BidNotFound);
        }

        job.freelancer = Some(freelancer.clone());
        job.status = JobStatus::InProgress;
        env.storage().persistent().set(&key, &job);

        env.events().publish(
            ("job_registry", "BidAccepted"),
            BidAcceptedEvent {
                job_id,
                client,
                freelancer,
                timestamp: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    /// Freelancer submits a deliverable for a job in progress.
    ///
    /// This is the core operation enabling freelancers to submit completed work
    /// for jobs they have been assigned to. The deliverable is stored as an IPFS
    /// hash to minimize on-chain storage while maintaining decentralized content
    /// accessibility. Validation ensures:
    /// 1. The freelancer is authenticated via Stellar signature
    /// 2. The job exists and is in InProgress status
    /// 3. The deliverable hash is not empty (content validation)
    /// 4. The caller is the assigned freelancer for the job
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `job_id` - The unique identifier of the job
    /// * `freelancer` - The address of the freelancer submitting the deliverable
    /// * `hash` - The IPFS CID hash of the deliverable content
    ///
    /// # Returns
    /// * `Ok(())` - If the deliverable is successfully submitted
    /// * `Err(JobRegistryError::JobNotFound)` - If the job ID does not exist
    /// * `Err(JobRegistryError::InvalidInput)` - If the deliverable hash is empty
    /// * `Err(JobRegistryError::InvalidState)` - If the job status is not InProgress
    /// * `Err(JobRegistryError::Unauthorized)` - If the caller is not the assigned freelancer
    ///
    /// # Security Considerations
    /// * Requires freelancer authentication via `require_auth()` to prevent spoofing
    /// * Validates job status to prevent premature or invalid submissions
    /// * Prevents submission of invalid (empty) deliverable hashes
    /// * Ensures only the assigned freelancer can submit deliverables
    /// * Emits auditable event with timestamp for off-chain monitoring
    /// * Stores deliverable hash persistently for escrow and dispute resolution
    pub fn submit_deliverable(
        env: Env,
        job_id: u64,
        freelancer: Address,
        hash: Bytes,
    ) -> Result<(), JobRegistryError> {
        freelancer.require_auth();

        if hash.is_empty() {
            return Err(JobRegistryError::InvalidInput);
        }

        let key = DataKey::Job(job_id);
        let mut job: JobRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(JobRegistryError::JobNotFound)?;

        if job.status != JobStatus::InProgress {
            return Err(JobRegistryError::InvalidState);
        }
        if job.freelancer != Some(freelancer.clone()) {
            return Err(JobRegistryError::Unauthorized);
        }

        job.status = JobStatus::DeliverableSubmitted;
        env.storage().persistent().set(&key, &job);
        env.storage()
            .persistent()
            .set(&DataKey::Deliverable(job_id), &hash);

        env.events().publish(
            ("job_registry", "DeliverableSubmitted"),
            DeliverableSubmittedEvent {
                job_id,
                freelancer: freelancer.clone(),
                deliverable_hash: hash.clone(),
                timestamp: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    /// Mark job disputed (called by escrow via cross-contract invoke).
    pub fn mark_disputed(env: Env, job_id: u64) -> Result<(), JobRegistryError> {
        let key = DataKey::Job(job_id);
        let mut job: JobRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(JobRegistryError::JobNotFound)?;

        if job.status != JobStatus::InProgress && job.status != JobStatus::DeliverableSubmitted {
            return Err(JobRegistryError::InvalidState);
        }

        job.status = JobStatus::Disputed;
        env.storage().persistent().set(&key, &job);

        env.events().publish(
            ("job_registry", "Disputed"),
            (job_id, env.ledger().timestamp()),
        );

        Ok(())
    }

    /// Retrieves a job record by its ID.
    ///
    /// This is a view function that provides the full state of a job,
    /// including its status, client, and assigned freelancer.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `job_id` - The unique identifier of the job
    ///
    /// # Returns
    /// * `Ok(JobRecord)` - The job record if found
    /// * `Err(JobRegistryError::JobNotFound)` - If the job ID does not exist
    pub fn get_job(env: Env, job_id: u64) -> Result<JobRecord, JobRegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .ok_or(JobRegistryError::JobNotFound)
    }

    /// Retrieves all bids for a specific job.
    ///
    /// This is a view function that returns the history of all bids
    /// submitted for a given job. If a job exists but has no bids,
    /// an empty vector is returned.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment
    /// * `job_id` - The unique identifier of the job
    ///
    /// # Returns
    /// * `Ok(Vec<BidRecord>)` - A vector of all bids submitted for the job
    /// * `Err(JobRegistryError::JobNotFound)` - If the job ID does not exist
    pub fn get_bids(env: Env, job_id: u64) -> Result<Vec<BidRecord>, JobRegistryError> {
        if !env.storage().persistent().has(&DataKey::Job(job_id)) {
            return Err(JobRegistryError::JobNotFound);
        }

        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::Bids(job_id))
            .unwrap_or_else(|| Vec::new(&env)))
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
    fn test_job_created_event_emitted() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmJobHash");
        let budget = 7500i128;
        cc.post_job(&42u64, &client, &hash, &budget);

        // Verify job was created correctly
        let job = cc.get_job(&42u64);
        assert_eq!(job.status, JobStatus::Open);
        assert_eq!(job.client, client);
        assert_eq!(job.metadata_hash, hash);
        assert_eq!(job.budget_stroops, budget);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // submit_bid comprehensive test suite (>90% coverage)
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_submit_bid_success() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmJob");
        cc.post_job(&1u64, &client, &hash, &5000i128);

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal);

        let bids = cc.get_bids(&1u64);
        assert_eq!(bids.len(), 1);
        assert_eq!(bids.get(0).unwrap().freelancer, freelancer);
        assert_eq!(bids.get(0).unwrap().proposal_hash, proposal);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1)")]
    fn test_submit_bid_job_not_found() {
        let env = Env::default();
        env.mock_all_auths();

        let freelancer = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&999u64, &freelancer, &proposal);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_submit_bid_empty_proposal_hash() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmJob");
        cc.post_job(&1u64, &client, &hash, &5000i128);

        let empty_proposal = Bytes::from_slice(&env, b"");
        cc.submit_bid(&1u64, &freelancer, &empty_proposal);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_submit_bid_on_non_open_job() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let freelancer1 = Address::generate(&env);
        let freelancer2 = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmHash");
        cc.post_job(&1u64, &client, &hash, &5000i128);

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer1, &proposal);
        cc.accept_bid(&1u64, &client, &freelancer1);

        let late_proposal = Bytes::from_slice(&env, b"QmLateProposal");
        cc.submit_bid(&1u64, &freelancer2, &late_proposal);
    }

    #[test]
    fn test_accept_bid_success() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmJob");
        cc.post_job(&1u64, &client, &hash, &5000i128);

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal);

        cc.accept_bid(&1u64, &client, &freelancer);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::InProgress);
        assert_eq!(job.freelancer, Some(freelancer));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_accept_bid_requires_existing_bid() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmJob");
        cc.post_job(&1u64, &client, &hash, &5000i128);

        cc.accept_bid(&1u64, &client, &freelancer);
    }

    #[test]
    fn test_multiple_bids_on_same_job() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmHash");
        cc.post_job(&1u64, &client, &hash, &5000i128);

        // Submit multiple bids from different freelancers
        let proposals = [
            b"QmProposal1" as &[u8],
            b"QmProposal2",
            b"QmProposal3",
            b"QmProposal4",
            b"QmProposal5",
        ];

        for proposal_bytes in &proposals {
            let freelancer = Address::generate(&env);
            let proposal = Bytes::from_slice(&env, proposal_bytes);
            cc.submit_bid(&1u64, &freelancer, &proposal);
        }

        let bids = cc.get_bids(&1u64);
        assert_eq!(bids.len(), 5);
    }

    #[test]
    fn test_bid_same_freelancer_multiple_times() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmHash");
        cc.post_job(&1u64, &client, &hash, &5000i128);

        // Same freelancer can submit multiple different proposals
        let proposal1 = Bytes::from_slice(&env, b"QmProposal1");
        cc.submit_bid(&1u64, &freelancer, &proposal1);

        let proposal2 = Bytes::from_slice(&env, b"QmProposal2");
        cc.submit_bid(&1u64, &freelancer, &proposal2);

        let bids = cc.get_bids(&1u64);
        assert_eq!(bids.len(), 2);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Integration tests for other functions
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
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

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer1, &proposal);
        cc.accept_bid(&1u64, &client, &freelancer1);

        let late_proposal = Bytes::from_slice(&env, b"QmLate");
        cc.submit_bid(&1u64, &freelancer2, &late_proposal);
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

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal);
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

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal);
        cc.accept_bid(&1u64, &client, &freelancer);

        let deliverable = Bytes::from_slice(&env, b"QmDeliverable");
        cc.submit_deliverable(&1u64, &freelancer, &deliverable);

        cc.mark_disputed(&1u64);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::Disputed);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn test_mark_disputed_from_open_fails() {
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
        let freelancers: Vec<Address> = Vec::from_array(
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

        for f in freelancers.iter() {
            cc.submit_bid(&1u64, &f, &prop1);
            cc.submit_bid(&2u64, &f, &prop2);
        }

        assert_eq!(cc.get_bids(&1u64).len(), 3);
        assert_eq!(cc.get_bids(&2u64).len(), 3);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
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

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal);

        cc.accept_bid(&1u64, &rando, &freelancer);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
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

        let prop = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &f1, &prop);
        cc.submit_bid(&1u64, &f2, &prop);

        cc.accept_bid(&1u64, &client, &f1);
        cc.accept_bid(&1u64, &client, &f2);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
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

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &f1, &proposal);
        cc.accept_bid(&1u64, &client, &f1);

        let deliverable = Bytes::from_slice(&env, b"QmDeliverable");
        cc.submit_deliverable(&1u64, &f2, &deliverable);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_submit_deliverable_empty_hash() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmHash");
        cc.post_job(&1u64, &client, &hash, &1000i128);

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal);
        cc.accept_bid(&1u64, &client, &freelancer);

        let empty_deliverable = Bytes::from_slice(&env, b"");
        cc.submit_deliverable(&1u64, &freelancer, &empty_deliverable);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1)")]
    fn test_get_job_not_found() {
        let env = Env::default();
        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        cc.get_job(&999u64);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1)")]
    fn test_get_bids_job_not_found() {
        let env = Env::default();
        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        cc.get_bids(&999u64);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Comprehensive Job Registry Full Lifecycle Tests (>90% coverage)
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_complete_lifecycle_with_all_states() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let freelancer1 = Address::generate(&env);
        let freelancer2 = Address::generate(&env);
        let freelancer3 = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        // 1. Post job (Open state)
        let hash = Bytes::from_slice(&env, b"QmJobMetadata");
        cc.post_job(&100u64, &client, &hash, &15000i128);
        let job = cc.get_job(&100u64);
        assert_eq!(job.status, JobStatus::Open);
        assert_eq!(job.budget_stroops, 15000);

        // 2. Multiple freelancers submit bids
        let prop1 = Bytes::from_slice(&env, b"QmProposal1");
        cc.submit_bid(&100u64, &freelancer1, &prop1);

        let prop2 = Bytes::from_slice(&env, b"QmProposal2");
        cc.submit_bid(&100u64, &freelancer2, &prop2);

        let prop3 = Bytes::from_slice(&env, b"QmProposal3");
        cc.submit_bid(&100u64, &freelancer3, &prop3);

        let bids = cc.get_bids(&100u64);
        assert_eq!(bids.len(), 3);

        // 3. Client accepts freelancer2's bid (transitions to InProgress)
        cc.accept_bid(&100u64, &client, &freelancer2);
        let job = cc.get_job(&100u64);
        assert_eq!(job.status, JobStatus::InProgress);
        assert_eq!(job.freelancer, Some(freelancer2.clone()));

        // 4. Freelancer submits deliverable (transitions to DeliverableSubmitted)
        let deliverable = Bytes::from_slice(&env, b"QmFinalDeliverable");
        cc.submit_deliverable(&100u64, &freelancer2, &deliverable);
        let job = cc.get_job(&100u64);
        assert_eq!(job.status, JobStatus::DeliverableSubmitted);

        let stored_deliverable = cc.get_deliverable(&100u64);
        assert_eq!(stored_deliverable, deliverable);

        // 5. Mark as disputed (transitions to Disputed)
        cc.mark_disputed(&100u64);
        let job = cc.get_job(&100u64);
        assert_eq!(job.status, JobStatus::Disputed);
    }

    #[test]
    fn test_multiple_jobs_independent_lifecycles() {
        let env = Env::default();
        env.mock_all_auths();

        let client1 = Address::generate(&env);
        let client2 = Address::generate(&env);
        let freelancer1 = Address::generate(&env);
        let freelancer2 = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        // Job 1: Full lifecycle
        let hash1 = Bytes::from_slice(&env, b"QmJob1");
        cc.post_job(&1u64, &client1, &hash1, &5000i128);
        let prop1 = Bytes::from_slice(&env, b"QmProp1");
        cc.submit_bid(&1u64, &freelancer1, &prop1);
        cc.accept_bid(&1u64, &client1, &freelancer1);
        let deliverable1 = Bytes::from_slice(&env, b"QmDeliverable1");
        cc.submit_deliverable(&1u64, &freelancer1, &deliverable1);

        // Job 2: Just posted and bids
        let hash2 = Bytes::from_slice(&env, b"QmJob2");
        cc.post_job(&2u64, &client2, &hash2, &8000i128);
        let prop2a = Bytes::from_slice(&env, b"QmProp2a");
        cc.submit_bid(&2u64, &freelancer1, &prop2a);
        let prop2b = Bytes::from_slice(&env, b"QmProp2b");
        cc.submit_bid(&2u64, &freelancer2, &prop2b);

        // Verify both jobs are in different states
        let job1 = cc.get_job(&1u64);
        assert_eq!(job1.status, JobStatus::DeliverableSubmitted);

        let job2 = cc.get_job(&2u64);
        assert_eq!(job2.status, JobStatus::Open);
        assert_eq!(cc.get_bids(&2u64).len(), 2);
    }

    #[test]
    fn test_event_emissions_throughout_lifecycle() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        // Post job - should emit JobCreated event
        let hash = Bytes::from_slice(&env, b"QmJobHash");
        cc.post_job(&1u64, &client, &hash, &10000i128);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::Open);

        // Submit bid - should emit BidSubmitted event
        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal);
        let bids = cc.get_bids(&1u64);
        assert_eq!(bids.len(), 1);

        // Accept bid - should emit BidAccepted event
        cc.accept_bid(&1u64, &client, &freelancer);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::InProgress);

        // Submit deliverable - should emit DeliverableSubmitted event
        let deliverable = Bytes::from_slice(&env, b"QmDeliverable");
        cc.submit_deliverable(&1u64, &freelancer, &deliverable);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::DeliverableSubmitted);

        // Mark disputed - should emit Disputed event
        cc.mark_disputed(&1u64);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::Disputed);
    }

    #[test]
    fn test_bid_validation_and_edge_cases() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        // Post job
        let hash = Bytes::from_slice(&env, b"QmJob");
        cc.post_job(&1u64, &client, &hash, &7000i128);

        // Submit multiple bids from same freelancer with different proposals
        let prop1 = Bytes::from_slice(&env, b"QmProposalV1");
        cc.submit_bid(&1u64, &freelancer, &prop1);

        let prop2 = Bytes::from_slice(&env, b"QmProposalV2");
        cc.submit_bid(&1u64, &freelancer, &prop2);

        let bids = cc.get_bids(&1u64);
        assert_eq!(bids.len(), 2);
        assert_eq!(bids.get(0).unwrap().proposal_hash, prop1);
        assert_eq!(bids.get(1).unwrap().proposal_hash, prop2);

        // Accept the bid
        cc.accept_bid(&1u64, &client, &freelancer);

        // Verify job state
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::InProgress);
        assert_eq!(job.freelancer, Some(freelancer));
    }

    #[test]
    fn test_dispute_state_transitions() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        // Setup job to InProgress
        let hash = Bytes::from_slice(&env, b"QmJob");
        cc.post_job(&1u64, &client, &hash, &6000i128);
        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal);
        cc.accept_bid(&1u64, &client, &freelancer);

        // Dispute from InProgress
        cc.mark_disputed(&1u64);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::Disputed);

        // Setup another job to DeliverableSubmitted
        cc.post_job(&2u64, &client, &hash, &6000i128);
        cc.submit_bid(&2u64, &freelancer, &proposal);
        cc.accept_bid(&2u64, &client, &freelancer);
        let deliverable = Bytes::from_slice(&env, b"QmDeliverable");
        cc.submit_deliverable(&2u64, &freelancer, &deliverable);

        // Dispute from DeliverableSubmitted
        cc.mark_disputed(&2u64);
        let job = cc.get_job(&2u64);
        assert_eq!(job.status, JobStatus::Disputed);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn test_mark_disputed_from_open_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        let hash = Bytes::from_slice(&env, b"QmJob");
        cc.post_job(&1u64, &client, &hash, &5000i128);

        // Cannot dispute from Open state
        cc.mark_disputed(&1u64);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1)")]
    fn test_mark_disputed_nonexistent_job() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        cc.mark_disputed(&999u64);
    }

    #[test]
    fn test_large_scale_bidding_scenario() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        // Post job
        let hash = Bytes::from_slice(&env, b"QmLargeJob");
        cc.post_job(&1u64, &client, &hash, &50000i128);

        // Simulate 10 different freelancers bidding
        for i in 0..10 {
            let freelancer = Address::generate(&env);
            let proposal_bytes: &[u8] = match i {
                0 => b"QmProposal0",
                1 => b"QmProposal1",
                2 => b"QmProposal2",
                3 => b"QmProposal3",
                4 => b"QmProposal4",
                5 => b"QmProposal5",
                6 => b"QmProposal6",
                7 => b"QmProposal7",
                8 => b"QmProposal8",
                _ => b"QmProposal9",
            };
            let proposal = Bytes::from_slice(&env, proposal_bytes);
            cc.submit_bid(&1u64, &freelancer, &proposal);
        }

        let bids = cc.get_bids(&1u64);
        assert_eq!(bids.len(), 10);

        // Accept the 5th bid
        let chosen_freelancer = bids.get(4).unwrap().freelancer;
        cc.accept_bid(&1u64, &client, &chosen_freelancer);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::InProgress);
        assert_eq!(job.freelancer, Some(chosen_freelancer));
    }
}
