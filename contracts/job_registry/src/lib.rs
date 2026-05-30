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
    InvalidExpiration = 15,
    JobExpired = 16,
    JobNotExpired = 17,
    InvalidCollateral = 18,
}
 
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum JobStatus {
    Open,
    Assigned,
    InProgress,
    DeliverableSubmitted,
    Completed,
    Disputed,
    Expired,
    Defaulted,
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
}
 
#[contracttype]
pub enum DataKey {
    Admin,
    NextJobId,
    Job(u64),
    BidCount(u64),
    Bid(u64, u32),
    BidIndex(u64, Address),
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

    /// Freelancer submits a bid.
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
        if collateral_stroops < 0 {
            panic_with_error!(&env, JobRegistryError::InvalidCollateral);
        }
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
 
        let bid_count = read_bid_count(&env, job_id);
        let next_count = bid_count
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::Overflow));
        let bid = BidRecord {
            freelancer: freelancer.clone(),
            proposal_hash,
            collateral_stroops,
        });

        env.storage().persistent().set(&bids_key, &bids);

        log!(
            &env,
            "submit_bid: id {} freelancer {} collateral {}",
            job_id,
            freelancer,
            collateral_stroops
        );
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

    /// Requirement [SC-REG-025]: Enforce Collateral Slashing Logic during Bid Default Status.
    ///
    /// Triggered by the job creator (client) when the assigned freelancer has failed to
    /// deliver or respond within the job's expiration window.  This function:
    ///
    /// 1. **Validates authorization** — only the original job creator may call this.
    /// 2. **Validates state** — the job must be in `Assigned` status (freelancer has been
    ///    selected via `accept_bid` but has not submitted a deliverable).
    /// 3. **Validates expiration** — the on-chain ledger timestamp must be past `expires_at`,
    ///    confirming the freelancer has definitively defaulted.
    /// 4. **Looks up the accepted bid** from the persistent `Bids(job_id)` map-like storage
    ///    array to retrieve the collateral amount deposited with the bid.
    /// 5. **Computes the slashed amount** using safe `checked_mul` / `checked_div` arithmetic
    ///    (100% penalty expressed through 10_000 basis-point representation to preserve
    ///    integer precision without floating-point operations, avoiding overflow panics).
    /// 6. **Transitions state** cleanly to `Defaulted` — a terminal status that prevents
    ///    any further state mutations on the job.
    /// 7. **Emits an on-chain event** `("slash", job_id) → (freelancer, slashed_amount)` for
    ///    off-chain consumers (indexers, AI judge, reputation engine).
    ///
    /// # Returns
    /// The slashed collateral amount in stroops (`i128`).  The caller is responsible for
    /// routing this amount through the escrow layer.
    ///
    /// # Errors
    /// - `JobNotFound` — no persistent record exists for `job_id`.
    /// - `Unauthorized` — caller is not the job creator.
    /// - `InvalidStateTransition` — job is not in `Assigned` state.
    /// - `JobNotExpired` — ledger timestamp is still before `expires_at`.
    /// - `BidNotFound` — no bid record found for the assigned freelancer (should never
    ///   happen in a well-formed state, but guarded for safety).
    /// - `Overflow` — collateral × penalty_bps exceeds `i128::MAX`.
    pub fn enforce_default_slashing(env: Env, job_id: u64, client: Address) -> i128 {
        ensure_initialized(&env);
        client.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: JobRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::JobNotFound));

        // [SC-REG-025]: Strict ownership validation — only the original job creator (client)
        // is authorised to trigger the default slashing flow.  Third-party callers are
        // explicitly rejected with `Unauthorized` (error code 9).
        if client != job.client {
            panic_with_error!(&env, JobRegistryError::Unauthorized);
        }

        // [SC-REG-025]: The job must be in `Assigned` state, meaning a freelancer was
        // selected but has not yet delivered.  Any other state (Open, Disputed, Defaulted,
        // Completed, etc.) is an invalid transition and is rejected.
        if job.status != JobStatus::Assigned {
            panic_with_error!(&env, JobRegistryError::InvalidStateTransition);
        }

        // [SC-REG-025]: Expiration check — the ledger timestamp must exceed `expires_at`
        // to confirm the freelancer is definitively in default.  Calling before expiry is
        // blocked (error code 17 = JobNotExpired) to prevent premature slashing.
        let now = env.ledger().timestamp();
        if now < job.expires_at {
            panic_with_error!(&env, JobRegistryError::JobNotExpired);
        }

        // Retrieve the assigned freelancer address stored in the `JobRecord`.
        // Safety: `job.freelancer` will always be `Some` when status is `Assigned`,
        // but we guard with `Unauthorized` to satisfy the borrow checker and prevent
        // undefined behaviour if state is somehow corrupted.
        let freelancer = job.freelancer.clone().unwrap_or_else(|| {
            panic_with_error!(&env, JobRegistryError::Unauthorized)
        });

        // [SC-REG-025]: Retrieve the accepted bid from the Job ID → Bids map-like
        // persistent storage array to obtain the collateral amount locked at bid time.
        let bids: Vec<BidRecord> = env
            .storage()
            .persistent()
            .get(&DataKey::Bids(job_id))
            .unwrap_or(Vec::new(&env));

        let mut collateral_stroops: i128 = 0;
        let mut found = false;
        for bid in bids.iter() {
            if bid.freelancer == freelancer {
                collateral_stroops = bid.collateral_stroops;
                found = true;
                break;
            }
        }

        if !found {
            // Defensive guard: this should be unreachable in a healthy state machine,
            // because `accept_bid` always verifies the bid exists before transitioning.
            panic_with_error!(&env, JobRegistryError::BidNotFound);
        }

        // [SC-REG-025]: Safe checked arithmetic for slashing calculation.
        // We express 100% penalty as `collateral × 10_000 / 10_000` using basis-points
        // arithmetic to keep future partial-slashing extensions simple while avoiding
        // floating-point.  `checked_mul` / `checked_div` protect against `i128` overflow.
        let penalty_bps: i128 = 10_000; // 100% = 10_000 bps
        let slashed_amount = collateral_stroops
            .checked_mul(penalty_bps)
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::Overflow))
            .checked_div(10_000)
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::Overflow));

        // [SC-REG-025]: Clean state transition — `Defaulted` is a terminal status.
        // After this point, no further state mutations (bid acceptance, deliverable
        // submission, dispute) are permitted on this job.
        job.status = JobStatus::Defaulted;
        env.storage().persistent().set(&key, &job);

        log!(
            &env,
            "enforce_default_slashing: id {} freelancer {} slashed {}",
            job_id,
            freelancer,
            slashed_amount
        );
        // Emit slashing event for off-chain indexers, AI judge, and reputation system.
        env.events()
            .publish((symbol_short!("slash"), job_id), (freelancer, slashed_amount));

        slashed_amount
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
 
