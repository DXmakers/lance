#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, log, panic_with_error, symbol_short,
    Address, Bytes, Env, Vec,
};

/// Compact content-addressed metadata/proposals only. IPFS CIDv0/v1 strings are
/// comfortably below this cap, while full briefs and proposals must stay off-chain.
const MAX_CID_LEN: u32 = 96;
const MIN_BUDGET_STROOPS: i128 = 100_000; // 0.01 XLM
const MAX_BUDGET_STROOPS: i128 = 100_000_000_000_000; // 10,000,000 XLM
const BASIS_POINTS_DENOMINATOR: i128 = 10_000;
const MAX_CONFIGURABLE_FEE_BPS: u32 = 2_500; // 25%, safely below confiscatory fees.
const MAX_BIDS_PER_JOB: u32 = 1_000;

const DEFAULT_BASE_FEE_BPS: u32 = 250;
const DEFAULT_BUDGET_STEP_STROOPS: i128 = 10_000_000_000; // 1,000 XLM
const DEFAULT_STEP_FEE_BPS: u32 = 10;
const DEFAULT_MAX_FEE_BPS: u32 = 750;
const DEFAULT_HIGH_VALUE_THRESHOLD_STROOPS: i128 = 250_000_000_000; // 25,000 XLM
const DEFAULT_HIGH_VALUE_DISCOUNT_BPS: u32 = 75;

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum JobRegistryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidJobId = 3,
    InvalidBudget = 4,
    InvalidCid = 5,
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
    InvalidFeeConfig = 21,
    BidLimitReached = 22,
    BidIndexOutOfBounds = 23,
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
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FeeConfig {
    pub base_fee_bps: u32,
    pub budget_step_stroops: i128,
    pub step_fee_bps: u32,
    pub max_fee_bps: u32,
    pub high_value_threshold_stroops: i128,
    pub high_value_discount_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FeeQuote {
    pub fee_bps: u32,
    pub fee_stroops: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct JobRecord {
    pub client: Address,
    pub freelancer: Option<Address>,
    pub metadata_cid: Bytes,
    pub budget_stroops: i128,
    pub service_fee_bps: u32,
    pub service_fee_stroops: i128,
    pub expires_at: u64,
    pub status: JobStatus,
    pub bidding_deadline: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BidRecord {
    pub freelancer: Address,
    pub proposal_cid: Bytes,
    pub collateral_stroops: i128,
    pub collateral_released: bool,
}

#[contracttype]
pub enum DataKey {
    Admin,
    NextJobId,
    FeeConfig,
    EscrowDeployer,
    Job(u64),
    BidCount(u64),
    BidByIndex(u64, u32),
    BidLookup(u64, Address),
    Deliverable(u64),
}

#[contract]
pub struct JobRegistryContract;

#[contractimpl]
impl JobRegistryContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, JobRegistryError::AlreadyInitialized);
        }

        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NextJobId, &1u64);
        env.storage()
            .instance()
            .set(&DataKey::FeeConfig, &default_fee_config());
        log!(&env, "job registry initialized");
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

    pub fn get_fee_config(env: Env) -> FeeConfig {
        ensure_initialized(&env);
        read_fee_config(&env)
    }

    pub fn set_fee_config(env: Env, config: FeeConfig) {
        ensure_initialized(&env);
        let admin = read_admin(&env);
        admin.require_auth();
        validate_fee_config(&env, &config);
        env.storage().instance().set(&DataKey::FeeConfig, &config);
        env.events()
            .publish((symbol_short!("feecfg"),), config.max_fee_bps);
    }

    pub fn quote_service_fee(env: Env, budget_stroops: i128) -> FeeQuote {
        ensure_initialized(&env);
        validate_budget(&env, budget_stroops);
        compute_service_fee(&env, budget_stroops, &read_fee_config(&env))
    }

    pub fn post_job(
        env: Env,
        job_id: u64,
        client: Address,
        metadata_cid: Bytes,
        budget_stroops: i128,
        bidding_deadline: u64,
        expires_at: u64,
    ) {
        ensure_initialized(&env);
        validate_job_input(
            &env,
            job_id,
            &metadata_cid,
            budget_stroops,
            bidding_deadline,
            expires_at,
        );
        client.require_auth();

        post_job_with_id(
            &env,
            job_id,
            client.clone(),
            metadata_cid,
            budget_stroops,
            bidding_deadline,
            expires_at,
        );

        let next_job_id = read_next_job_id(&env);
        if job_id >= next_job_id {
            let updated = job_id
                .checked_add(1)
                .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::Overflow));
            env.storage().instance().set(&DataKey::NextJobId, &updated);
        }

        env.events()
            .publish((symbol_short!("jobpost"), job_id), client);
    }

    pub fn post_job_auto(
        env: Env,
        client: Address,
        metadata_cid: Bytes,
        budget_stroops: i128,
        bidding_deadline: u64,
        expires_at: u64,
    ) -> u64 {
        ensure_initialized(&env);
        let job_id = read_next_job_id(&env);
        validate_job_input(
            &env,
            job_id,
            &metadata_cid,
            budget_stroops,
            bidding_deadline,
            expires_at,
        );
        client.require_auth();

        post_job_with_id(
            &env,
            job_id,
            client.clone(),
            metadata_cid,
            budget_stroops,
            bidding_deadline,
            expires_at,
        );

        let next = job_id
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::Overflow));
        env.storage().instance().set(&DataKey::NextJobId, &next);
        env.events()
            .publish((symbol_short!("jobauto"), job_id), (client, budget_stroops));
        job_id
    }

    /// Admin configures the off-chain/cross-contract escrow deployer address signaled on acceptance.
    pub fn set_escrow_deployer(env: Env, escrow_deployer: Address) {
        ensure_initialized(&env);
        let admin = read_admin(&env);
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::EscrowDeployer, &escrow_deployer);
        env.events()
            .publish((symbol_short!("escrow"),), escrow_deployer);
    }

    pub fn get_escrow_deployer(env: Env) -> Option<Address> {
        ensure_initialized(&env);
        env.storage().instance().get(&DataKey::EscrowDeployer)
    }

    pub fn submit_bid(
        env: Env,
        job_id: u64,
        freelancer: Address,
        proposal_cid: Bytes,
        collateral_stroops: i128,
    ) {
        ensure_initialized(&env);
        validate_cid(&env, &proposal_cid);
        freelancer.require_auth();

        let job = read_job(&env, job_id);
        if job.status != JobStatus::Open {
            panic_with_error!(&env, JobRegistryError::JobNotOpen);
        }
        if env.ledger().timestamp() > job.bidding_deadline {
            panic_with_error!(&env, JobRegistryError::BidWindowClosed);
        }
        if env.ledger().timestamp() >= job.expires_at {
            panic_with_error!(&env, JobRegistryError::JobExpired);
        }
        if collateral_stroops < 0 {
            panic_with_error!(&env, JobRegistryError::InvalidBudget);
        }

        let lookup_key = DataKey::BidLookup(job_id, freelancer.clone());
        if env.storage().persistent().has(&lookup_key) {
            panic_with_error!(&env, JobRegistryError::BidAlreadySubmitted);
        }

        let bid_count = read_bid_count(&env, job_id);
        if bid_count >= MAX_BIDS_PER_JOB {
            panic_with_error!(&env, JobRegistryError::BidLimitReached);
        }
        let next_count = bid_count
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::Overflow));

        let bid = BidRecord {
            freelancer: freelancer.clone(),
            proposal_cid,
            collateral_stroops,
            collateral_released: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::BidByIndex(job_id, bid_count), &bid);
        env.storage().persistent().set(&lookup_key, &bid_count);
        env.storage()
            .persistent()
            .set(&DataKey::BidCount(job_id), &next_count);
        env.events()
            .publish((symbol_short!("bid"), job_id), freelancer);
    }

    pub fn accept_bid(env: Env, job_id: u64, client: Address, freelancer: Address) {
        ensure_initialized(&env);
        client.require_auth();

        let key = DataKey::Job(job_id);
        let mut job = read_job(&env, job_id);
        if job.status != JobStatus::Open {
            panic_with_error!(&env, JobRegistryError::JobNotOpen);
        }
        if client != job.client {
            panic_with_error!(&env, JobRegistryError::Unauthorized);
        }
        if env.ledger().timestamp() >= job.expires_at {
            panic_with_error!(&env, JobRegistryError::JobExpired);
        }

        let lookup_key = DataKey::BidLookup(job_id, freelancer.clone());
        if !env.storage().persistent().has(&lookup_key) {
            panic_with_error!(&env, JobRegistryError::BidNotFound);
        }

        // All authorization, state, expiry, and bid-existence invariants are
        // validated before the only state mutation, yielding an auditable atomic
        // transition from Open to Assigned.
        job.freelancer = Some(freelancer.clone());
        job.status = JobStatus::Assigned;
        env.storage().persistent().set(&key, &job);
        env.events()
            .publish((symbol_short!("accept"), job_id), freelancer.clone());

        if let Some(escrow_deployer) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::EscrowDeployer)
        {
            env.events().publish(
                (symbol_short!("assign"), job_id),
                (client, freelancer, escrow_deployer),
            );
        }
    }

    pub fn refund_bid_collateral(env: Env, job_id: u64, freelancer: Address) {
        ensure_initialized(&env);
        freelancer.require_auth();
        release_collateral(&env, job_id, freelancer);
    }

    pub fn slash_bid_collateral(env: Env, job_id: u64, client: Address, freelancer: Address) {
        ensure_initialized(&env);
        client.require_auth();
        let job = read_job(&env, job_id);
        if client != job.client {
            panic_with_error!(&env, JobRegistryError::Unauthorized);
        }
        release_collateral(&env, job_id, freelancer);
    }

    pub fn cancel_expired_job(env: Env, job_id: u64, client: Address) {
        ensure_initialized(&env);
        client.require_auth();

        let key = DataKey::Job(job_id);
        let mut job = read_job(&env, job_id);
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
        env.storage().persistent().set(&key, &job);
        env.events()
            .publish((symbol_short!("expired"), job_id), client);
    }

    pub fn submit_deliverable(env: Env, job_id: u64, freelancer: Address, deliverable_cid: Bytes) {
        ensure_initialized(&env);
        validate_cid(&env, &deliverable_cid);
        freelancer.require_auth();

        let key = DataKey::Job(job_id);
        let mut job = read_job(&env, job_id);
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
            .set(&DataKey::Deliverable(job_id), &deliverable_cid);
        env.events()
            .publish((symbol_short!("deliver"), job_id), freelancer);
    }

    pub fn mark_disputed(env: Env, job_id: u64) {
        ensure_initialized(&env);
        let admin = read_admin(&env);
        admin.require_auth();

        let key = DataKey::Job(job_id);
        let mut job = read_job(&env, job_id);
        if job.status != JobStatus::Assigned && job.status != JobStatus::DeliverableSubmitted {
            panic_with_error!(&env, JobRegistryError::InvalidStateTransition);
        }
        job.status = JobStatus::Disputed;
        env.storage().persistent().set(&key, &job);
    }

    pub fn get_job(env: Env, job_id: u64) -> JobRecord {
        ensure_initialized(&env);
        read_job(&env, job_id)
    }

    pub fn get_bid_at(env: Env, job_id: u64, index: u32) -> BidRecord {
        ensure_initialized(&env);
        let count = read_bid_count(&env, job_id);
        if index >= count {
            panic_with_error!(&env, JobRegistryError::BidIndexOutOfBounds);
        }
        read_bid_at(&env, job_id, index)
    }

    pub fn get_bids(env: Env, job_id: u64) -> Vec<BidRecord> {
        ensure_initialized(&env);
        let count = read_bid_count(&env, job_id);
        let mut bids = Vec::new(&env);
        let mut index = 0u32;
        while index < count {
            bids.push_back(read_bid_at(&env, job_id, index));
            index = index
                .checked_add(1)
                .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::Overflow));
        }
        bids
    }

    pub fn get_bids_page(env: Env, job_id: u64, offset: u32, limit: u32) -> Vec<BidRecord> {
        ensure_initialized(&env);
        let count = read_bid_count(&env, job_id);
        let mut page = Vec::new(&env);
        if offset >= count || limit == 0 {
            return page;
        }

        let requested_end = offset
            .checked_add(limit)
            .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::Overflow));
        let end = requested_end.min(count);
        let mut index = offset;
        while index < end {
            page.push_back(read_bid_at(&env, job_id, index));
            index = index
                .checked_add(1)
                .unwrap_or_else(|| panic_with_error!(&env, JobRegistryError::Overflow));
        }
        page
    }

    pub fn get_bids_count(env: Env, job_id: u64) -> u32 {
        ensure_initialized(&env);
        read_bid_count(&env, job_id)
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

fn read_fee_config(env: &Env) -> FeeConfig {
    env.storage()
        .instance()
        .get(&DataKey::FeeConfig)
        .unwrap_or(default_fee_config())
}

fn default_fee_config() -> FeeConfig {
    FeeConfig {
        base_fee_bps: DEFAULT_BASE_FEE_BPS,
        budget_step_stroops: DEFAULT_BUDGET_STEP_STROOPS,
        step_fee_bps: DEFAULT_STEP_FEE_BPS,
        max_fee_bps: DEFAULT_MAX_FEE_BPS,
        high_value_threshold_stroops: DEFAULT_HIGH_VALUE_THRESHOLD_STROOPS,
        high_value_discount_bps: DEFAULT_HIGH_VALUE_DISCOUNT_BPS,
    }
}

fn validate_job_input(
    env: &Env,
    job_id: u64,
    metadata_cid: &Bytes,
    budget_stroops: i128,
    bidding_deadline: u64,
    expires_at: u64,
) {
    if job_id == 0 {
        panic_with_error!(env, JobRegistryError::InvalidJobId);
    }
    validate_budget(env, budget_stroops);
    validate_cid(env, metadata_cid);
    if bidding_deadline <= env.ledger().timestamp() {
        panic_with_error!(env, JobRegistryError::BidWindowClosed);
    }
    if bidding_deadline >= expires_at {
        panic_with_error!(env, JobRegistryError::InvalidExpiration);
    }
    validate_expiration(env, expires_at);
}

fn validate_budget(env: &Env, budget_stroops: i128) {
    if !(MIN_BUDGET_STROOPS..=MAX_BUDGET_STROOPS).contains(&budget_stroops) {
        panic_with_error!(env, JobRegistryError::InvalidBudget);
    }
}

fn validate_expiration(env: &Env, expires_at: u64) {
    if expires_at == 0 || expires_at <= env.ledger().timestamp() {
        panic_with_error!(env, JobRegistryError::InvalidExpiration);
    }
}

fn validate_cid(env: &Env, cid: &Bytes) {
    let len = cid.len();
    if len == 0 || len > MAX_CID_LEN {
        panic_with_error!(env, JobRegistryError::InvalidCid);
    }
}

fn validate_fee_config(env: &Env, config: &FeeConfig) {
    if config.max_fee_bps > MAX_CONFIGURABLE_FEE_BPS
        || config.base_fee_bps > config.max_fee_bps
        || config.budget_step_stroops <= 0
        || config.high_value_threshold_stroops < MIN_BUDGET_STROOPS
        || config.high_value_threshold_stroops > MAX_BUDGET_STROOPS
        || config.high_value_discount_bps > config.max_fee_bps
    {
        panic_with_error!(env, JobRegistryError::InvalidFeeConfig);
    }

    let peak = config
        .base_fee_bps
        .checked_add(config.step_fee_bps)
        .unwrap_or_else(|| panic_with_error!(env, JobRegistryError::Overflow));
    if peak > MAX_CONFIGURABLE_FEE_BPS {
        panic_with_error!(env, JobRegistryError::InvalidFeeConfig);
    }
}

fn compute_service_fee(env: &Env, budget_stroops: i128, config: &FeeConfig) -> FeeQuote {
    let tier_count = budget_stroops
        .checked_div(config.budget_step_stroops)
        .unwrap_or_else(|| panic_with_error!(env, JobRegistryError::InvalidFeeConfig));
    let tier_bps_i128 = tier_count
        .checked_mul(i128::from(config.step_fee_bps))
        .unwrap_or_else(|| panic_with_error!(env, JobRegistryError::Overflow));
    let tier_bps: u32 = tier_bps_i128
        .try_into()
        .unwrap_or_else(|_| panic_with_error!(env, JobRegistryError::Overflow));

    let mut fee_bps = config
        .base_fee_bps
        .checked_add(tier_bps)
        .unwrap_or_else(|| panic_with_error!(env, JobRegistryError::Overflow))
        .min(config.max_fee_bps);

    if budget_stroops >= config.high_value_threshold_stroops {
        fee_bps = fee_bps.saturating_sub(config.high_value_discount_bps);
    }

    let fee_stroops = budget_stroops
        .checked_mul(i128::from(fee_bps))
        .and_then(|amount| amount.checked_div(BASIS_POINTS_DENOMINATOR))
        .unwrap_or_else(|| panic_with_error!(env, JobRegistryError::Overflow));

    FeeQuote {
        fee_bps,
        fee_stroops,
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
        .get(&DataKey::BidByIndex(job_id, index))
        .unwrap_or_else(|| panic_with_error!(env, JobRegistryError::BidIndexOutOfBounds))
}

fn post_job_with_id(
    env: &Env,
    job_id: u64,
    client: Address,
    metadata_cid: Bytes,
    budget_stroops: i128,
    bidding_deadline: u64,
    expires_at: u64,
) {
    let key = DataKey::Job(job_id);
    if env.storage().persistent().has(&key) {
        panic_with_error!(env, JobRegistryError::JobAlreadyExists);
    }

    let quote = compute_service_fee(env, budget_stroops, &read_fee_config(env));
    let job = JobRecord {
        client,
        freelancer: None,
        metadata_cid,
        budget_stroops,
        service_fee_bps: quote.fee_bps,
        service_fee_stroops: quote.fee_stroops,
        expires_at,
        status: JobStatus::Open,
        bidding_deadline,
    };

    env.storage().persistent().set(&key, &job);
    env.storage()
        .persistent()
        .set(&DataKey::BidCount(job_id), &0u32);
}

fn release_collateral(env: &Env, job_id: u64, freelancer: Address) {
    let _job = read_job(env, job_id);
    let lookup_key = DataKey::BidLookup(job_id, freelancer.clone());
    let index: u32 = env
        .storage()
        .persistent()
        .get(&lookup_key)
        .unwrap_or_else(|| panic_with_error!(env, JobRegistryError::CollateralNotFound));

    let bid_key = DataKey::BidByIndex(job_id, index);
    let mut bid: BidRecord = env
        .storage()
        .persistent()
        .get(&bid_key)
        .unwrap_or_else(|| panic_with_error!(env, JobRegistryError::CollateralNotFound));
    if bid.collateral_released {
        panic_with_error!(env, JobRegistryError::CollateralAlreadyReleased);
    }
    bid.collateral_released = true;
    env.storage().persistent().set(&bid_key, &bid);
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{Address, Bytes, Env};

    const DEFAULT_COLLATERAL_STROOPS: i128 = 1_000;

    fn setup() -> (
        Env,
        JobRegistryContractClient<'static>,
        Address,
        Address,
        Address,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = 1_000);

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let contract_id = env.register_contract(None, JobRegistryContract);
        let cc = JobRegistryContractClient::new(&env, &contract_id);

        (env, cc, admin, client, freelancer)
    }

    fn future_expires_at(env: &Env) -> u64 {
        env.ledger().timestamp() + 60
    }

    fn default_bidding_deadline(env: &Env) -> u64 {
        env.ledger().timestamp() + 30
    }

    fn post_default_job(env: &Env, cc: &JobRegistryContractClient<'_>, client: &Address) {
        let cid = Bytes::from_slice(env, b"bafyJobCid");
        let deadline = default_bidding_deadline(env);
        let expires_at = future_expires_at(env);
        cc.post_job(
            &1u64,
            client,
            &cid,
            &MIN_BUDGET_STROOPS,
            &deadline,
            &expires_at,
        );
    }

    #[test]
    fn test_initialize_bootstraps_storage() {
        let (_env, cc, admin, _, _) = setup();
        cc.initialize(&admin);
        assert!(cc.is_initialized());
        assert_eq!(cc.get_admin(), admin);
        assert_eq!(cc.get_next_job_id(), 1u64);
        assert_eq!(cc.get_fee_config(), default_fee_config());
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1)")]
    fn test_double_initialize_panics() {
        let (_env, cc, admin, _, _) = setup();
        cc.initialize(&admin);
        cc.initialize(&admin);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_post_job_before_initialize_panics() {
        let (env, cc, _admin, client, _) = setup();
        let cid = Bytes::from_slice(&env, b"bafyJobCid");
        let expires_at = future_expires_at(&env);
        cc.post_job(
            &1u64,
            &client,
            &cid,
            &MIN_BUDGET_STROOPS,
            &default_bidding_deadline(&env),
            &expires_at,
        );
    }

    #[test]
    fn test_post_job_auto_allocates_sequential_ids() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);
        let cid1 = Bytes::from_slice(&env, b"bafyJobCid1");
        let cid2 = Bytes::from_slice(&env, b"bafyJobCid2");
        let id1 = cc.post_job_auto(
            &client,
            &cid1,
            &MIN_BUDGET_STROOPS,
            &default_bidding_deadline(&env),
            &future_expires_at(&env),
        );
        let id2 = cc.post_job_auto(
            &client,
            &cid2,
            &MIN_BUDGET_STROOPS,
            &default_bidding_deadline(&env),
            &future_expires_at(&env),
        );
        assert_eq!(id1, 1u64);
        assert_eq!(id2, 2u64);
        assert_eq!(cc.get_next_job_id(), 3u64);
    }

    #[test]
    fn test_dynamic_service_fee_is_stored_on_posting() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);
        let config = FeeConfig {
            base_fee_bps: 100,
            budget_step_stroops: 1_000_000,
            step_fee_bps: 50,
            max_fee_bps: 300,
            high_value_threshold_stroops: 10_000_000,
            high_value_discount_bps: 25,
        };
        cc.set_fee_config(&config);

        let budget = 5_000_000i128;
        let quote = cc.quote_service_fee(&budget);
        assert_eq!(quote.fee_bps, 300u32);
        assert_eq!(quote.fee_stroops, 150_000i128);

        let cid = Bytes::from_slice(&env, b"bafyJobCid");
        cc.post_job(
            &1u64,
            &client,
            &cid,
            &budget,
            &default_bidding_deadline(&env),
            &future_expires_at(&env),
        );
        let job = cc.get_job(&1u64);
        assert_eq!(job.metadata_cid, cid);
        assert_eq!(job.service_fee_bps, quote.fee_bps);
        assert_eq!(job.service_fee_stroops, quote.fee_stroops);
    }

    #[test]
    fn test_high_value_discount_adjusts_fee_downward() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);
        let config = FeeConfig {
            base_fee_bps: 200,
            budget_step_stroops: 1_000_000,
            step_fee_bps: 10,
            max_fee_bps: 500,
            high_value_threshold_stroops: 2_000_000,
            high_value_discount_bps: 75,
        };
        cc.set_fee_config(&config);

        let budget = 2_000_000i128;
        let quote = cc.quote_service_fee(&budget);
        assert_eq!(quote.fee_bps, 145u32);

        let cid = Bytes::from_slice(&env, b"bafyJobCid");
        cc.post_job(
            &1u64,
            &client,
            &cid,
            &budget,
            &default_bidding_deadline(&env),
            &future_expires_at(&env),
        );
        assert_eq!(cc.get_job(&1u64).service_fee_bps, 145u32);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #21)")]
    fn test_invalid_fee_config_panics() {
        let (_env, cc, admin, _, _) = setup();
        cc.initialize(&admin);
        cc.set_fee_config(&FeeConfig {
            base_fee_bps: 251,
            budget_step_stroops: 0,
            step_fee_bps: 0,
            max_fee_bps: 250,
            high_value_threshold_stroops: MIN_BUDGET_STROOPS,
            high_value_discount_bps: 0,
        });
    }

    #[test]
    fn test_budget_at_bounds_succeeds() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);
        let cid = Bytes::from_slice(&env, b"bafyJobCid");
        cc.post_job(
            &1u64,
            &client,
            &cid,
            &MIN_BUDGET_STROOPS,
            &default_bidding_deadline(&env),
            &future_expires_at(&env),
        );
        assert_eq!(cc.get_job(&1u64).budget_stroops, MIN_BUDGET_STROOPS);

        let cid2 = Bytes::from_slice(&env, b"bafyJobCid2");
        cc.post_job(
            &2u64,
            &client,
            &cid2,
            &MAX_BUDGET_STROOPS,
            &default_bidding_deadline(&env),
            &future_expires_at(&env),
        );
        assert_eq!(cc.get_job(&2u64).budget_stroops, MAX_BUDGET_STROOPS);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_budget_below_minimum_panics() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);
        let cid = Bytes::from_slice(&env, b"bafyJobCid");
        cc.post_job(
            &1u64,
            &client,
            &cid,
            &(MIN_BUDGET_STROOPS - 1),
            &default_bidding_deadline(&env),
            &future_expires_at(&env),
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn test_rejects_oversized_metadata_cid() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);
        let oversized = Bytes::from_slice(
            &env,
            b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        );
        cc.post_job(
            &1u64,
            &client,
            &oversized,
            &MIN_BUDGET_STROOPS,
            &default_bidding_deadline(&env),
            &future_expires_at(&env),
        );
    }

    #[test]
    fn test_full_lifecycle_transitions_to_assigned_and_deliverable_submitted() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);
        post_default_job(&env, &cc, &client);

        let proposal = Bytes::from_slice(&env, b"bafyProposalCid");
        cc.submit_bid(&1u64, &freelancer, &proposal, &DEFAULT_COLLATERAL_STROOPS);
        assert_eq!(cc.get_bids_count(&1u64), 1u32);

        cc.accept_bid(&1u64, &client, &freelancer);
        let assigned = cc.get_job(&1u64);
        assert_eq!(assigned.status, JobStatus::Assigned);
        assert_eq!(assigned.freelancer, Some(freelancer.clone()));

        let deliverable = Bytes::from_slice(&env, b"bafyDeliverableCid");
        cc.submit_deliverable(&1u64, &freelancer, &deliverable);
        assert_eq!(cc.get_job(&1u64).status, JobStatus::DeliverableSubmitted);
        assert_eq!(cc.get_deliverable(&1u64), deliverable);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn test_duplicate_bid_panics() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);
        post_default_job(&env, &cc, &client);
        let proposal = Bytes::from_slice(&env, b"bafyProposalCid");
        cc.submit_bid(&1u64, &freelancer, &proposal, &DEFAULT_COLLATERAL_STROOPS);
        cc.submit_bid(&1u64, &freelancer, &proposal, &DEFAULT_COLLATERAL_STROOPS);
    }

    #[test]
    fn test_bid_rows_are_map_like_and_paginated() {
        let (env, cc, admin, client, freelancer) = setup();
        let second_freelancer = Address::generate(&env);
        cc.initialize(&admin);
        post_default_job(&env, &cc, &client);

        let proposal_one = Bytes::from_slice(&env, b"bafyProposalOne");
        let proposal_two = Bytes::from_slice(&env, b"bafyProposalTwo");
        cc.submit_bid(
            &1u64,
            &freelancer,
            &proposal_one,
            &DEFAULT_COLLATERAL_STROOPS,
        );
        cc.submit_bid(
            &1u64,
            &second_freelancer,
            &proposal_two,
            &DEFAULT_COLLATERAL_STROOPS,
        );

        let first = cc.get_bid_at(&1u64, &0u32);
        let second = cc.get_bid_at(&1u64, &1u32);
        assert_eq!(first.freelancer, freelancer);
        assert_eq!(first.proposal_cid, proposal_one);
        assert_eq!(second.freelancer, second_freelancer);
        assert_eq!(second.proposal_cid, proposal_two);
        assert_eq!(cc.get_bids(&1u64).len(), 2u32);
        assert_eq!(cc.get_bids_page(&1u64, &1u32, &5u32).len(), 1u32);
        assert_eq!(cc.get_bids_page(&1u64, &10u32, &5u32).len(), 0u32);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #23)")]
    fn test_get_bid_at_out_of_bounds_returns_specific_error() {
        let (env, cc, admin, client, _) = setup();
        cc.initialize(&admin);
        post_default_job(&env, &cc, &client);
        cc.get_bid_at(&1u64, &0u32);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #9)")]
    fn test_only_job_creator_can_accept_proposals() {
        let (env, cc, admin, client, freelancer) = setup();
        let attacker = Address::generate(&env);
        cc.initialize(&admin);
        post_default_job(&env, &cc, &client);
        let proposal = Bytes::from_slice(&env, b"bafyProposalCid");
        cc.submit_bid(&1u64, &freelancer, &proposal, &DEFAULT_COLLATERAL_STROOPS);
        cc.accept_bid(&1u64, &attacker, &freelancer);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #11)")]
    fn test_accept_without_matching_bid_panics() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);
        post_default_job(&env, &cc, &client);
        cc.accept_bid(&1u64, &client, &freelancer);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn test_late_bid_after_acceptance_panics_with_job_not_open() {
        let (env, cc, admin, client, freelancer) = setup();
        let late_freelancer = Address::generate(&env);
        cc.initialize(&admin);
        post_default_job(&env, &cc, &client);
        let proposal = Bytes::from_slice(&env, b"bafyProposalCid");
        cc.submit_bid(&1u64, &freelancer, &proposal, &DEFAULT_COLLATERAL_STROOPS);
        cc.accept_bid(&1u64, &client, &freelancer);
        cc.submit_bid(
            &1u64,
            &late_freelancer,
            &proposal,
            &DEFAULT_COLLATERAL_STROOPS,
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #15)")]
    fn test_late_bid_after_deadline_returns_specific_error() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);
        post_default_job(&env, &cc, &client);
        env.ledger().with_mut(|li| li.timestamp += 31);
        let proposal = Bytes::from_slice(&env, b"bafyProposalCid");
        cc.submit_bid(&1u64, &freelancer, &proposal, &DEFAULT_COLLATERAL_STROOPS);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn test_cannot_accept_bid_twice() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);
        post_default_job(&env, &cc, &client);
        let proposal = Bytes::from_slice(&env, b"bafyProposalCid");
        cc.submit_bid(&1u64, &freelancer, &proposal, &DEFAULT_COLLATERAL_STROOPS);
        cc.accept_bid(&1u64, &client, &freelancer);
        cc.accept_bid(&1u64, &client, &freelancer);
    }

    #[test]
    fn test_set_escrow_deployer_round_trip() {
        let (_env, cc, admin, _, freelancer) = setup();
        cc.initialize(&admin);
        cc.set_escrow_deployer(&freelancer);
        assert_eq!(cc.get_escrow_deployer(), Some(freelancer));
    }

    #[test]
    fn test_collateral_release_updates_indexed_bid() {
        let (env, cc, admin, client, freelancer) = setup();
        cc.initialize(&admin);
        post_default_job(&env, &cc, &client);
        let proposal = Bytes::from_slice(&env, b"bafyProposalCid");
        cc.submit_bid(&1u64, &freelancer, &proposal, &DEFAULT_COLLATERAL_STROOPS);
        cc.refund_bid_collateral(&1u64, &freelancer);
        assert!(cc.get_bid_at(&1u64, &0u32).collateral_released);
    }
}
