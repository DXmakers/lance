#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Vec, Bytes};

/* -----------------------------------------------------------------
    1. State Configurations & Schema Definitions
----------------------------------------------------------------- */

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JobStatus {
    AwaitingFunding,
    Assigned,
    Completed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    JobConfig(u64),       // Maps Job ID to JobConfig parameters
    JobBids(u64),         // Maps Job ID to a Vector of submitted Bids
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobConfig {
    pub creator: Address,
    pub ipfs_cid: Bytes,
    pub budget: i128,
    pub status: JobStatus,
    pub freelancer: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Bid {
    pub bidder: Address,
    pub amount: i128,
    pub timestamp: u64,
}

/* -----------------------------------------------------------------
    2. Explicit Event Schemas for Indexer Optimization
----------------------------------------------------------------- */

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobCreatedIndexEvent {
    pub job_id: u64,
    pub creator: Address,
    pub ipfs_cid: Bytes,
    pub budget: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobAssignedIndexEvent {
    pub job_id: u64,
    pub freelancer: Address,
    pub final_amount: i128,
}

/* -----------------------------------------------------------------
    3. Smart Contract Implementation
----------------------------------------------------------------- */

#[contract]
pub struct LanceJobRegistryContract;

#[contractimpl]
impl LanceJobRegistryContract {

    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Registry already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Post a new job posting entry using a compact IPFS CID to avoid excessive gas fees.
    pub fn post_job(env: Env, job_id: u64, creator: Address, ipfs_cid: Bytes, budget: i128) {
        creator.require_auth();

        if budget <= 0 {
            panic!("Budget parameters must be positive value");
        }
        // Enforce basic IPFS hash length sanity boundary checking (e.g., standard v0/v1 length checks)
        if ipfs_cid.len() < 32 {
            panic!("Invalid IPFS Content Identifier bounds");
        }

        let job_key = DataKey::JobConfig(job_id);
        if env.storage().persistent().has(&job_key) {
            panic!("Job ID identifier collision detected");
        }

        let config = JobConfig {
            creator: creator.clone(),
            ipfs_cid: ipfs_cid.clone(),
            budget,
            status: JobStatus::AwaitingFunding,
            freelancer: None,
        };

        env.storage().persistent().set(&job_key, &config);
        
        // Initialize an empty map-like storage array for tracking proposals cleanly
        let bids_key = DataKey::JobBids(job_id);
        let empty_bids: Vec<Bid> = Vec::new(&env);
        env.storage().persistent().set(&bids_key, &empty_bids);

        // Emit targeted structural event optimized for high-concurrency DB sync
        env.events().publish(
            (Symbol::new(&env, "job_posted"), job_id),
            JobCreatedIndexEvent { job_id, creator, ipfs_cid, budget },
        );
    }

    /// Places a bid securely mapped to a specific job ID configuration entry.
    pub fn place_bid(env: Env, job_id: u64, bidder: Address, amount: i128) {
        bidder.require_auth();

        let job_key = DataKey::JobConfig(job_id);
        let job: JobConfig = env.storage().persistent().get(&job_key).expect("Target job registry context not found");

        // Out-of-bounds inputs or late bid submissions are gracefully blocked
        if job.status != JobStatus::AwaitingFunding {
            panic!("Late submission error: Job no longer accepting active proposals");
        }
        if amount <= 0 {
            panic!("Bid valuation parameters must be a valid positive amount");
        }

        let bids_key = DataKey::JobBids(job_id);
        let mut bids: Vec<Bid> = env.storage().persistent().get(&bids_key).unwrap_or(Vec::new(&env));

        let new_bid = Bid {
            bidder: bidder.clone(),
            amount,
            timestamp: env.ledger().timestamp(),
        };
        bids.push_back(new_bid);
        env.storage().persistent().set(&bids_key, &bids);

        env.events().publish(
            (Symbol::new(&env, "bid_placed"), job_id),
            BidPlacedIndexEvent { job_id, bidder, amount },
        );
    }

    /// Accepts a proposal. Strictly enforces ownership boundaries.
    pub fn accept_bid(env: Env, job_id: u64, bid_index: u32) {
        let job_key = DataKey::JobConfig(job_id);
        let mut job: JobConfig = env.storage().persistent().get(&job_key).expect("Job context not found");

        // Implement strict ownership validation so that only the job creator can accept proposals
        job.creator.require_auth();

        if job.status != JobStatus::AwaitingFunding {
            panic!("Job state already locked or assigned");
        }

        let bids_key = DataKey::JobBids(job_id);
        let bids: Vec<Bid> = env.storage().persistent().get(&bids_key).expect("Bids store missing");

        // Boundary safety validation check against vector indexing targets
        if bid_index >= bids.len() {
            panic!("Out-of-bounds input error: Selected bid index does not exist");
        }

        let chosen_bid = bids.get(bid_index).unwrap();

        // Transition the registry state machine layout to Assigned
        job.status = JobStatus::Assigned;
        job.freelancer = Some(chosen_bid.bidder.clone());

        env.storage().persistent().set(&job_key, &job);

        // Emit indexer-optimized structural confirmation event payload
        env.events().publish(
            (Symbol::new(&env, "job_assigned"), job_id),
            JobAssignedIndexEvent {
                job_id,
                freelancer: chosen_bid.bidder,
                final_amount: chosen_bid.amount,
            },
        );
    }

    /// Admin or Creator capability to mark a finalized job as completed.
    pub fn complete_job(env: Env, job_id: u64) {
        let job_key = DataKey::JobConfig(job_id);
        let mut job: JobConfig = env.storage().persistent().get(&job_key).expect("Job context not found");
        
        job.creator.require_auth();

        if job.status != JobStatus::Assigned {
            panic!("Only active assigned jobs can be closed or completed");
        }

        job.status = JobStatus::Completed;
        env.storage().persistent().set(&job_key, &job);
    }

    /// Explicit Storage Reclamation System.
    /// Permanently expunges closed/completed postings to free storage keys and reclaim rent allocations.
    pub fn reclaim_job_storage(env: Env, job_id: u64, reclaimer: Address) {
        reclaimer.require_auth();

        let job_key = DataKey::JobConfig(job_id);
        let job: JobConfig = env.storage().persistent().get(&job_key).expect("Job context not found");

        // Safety enforcement verification boundaries
        if job.status != JobStatus::Completed {
            panic!("Storage optimization block: Only completed jobs can have their footprints reclaimed");
        }
        if reclaimer != job.creator {
            panic!("Unauthorized: Only the initial job creator can invoke storage reclamation");
        }

        let bids_key = DataKey::JobBids(job_id);

        // Safely purge persistent keys completely from storage ledger allocation tables
        env.storage().persistent().remove(&job_key);
        env.storage().persistent().remove(&bids_key);

        // Emit indexer synchronization notification event
        env.events().publish(
            (Symbol::new(&env, "job_storage_reclaimed"), job_id),
            JobStorageReclaimedEvent { job_id, reclaimer },
        );
    }

    /* -----------------------------------------------------------------
        Public Indexer-Ready Getter Mappings
    ----------------------------------------------------------------- */

    pub fn get_job(env: Env, job_id: u64) -> Option<JobConfig> {
        env.storage().persistent().get(&DataKey::JobConfig(job_id))
    }

    pub fn get_bids(env: Env, job_id: u64) -> Vec<Bid> {
        env.storage().persistent().get(&DataKey::JobBids(job_id)).unwrap_or(Vec::new(&env))
    }
}