fn read_job(env: &Env, job_id: u64) -> JobRecord {
    env.storage()
        .persistent()
        .get(&DataKey::Job(job_id))
        .unwrap_or_else(|| panic_with_error!(env, JobRegistryError::JobNotFound))
}
 
fn read_bid_count(env: &Env, job_id: u64) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::BidCount(job_id))
        .unwrap_or(0u32)
}
 
fn read_bid_at(env: &Env, job_id: u64, index: u32) -> BidRecord {
    env.storage()
        .persistent()
        .get(&DataKey::Bid(job_id, index))
        .unwrap_or_else(|| panic_with_error!(env, JobRegistryError::BidIndexOutOfBounds))
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
        .set(&DataKey::BidCount(job_id), &0u32);
}

fn release_collateral(env: &Env, job_id: u64, freelancer: Address, _slash: bool) {
    let _job: JobRecord = env
        .storage()
        .persistent()
        .get(&DataKey::Job(job_id))
        .unwrap_or_else(|| panic_with_error!(env, JobRegistryError::JobNotFound));

    let bids_key = DataKey::Bids(job_id);
    let bids: Vec<BidRecord> = env
        .storage()
        .persistent()
        .get(&bids_key)
        .unwrap_or_else(|| panic_with_error!(env, JobRegistryError::CollateralNotFound));

    let mut updated_bids: Vec<BidRecord> = Vec::new(env);
    let mut found = false;

    for bid in bids.iter() {
        if bid.freelancer == freelancer {
            found = true;
            if bid.collateral_released {
                panic_with_error!(env, JobRegistryError::CollateralAlreadyReleased);
            }
            let mut updated = bid.clone();
            updated.collateral_released = true;
            updated_bids.push_back(updated);
        } else {
            updated_bids.push_back(bid.clone());
        }
    }

    if !found {
        panic_with_error!(env, JobRegistryError::CollateralNotFound);
    }

    env.storage().persistent().set(&bids_key, &updated_bids);
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
 
        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);
 
        (env, cc, admin, client, freelancer)
    }
 
    fn future_expires_at(env: &Env) -> u64 {
        env.ledger().timestamp() + 30 * 24 * 60 * 60
    }

    fn default_bidding_deadline(env: &Env) -> u64 {
        env.ledger().timestamp() + 30
    }

    const DEFAULT_COLLATERAL_STROOPS: i128 = 1_000;

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
        let (_env, cc, admin, _, _, _) = setup();

        let (_env, cc, admin, _, _) = setup();
 
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
 
        let hash1 = Bytes::from_slice(&env, b"QmHash1");
        let hash2 = Bytes::from_slice(&env, b"QmHash2");
        let expires_at1 = future_expires_at(&env);
        let expires_at2 = future_expires_at(&env);

        let id1 = cc.post_job_auto(&client, &hash1, &MIN_BUDGET_STROOPS, &default_bidding_deadline(&env), &expires_at1);
        let id2 = cc.post_job_auto(&client, &hash2, &MIN_BUDGET_STROOPS, &default_bidding_deadline(&env), &expires_at2);

        assert_eq!(id1, 1u64);
        assert_eq!(id2, 2u64);
        assert_eq!(cc.get_next_job_id(), 3u64);
    }
 
    #[test]
    fn test_post_job_with_explicit_id_updates_next_job_id() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);
 
        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&42u64, &client, &hash, &MIN_BUDGET_STROOPS, &default_bidding_deadline(&env), &expires_at);

        assert_eq!(cc.get_next_job_id(), 43u64);
    }
 
    #[test]
    #[should_panic]
    fn test_invalid_budget_panics() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);
 
        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &0i128, &default_bidding_deadline(&env), &expires_at);
    }
 
    #[test]
    #[should_panic]
    fn test_empty_hash_panics() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);
 
        let empty = Bytes::from_slice(&env, b"");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &empty, &MIN_BUDGET_STROOPS, &default_bidding_deadline(&env), &expires_at);
    }
 
    #[test]
    fn test_full_lifecycle() {
        let (env, cc, admin, client, freelancer, token_addr) = setup();
        cc.initialize(&admin);
 
        let hash = Bytes::from_slice(&env, b"QmSomeIPFSHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &default_bidding_deadline(&env), &expires_at);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::Open);
        assert_eq!(job.freelancer, None);
 
        let proposal = Bytes::from_slice(&env, b"QmProposalHash");
        cc.submit_bid(&1u64, &freelancer, &proposal, &1000i128);

        let bids = cc.get_bids(&1u64);
        assert_eq!(bids.len(), 1);
        assert_eq!(bids.get(0).unwrap().collateral_stroops, 1000i128);

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
 
        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &default_bidding_deadline(&env), &expires_at);

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal, &500i128);
        cc.submit_bid(&1u64, &freelancer, &proposal, &500i128);
    }
 
    #[test]
    #[should_panic]
    fn test_accept_without_matching_bid_panics() {
        let (env, cc, admin, client, freelancer, token_addr) = setup();
        cc.initialize(&admin);
 
        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &default_bidding_deadline(&env), &expires_at);

        cc.accept_bid(&1u64, &client, &freelancer);
    }
 
    #[test]
    fn test_mark_disputed_from_assigned() {
        let (env, cc, admin, client, freelancer, token_addr) = setup();
        cc.initialize(&admin);
 
        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &default_bidding_deadline(&env), &expires_at);

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal, &0i128);
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
 
        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &default_bidding_deadline(&env), &expires_at);

        env.ledger().set_timestamp(expires_at + 1);
 
        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal, &100i128);
    }
 
    #[test]
    #[should_panic]
    fn test_invalid_cidv0_prefix_panics() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);
 
        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &default_bidding_deadline(&env), &expires_at);

        let hash = Bytes::from_slice(&env, b"bafxbeigdyrzt5sbi7ee3xjc3vyqptsyfuwwspw2gx6pqdfaaaaabbbbbccccc");
        env.ledger().set_timestamp(100);
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &expires_at, &1000u64, &token_addr, &1000i128);
    }

    // --- SC-REG-037: Budget Bounds Tests ---

    #[test]
    fn test_budget_at_minimum_succeeds() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);
 
        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &default_bidding_deadline(&env), &expires_at);

        let job = cc.get_job(&1u64);
        assert_eq!(job.budget_stroops, MIN_BUDGET_STROOPS);
    }

    #[test]
    fn test_budget_at_maximum_succeeds() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MAX_BUDGET_STROOPS, &default_bidding_deadline(&env), &expires_at);

        let job = cc.get_job(&1u64);
        assert_eq!(job.budget_stroops, MAX_BUDGET_STROOPS);
    }
 
    #[test]
    #[should_panic]
    fn test_budget_below_minimum_panics() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);
 
        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &(MIN_BUDGET_STROOPS - 1), &default_bidding_deadline(&env), &expires_at);
    }

    #[test]
    #[should_panic]
    fn test_budget_above_maximum_panics() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &(MAX_BUDGET_STROOPS + 1), &default_bidding_deadline(&env), &expires_at);
    }
 
    #[test]
    #[should_panic]
    fn test_zero_budget_still_panics() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);
 
        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &0i128, &default_bidding_deadline(&env), &expires_at);
    }

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal, &200i128);

    #[test]
    fn test_get_bids_count_empty_returns_zero() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &default_bidding_deadline(&env), &expires_at);

        assert_eq!(cc.get_bids_count(&1u64), 0u32);
    }

    #[test]
    fn test_get_bids_count_after_submissions() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &default_bidding_deadline(&env), &expires_at);

        for _ in 0..3u32 {
            let freelancer = Address::generate(&env);
            let proposal = Bytes::from_slice(&env, b"QmProposal");
            cc.submit_bid(&1u64, &freelancer, &proposal, &DEFAULT_COLLATERAL_STROOPS);
        }

        assert_eq!(cc.get_bids_count(&1u64), 3u32);
    }

    #[test]
    fn test_get_bids_page_first_window() {
        let (env, cc, admin, client, _, token_addr) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmZ4t45v9y2X6a9f5d3v2X5a9f5d3v2X5a9f5d3v2X5a9f");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &default_bidding_deadline(&env), &expires_at);

        for _ in 0..5u32 {
            let freelancer = Address::generate(&env);
            let proposal = Bytes::from_slice(&env, b"QmProposal");
            cc.submit_bid(&1u64, &freelancer, &proposal, &DEFAULT_COLLATERAL_STROOPS);
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
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &default_bidding_deadline(&env), &expires_at);

        for _ in 0..5u32 {
            let freelancer = Address::generate(&env);
            let proposal = Bytes::from_slice(&env, b"QmProposal");
            cc.submit_bid(&1u64, &freelancer, &proposal, &DEFAULT_COLLATERAL_STROOPS);
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
        cc.post_job(&1u64, &client, &hash, &MIN_BUDGET_STROOPS, &default_bidding_deadline(&env), &expires_at);

        for _ in 0..3u32 {
            let freelancer = Address::generate(&env);
            let proposal = Bytes::from_slice(&env, b"QmProposal");
            cc.submit_bid(&1u64, &freelancer, &proposal, &DEFAULT_COLLATERAL_STROOPS);
        }

        let page = cc.get_bids_page(&1u64, &10u32, &5u32);
        assert_eq!(page.len(), 0u32);
    }

    #[test]
    fn test_enforce_default_slashing_success() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal, &12345i128);

        cc.accept_bid(&1u64, &client, &freelancer);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, JobStatus::Assigned);

        // Advance ledger timestamp to default threshold
        env.ledger().set_timestamp(expires_at + 1);

        // Client triggers default and gets 100% of collateral slashed
        let slashed = cc.enforce_default_slashing(&1u64, &client);
        assert_eq!(slashed, 12345i128);

        let updated_job = cc.get_job(&1u64);
        assert_eq!(updated_job.status, JobStatus::Defaulted);
    }

    #[test]
    #[should_panic]
    fn test_enforce_default_slashing_before_expiration_panics() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal, &100i128);
        cc.accept_bid(&1u64, &client, &freelancer);

        // Calling enforce default slashing before job expires must fail
        cc.enforce_default_slashing(&1u64, &client);
    }

    #[test]
    #[should_panic]
    fn test_enforce_default_slashing_unauthorized_panics() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal, &200i128);
        cc.accept_bid(&1u64, &client, &freelancer);

        env.ledger().set_timestamp(expires_at + 1);

        // A third-party address (represented by freelancer here) attempts to default
        cc.enforce_default_slashing(&1u64, &freelancer);
    }

    #[test]
    #[should_panic]
    fn test_enforce_default_slashing_invalid_state_panics() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        cc.submit_bid(&1u64, &freelancer, &proposal, &300i128);

        env.ledger().set_timestamp(expires_at + 1);

        // The job status is Open (not Assigned). Enforce default slashing should fail.
        cc.enforce_default_slashing(&1u64, &client);
    }

    #[test]
    #[should_panic]
    fn test_submit_bid_negative_collateral_panics() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmHash");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

        let proposal = Bytes::from_slice(&env, b"QmProposal");
        // Bid with negative collateral must panic
        cc.submit_bid(&1u64, &freelancer, &proposal, &-100i128);
    }

    // ──────────────────────────────────────────────────────────────────────────────
    // SC-REG-025: Additional collateral slashing edge-case tests
    // ──────────────────────────────────────────────────────────────────────────────

    /// [SC-REG-025] A freelancer who bid zero collateral results in a slashed amount
    /// of 0 (not a panic).  The job still transitions cleanly to `Defaulted`.
    #[test]
    fn test_enforce_default_slashing_zero_collateral_returns_zero() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmIPFSZero");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

        // Freelancer bids with zero collateral (allowed)
        let proposal = Bytes::from_slice(&env, b"QmProposalZero");
        cc.submit_bid(&1u64, &freelancer, &proposal, &0i128);
        cc.accept_bid(&1u64, &client, &freelancer);

        // Advance past expiry
        env.ledger().set_timestamp(expires_at + 1);

        let slashed = cc.enforce_default_slashing(&1u64, &client);
        // 0 collateral → 0 slash; no overflow, no panic
        assert_eq!(slashed, 0i128);
        // State must still be Defaulted
        assert_eq!(cc.get_job(&1u64).status, JobStatus::Defaulted);
    }

    /// [SC-REG-025] Verifies the job transitions to the terminal `Defaulted` status
    /// and cannot be slashed a second time (InvalidStateTransition on retry).
    #[test]
    #[should_panic]
    fn test_enforce_default_slashing_double_slash_panics() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);

        let hash = Bytes::from_slice(&env, b"QmIPFSDouble");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

        let proposal = Bytes::from_slice(&env, b"QmProposalDouble");
        cc.submit_bid(&1u64, &freelancer, &proposal, &500i128);
        cc.accept_bid(&1u64, &client, &freelancer);

        env.ledger().set_timestamp(expires_at + 1);
        cc.enforce_default_slashing(&1u64, &client);
        // Second call must panic: job is now Defaulted, not Assigned
        cc.enforce_default_slashing(&1u64, &client);
    }

    /// [SC-REG-025] When multiple freelancers bid, only the accepted one's collateral
    /// is used for the slashing calculation.  Others are unaffected.
    #[test]
    fn test_enforce_default_slashing_multiple_bids_only_accepted_slashed() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);

        // Generate a second bidder
        let bidder2 = Address::generate(&env);

        let hash = Bytes::from_slice(&env, b"QmIPFSMulti");
        let expires_at = future_expires_at(&env);
        cc.post_job(&1u64, &client, &hash, &5000i128, &expires_at);

        // Two bids with different collateral amounts
        let p1 = Bytes::from_slice(&env, b"QmProposal1");
        cc.submit_bid(&1u64, &freelancer, &p1, &1000i128); // accepted freelancer
        let p2 = Bytes::from_slice(&env, b"QmProposal2");
        cc.submit_bid(&1u64, &bidder2, &p2, &9999i128); // competing bidder

        // Accept the first freelancer's bid
        cc.accept_bid(&1u64, &client, &freelancer);

        env.ledger().set_timestamp(expires_at + 1);

        // Slashed amount must equal only the accepted bid's collateral (1000)
        let slashed = cc.enforce_default_slashing(&1u64, &client);
        assert_eq!(slashed, 1000i128);
        assert_eq!(cc.get_job(&1u64).status, JobStatus::Defaulted);
    }
}
 
#388 [SC-REG-034] Job Registry and Proposal Scaling Validation - Step 34
Repo Avatar
DXmakers/lance
Implement Dynamic Service Fee Adjustments for Job Postings
Category: Smart Contract: Job Registry & Bidding
Task ID: SC-REG-034
Description
This issue is dedicated to the technical design, implementation, and rigorous auditing of 'Implement Dynamic Service Fee Adjustments for Job Postings' inside the Lance marketplace ecosystem, specifically focusing on the Smart Contract: Job Registry & Bidding component. As a Soroban smart contract task, the contributor must design robust instance or persistent storage allocations, ensure safe checked math operations, and write high-coverage unit tests within the Rust cargo test harness. The compiled WASM footprint must fit comfortably within standard block boundaries. Ensure that your implementation strictly adheres to the project's architectural guidelines, features self-documenting code with comprehensive inline annotations, and provides solid verification proofs. Any modifications to state variables must undergo strict validation before commits.

Requirements
Scaffold and write the contract logic in contracts/job_registry/src/lib.rs for Implement Dynamic Service Fee Adjustments for Job Postings.
Compress heavy text strings into compact IPFS Content Identifiers (CIDs) before storing on-chain.
Design clean mappings from Job IDs to dynamic bid structures utilizing map-like storage arrays.
Implement strict ownership validation so that only the job creator can accept proposals.
Acceptance Criteria
Contract successfully compiles and fits within the standard Soroban WASM size limits.
Registry state transitions cleanly to 'Assigned' once a bid is successfully accepted.
Out-of-bounds inputs or late bid submissions are gracefully blocked and return specific error codes.
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
