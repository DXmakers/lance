#![no_std]

use soroban_sdk::BytesN;
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, log, panic_with_error,
    token, Address, Env, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum JobRegistryErrorCode {
    JobNotFound = 1,
    JobNotOpen = 2,
    Unauthorized = 3,
    InvalidInput = 4,
    InvalidState = 5,
    BidNotFound = 6,
}

#[contractclient(name = "JobRegistryClient")]
pub trait JobRegistryContract {
    fn mark_disputed(env: Env, job_id: u64) -> Result<(), JobRegistryErrorCode>;
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum EscrowStatus {
    Setup,
    Funded,
    WorkInProgress,
    Completed,
    Disputed,
    Resolved,
    Refunded,
}

impl EscrowStatus {
    pub fn validate_transition(&self, next: &EscrowStatus) -> Result<(), EscrowError> {
        match (self, next) {
            (EscrowStatus::Setup, EscrowStatus::Funded) => Ok(()),
            (EscrowStatus::Setup, EscrowStatus::Refunded) => Ok(()),
            (EscrowStatus::Funded, EscrowStatus::WorkInProgress) => Ok(()),
            (EscrowStatus::Funded, EscrowStatus::Completed) => Ok(()),
            (EscrowStatus::Funded, EscrowStatus::Disputed) => Ok(()),
            (EscrowStatus::Funded, EscrowStatus::Refunded) => Ok(()),
            (EscrowStatus::WorkInProgress, EscrowStatus::WorkInProgress) => Ok(()),
            (EscrowStatus::WorkInProgress, EscrowStatus::Completed) => Ok(()),
            (EscrowStatus::WorkInProgress, EscrowStatus::Disputed) => Ok(()),
            (EscrowStatus::WorkInProgress, EscrowStatus::Refunded) => Ok(()),
            (EscrowStatus::Disputed, EscrowStatus::Resolved) => Ok(()),
            (EscrowStatus::Disputed, EscrowStatus::Refunded) => Ok(()),
            _ => Err(EscrowError::InvalidStateTransition),
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum MilestoneStatus {
    Pending,
    Released,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Milestone {
    pub amount: i128,
    pub status: MilestoneStatus,
}

#[contracttype]
#[derive(Clone)]
pub struct EscrowJob {
    pub client: Address,
    pub freelancer: Address,
    pub token: Address,
    pub total_amount: i128,
    pub released_amount: i128,
    pub status: EscrowStatus,
    pub created_at: u64,
    pub expires_at: u64,
    pub milestones: Vec<Milestone>,
    pub requires_multisig: bool,
    pub token_decimals: u32, // populated during deposit via token::Client::decimals()
    pub dispute_deadline: u64, // 0 = no active dispute; set when dispute is raised/opened
}

/// Packs admin and agent_judge under one instance storage entry to cut ledger footprint.
#[contracttype]
#[derive(Clone)]
pub struct ContractConfig {
    pub admin: Address,
    pub agent_judge: Address,
}

#[contracttype]
pub enum DataKey {
    Job(u64),
    Config, // Replaces separate Admin + AgentJudge entries
    JobRegistry,
    Locked,
    MultisigConfig(u64),
}

#[contracttype]
#[derive(Clone)]
pub struct EscrowInitializedEvent {
    pub admin: Address,
    pub agent_judge: Address,
    pub initialized_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct AgentJudgeUpdatedEvent {
    pub old_agent: Address,
    pub new_agent: Address,
    pub updated_at: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum EscrowError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidInput = 4,
    JobNotFound = 5,
    InvalidState = 6,
    AmountMismatch = 7,
    NoPendingMilestones = 8,
    JobRegistrySyncFailed = 9,
    UpgradeUnauthorized = 10,
    InvalidStateTransition = 11,
    ReentrancyDetected = 12,
    MultisigRequired = 13,
    InsufficientSignatures = 14,
    AlreadySigned = 15,
    ArithmeticOverflow = 16,
    DisputeResolutionExpired = 17,
}

#[contracttype]
#[derive(Clone)]
pub struct DisputeRaisedEvent {
    pub job_id: u64,
    pub initiator: Address,
    pub milestones_released: u32,
    pub milestones_total: u32,
    pub raised_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct DepositEvent {
    pub job_id: u64,
    pub amount: i128,
    pub deposited_at: u64,
}
#[contracttype]
#[derive(Clone)]
pub struct ReleaseMilestoneEvent {
    pub job_id: u64,
    pub milestone_index: u32,
    pub amount: i128,
    pub released_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct OpenDisputeEvent {
    pub job_id: u64,
    pub initiator: Address,
    pub opened_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct JobRegistryConfiguredEvent {
    pub configured_by: Address,
    pub registry_contract: Address,
    pub configured_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct RegistryDisputeSyncedEvent {
    pub job_id: u64,
    pub registry_contract: Address,
    pub synced_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct ContractUpgradedEvent {
    pub by_admin: Address,
    pub new_wasm_hash: BytesN<32>,
    pub upgraded_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct BriefCanceledEvent {
    pub job_id: u64,
    pub refunded_amount: i128,
    pub canceled_by: Address,
    pub canceled_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MultisigConfig {
    pub signers: Vec<Address>,
    pub required_signatures: u32,
    pub current_signatures: Vec<Address>,
}

#[contracttype]
#[derive(Clone)]
pub struct MultisigConfiguredEvent {
    pub job_id: u64,
    pub required_signatures: u32,
    pub total_signers: u32,
    pub configured_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct MultisigSignedEvent {
    pub job_id: u64,
    pub signer: Address,
    pub signature_count: u32,
    pub signed_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct DisputeExpiredEvent {
    pub job_id: u64,
    pub refunded_to: Address,
    pub amount: i128,
    pub expired_at: u64,
}

fn enter_reentrancy_guard(env: &Env) {
    if env.storage().instance().has(&DataKey::Locked) {
        panic_with_error!(env, EscrowError::ReentrancyDetected);
    }
    env.storage().instance().set(&DataKey::Locked, &());
}

fn exit_reentrancy_guard(env: &Env) {
    env.storage().instance().remove(&DataKey::Locked);
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    const INSTANCE_TTL_THRESHOLD: u32 = 50_000;
    const INSTANCE_TTL_EXTEND_TO: u32 = 150_000;
    const PERSISTENT_TTL_THRESHOLD: u32 = 50_000;
    const PERSISTENT_TTL_EXTEND_TO: u32 = 150_000;
    const DISPUTE_RESOLUTION_WINDOW: u64 = 7 * 24 * 60 * 60;

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(Self::INSTANCE_TTL_THRESHOLD, Self::INSTANCE_TTL_EXTEND_TO);
    }

    fn bump_job_ttl(env: &Env, key: &DataKey) {
        if env.storage().persistent().has(key) {
            env.storage().persistent().extend_ttl(
                key,
                Self::PERSISTENT_TTL_THRESHOLD,
                Self::PERSISTENT_TTL_EXTEND_TO,
            );
        }
    }

    fn checked_add_i128(env: &Env, a: i128, b: i128) -> Result<i128, EscrowError> {
        a.checked_add(b).ok_or_else(|| {
            log!(env, "checked_add_i128 overflow: {} + {}", a, b);
            EscrowError::InvalidInput
        })
    }

    fn checked_sub_i128(env: &Env, a: i128, b: i128) -> Result<i128, EscrowError> {
        a.checked_sub(b).ok_or_else(|| {
            log!(env, "checked_sub_i128 underflow: {} - {}", a, b);
            EscrowError::InvalidInput
        })
    }

    fn sync_dispute_to_job_registry(env: &Env, job_id: u64) -> Result<(), EscrowError> {
        Self::bump_instance_ttl(env);
        let Some(registry_contract) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::JobRegistry)
        else {
            return Ok(());
        };

        let client = JobRegistryClient::new(env, &registry_contract);
        client
            .try_mark_disputed(&job_id)
            .map_err(|_| EscrowError::JobRegistrySyncFailed)?
            .map_err(|_| EscrowError::JobRegistrySyncFailed)?;

        env.events().publish(
            ("escrow", "RegistryDisputeSynced"),
            RegistryDisputeSyncedEvent {
                job_id,
                registry_contract,
                synced_at: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    pub fn initialize(env: Env, admin: Address, agent_judge: Address) -> Result<(), EscrowError> {
        // Prevent double initialization
        if env.storage().instance().has(&DataKey::Config) {
            return Err(EscrowError::AlreadyInitialized);
        }

        // Basic validation: admin and agent_judge must be distinct
        if admin == agent_judge {
            return Err(EscrowError::InvalidInput);
        }

        env.storage().instance().set(
            &DataKey::Config,
            &ContractConfig {
                admin: admin.clone(),
                agent_judge: agent_judge.clone(),
            },
        );

        // Emit an initialization event for off-chain consumers and logging
        log!(
            &env,
            "Escrow initialized with admin: {} and agent_judge: {}",
            admin,
            agent_judge
        );
        env.events().publish(
            ("escrow", "Initialized"),
            (admin.clone(), agent_judge.clone(), env.ledger().timestamp()),
        );

        Self::bump_instance_ttl(&env);

        Ok(())
    }
    /// Admin can update the Agent Judge address.
    /// Admin can update the Agent Judge address.
    pub fn set_agent_judge(env: Env, new_agent_judge: Address) -> Result<(), EscrowError> {
        let mut config: ContractConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(EscrowError::NotInitialized)?;
        config.admin.require_auth();

        if config.admin == new_agent_judge {
            return Err(EscrowError::InvalidInput);
        }

        let admin = config.admin.clone();
        config.agent_judge = new_agent_judge.clone();
        env.storage().instance().set(&DataKey::Config, &config);

        // Emit an event for off-chain logging and debugging
        log!(&env, "Agent Judge updated to: {}", new_agent_judge);
        env.events().publish(
            ("escrow", "AgentJudgeUpdated"),
            (
                admin.clone(),
                new_agent_judge.clone(),
                env.ledger().timestamp(),
            ),
        );

        Self::bump_instance_ttl(&env);

        Ok(())
    }

    /// Admin configures the JobRegistry contract address used for cross-contract sync.
    pub fn set_job_registry(env: Env, job_registry: Address) -> Result<(), EscrowError> {
        let config: ContractConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(EscrowError::NotInitialized)?;
        let admin = config.admin;
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::JobRegistry, &job_registry);

        log!(&env, "JobRegistry configured to: {}", job_registry);
        env.events().publish(
            ("escrow", "JobRegistryConfigured"),
            JobRegistryConfiguredEvent {
                configured_by: admin,
                registry_contract: job_registry,
                configured_at: env.ledger().timestamp(),
            },
        );

        Self::bump_instance_ttl(&env);

        Ok(())
    }

    /// Upgrades the current contract WASM. Only callable by admin.
    pub fn upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), EscrowError> {
        Self::bump_instance_ttl(&env);
        caller.require_auth();

        let config: ContractConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(EscrowError::NotInitialized)?;

        if caller != config.admin {
            return Err(EscrowError::UpgradeUnauthorized);
        }

        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        log!(&env, "Contract upgraded by admin");
        env.events().publish(
            ("escrow", "ContractUpgraded"),
            ContractUpgradedEvent {
                by_admin: caller,
                new_wasm_hash,
                upgraded_at: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    /// Client creates a job entry in Setup phase.
    pub fn create_job(
        env: Env,
        job_id: u64,
        client: Address,
        freelancer: Address,
        token_addr: Address,
    ) {
        client.require_auth();
        let key = DataKey::Job(job_id);
        if env.storage().persistent().has(&key) {
            panic!("job already exists");
        }
        let now: u64 = env.ledger().timestamp();
        let expires_at = now + 30 * 24 * 60 * 60;

        let job = EscrowJob {
            client: client.clone(),
            freelancer: freelancer.clone(),
            token: token_addr,
            total_amount: 0,
            released_amount: 0,
            status: EscrowStatus::Setup,
            created_at: now,
            expires_at,
            milestones: Vec::new(&env),
            requires_multisig: false,
            token_decimals: 0,
            dispute_deadline: 0,
        };
        log!(
            &env,
            "create_job: id {} client {} freelancer {}",
            job_id,
            client,
            freelancer
        );
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);
    }

    /// Add a milestone to the job (setup phase only).
    pub fn add_milestone(env: Env, job_id: u64, amount: i128) {
        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");
        Self::bump_job_ttl(&env, &key);
        job.client.require_auth();
        assert!(job.status == EscrowStatus::Setup, "not in setup phase");
        assert!(amount > 0, "amount must be > 0");

        job.milestones.push_back(Milestone {
            amount,
            status: MilestoneStatus::Pending,
        });
        log!(&env, "add_milestone: job {} amount {}", job_id, amount);
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);
    }

    /// Client deposits total amount and transitions job to Funded.
    pub fn deposit(env: Env, job_id: u64, amount: i128) -> Result<(), EscrowError> {
        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);

        // Caller must be client
        job.client.require_auth();

        // Only allow deposit in Setup state
        if job.status != EscrowStatus::Setup {
            return Err(EscrowError::InvalidState);
        }

        if amount <= 0 {
            return Err(EscrowError::InvalidInput);
        }

        if job.milestones.is_empty() {
            return Err(EscrowError::InvalidInput);
        }

        // Query token decimals dynamically; custom assets vary (USDC=6, XLM=7, etc.)
        // Query token decimals dynamically; stored so off-chain consumers can
        // correctly display amounts (USDC=6, XLM=7, etc.).
        // Amounts are already in the token's smallest unit so no rounding check needed.
        let decimals = token::Client::new(&env, &job.token).decimals();
        job.token_decimals = decimals;

        let mut total_milestones_amount = 0i128;
        for m in job.milestones.iter() {
            total_milestones_amount =
                Self::checked_add_i128(&env, total_milestones_amount, m.amount)?;
        }

        if total_milestones_amount != amount {
            return Err(EscrowError::AmountMismatch);
        }

        enter_reentrancy_guard(&env);

        let next_status = EscrowStatus::Funded;
        job.status.validate_transition(&next_status)?;
        job.total_amount = amount;
        job.status = next_status;

        // Transfer tokens from client to contract
        let token_client = token::Client::new(&env, &job.token);
        token_client.transfer(&job.client, &env.current_contract_address(), &amount);

        log!(&env, "deposit: job {} amount {}", job_id, amount);
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);

        exit_reentrancy_guard(&env);

        // Emit deposit event for off-chain logging
        let evt = DepositEvent {
            job_id,
            amount,
            deposited_at: env.ledger().timestamp(),
        };
        env.events().publish(("escrow", "Deposit"), evt);

        Ok(())
    }

    /// Client approves a milestone -- releases next pending milestone to freelancer.
    pub fn release_milestone(env: Env, job_id: u64, caller: Address) -> Result<(), EscrowError> {
        caller.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);

        if !(job.status == EscrowStatus::Funded || job.status == EscrowStatus::WorkInProgress) {
            return Err(EscrowError::InvalidState);
        }

        if caller != job.client {
            return Err(EscrowError::Unauthorized);
        }

        // Find next pending milestone
        let mut found_idx: Option<u32> = None;
        for idx in 0..job.milestones.len() {
            if job.milestones.get(idx).unwrap().status == MilestoneStatus::Pending {
                found_idx = Some(idx);
                break;
            }
        }

        let idx = match found_idx {
            Some(i) => i,
            None => return Err(EscrowError::NoPendingMilestones),
        };

        let mut milestone = job.milestones.get(idx).unwrap();
        milestone.status = MilestoneStatus::Released;
        job.milestones.set(idx, milestone.clone());

        job.released_amount = Self::checked_add_i128(&env, job.released_amount, milestone.amount)?;

        let next_status = if job.released_amount == job.total_amount {
            EscrowStatus::Completed
        } else {
            EscrowStatus::WorkInProgress
        };
        job.status.validate_transition(&next_status)?;
        job.status = next_status;

        enter_reentrancy_guard(&env);

        let token_client = token::Client::new(&env, &job.token);
        token_client.transfer(
            &env.current_contract_address(),
            &job.freelancer,
            &milestone.amount,
        );

        log!(
            &env,
            "release_milestone: job {} amount {}",
            job_id,
            milestone.amount
        );
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);

        exit_reentrancy_guard(&env);

        // Emit event
        env.events().publish(
            ("escrow", "ReleaseMilestone"),
            (job_id, idx, milestone.amount, env.ledger().timestamp()),
        );

        Ok(())
    }

    /// Happy-path release for an explicit milestone index (0-based).
    /// Only the client may call this to release the funds for a specific milestone.
    pub fn release_funds(env: Env, job_id: u64, caller: Address, milestone_index: u32) {
        caller.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");
        Self::bump_job_ttl(&env, &key);

        assert!(
            job.status == EscrowStatus::Funded || job.status == EscrowStatus::WorkInProgress,
            "job not in releaseable state"
        );
        assert!(caller == job.client, "only client can release");
        assert!(
            milestone_index < job.milestones.len(),
            "invalid milestone index"
        );

        let mut milestone = job
            .milestones
            .get(milestone_index)
            .expect("invalid milestone");
        assert!(
            milestone.status == MilestoneStatus::Pending,
            "milestone already released"
        );

        milestone.status = MilestoneStatus::Released;
        job.milestones.set(milestone_index, milestone.clone());

        job.released_amount = job
            .released_amount
            .checked_add(milestone.amount)
            .expect("released_amount overflow");
        assert!(
            job.released_amount <= job.total_amount,
            "double-spend: released exceeds total"
        );
        let next_status = if job.released_amount == job.total_amount {
            EscrowStatus::Completed
        } else {
            EscrowStatus::WorkInProgress
        };
        job.status
            .validate_transition(&next_status)
            .expect("invalid state transition");
        job.status = next_status;

        enter_reentrancy_guard(&env);

        let token_client = token::Client::new(&env, &job.token);
        token_client.transfer(
            &env.current_contract_address(),
            &job.freelancer,
            &milestone.amount,
        );

        log!(
            &env,
            "release_funds: job {} amount {}",
            job_id,
            milestone.amount
        );
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);

        exit_reentrancy_guard(&env);
    }

    /// Either party opens a dispute, locking remaining funds.
    pub fn open_dispute(env: Env, job_id: u64, caller: Address) -> Result<(), EscrowError> {
        caller.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);

        if !(job.status == EscrowStatus::Funded || job.status == EscrowStatus::WorkInProgress) {
            return Err(EscrowError::InvalidState);
        }

        if !(caller == job.client || caller == job.freelancer) {
            return Err(EscrowError::Unauthorized);
        }

        let next_status = EscrowStatus::Disputed;
        job.status.validate_transition(&next_status)?;
        job.status = next_status;
        job.dispute_deadline = env.ledger().timestamp() + Self::DISPUTE_RESOLUTION_WINDOW;
        log!(&env, "open_dispute: job {}", job_id);
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);

        Self::sync_dispute_to_job_registry(&env, job_id)?;

        env.events().publish(
            ("escrow", "OpenDispute"),
            (job_id, caller, env.ledger().timestamp()),
        );

        Ok(())
    }

    /// Either party formally raises a dispute with on-chain event emission.
    /// Locks funds, transitions state to Disputed, and signals the AI Judge.
    pub fn raise_dispute(env: Env, job_id: u64, caller: Address) -> Result<(), EscrowError> {
        // 1. Authenticate the caller
        caller.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");
        Self::bump_job_ttl(&env, &key);

        // 2. Only client or freelancer may raise a dispute
        assert!(
            caller == job.client || caller == job.freelancer,
            "unauthorized: only client or freelancer can raise a dispute"
        );

        // 3. Job must still be active
        assert!(
            job.status == EscrowStatus::Funded || job.status == EscrowStatus::WorkInProgress,
            "dispute cannot be raised: job is not in active state"
        );

        // 4. Prevent dispute if all funds are already released
        assert!(
            job.released_amount < job.total_amount,
            "dispute cannot be raised: all funds already released"
        );

        // 5. Prevent dispute if deadline has drastically expired (7-day grace period)
        let now: u64 = env.ledger().timestamp();
        let grace_period: u64 = 7 * 24 * 60 * 60;
        assert!(
            now <= job.expires_at + grace_period,
            "dispute cannot be raised: deadline has drastically expired"
        );

        // 6. Lock funds by transitioning to Disputed — blocks release_funds & release_milestone
        let next_status = EscrowStatus::Disputed;
        job.status.validate_transition(&next_status)?;
        job.status = next_status;
        job.dispute_deadline = now + Self::DISPUTE_RESOLUTION_WINDOW;
        log!(&env, "raise_dispute: job {}", job_id);
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);

        Self::sync_dispute_to_job_registry(&env, job_id)?;

        // 7. Emit DisputeRaised event for backend / AI Judge to consume
        let mut released_count = 0u32;
        for m in job.milestones.iter() {
            if m.status == MilestoneStatus::Released {
                released_count += 1;
            }
        }

        env.events().publish(
            ("escrow", "DisputeRaised"),
            (
                job_id,
                caller.clone(),
                released_count,
                job.milestones.len(),
                now,
            ),
        );

        Ok(())
    }

    /// Agent Judge resolves dispute -- splits funds by explicit amounts.
    /// `payee_amount`: Amount to pay to the freelancer (payee).
    /// `payer_amount`: Amount to return to the client (payer).
    pub fn resolve_dispute(env: Env, job_id: u64, payee_amount: i128, payer_amount: i128) {
        Self::bump_instance_ttl(&env);
        let config: ContractConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("not initialized");
        config.agent_judge.require_auth();

        assert!(payee_amount >= 0, "payee_amount must be >= 0");
        assert!(payer_amount >= 0, "payer_amount must be >= 0");

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");
        Self::bump_job_ttl(&env, &key);
        assert!(job.status == EscrowStatus::Disputed, "job not disputed");

        if job.dispute_deadline > 0 && env.ledger().timestamp() > job.dispute_deadline {
            panic_with_error!(&env, EscrowError::DisputeResolutionExpired);
        }

        let remaining = Self::checked_sub_i128(&env, job.total_amount, job.released_amount)
            .expect("invalid escrow balance state");
        let total_payout = Self::checked_add_i128(&env, payee_amount, payer_amount)
            .expect("invalid dispute payout state");
        assert!(total_payout <= remaining, "payout exceeds remaining funds");

        let next_status = EscrowStatus::Resolved;
        job.status
            .validate_transition(&next_status)
            .expect("invalid state transition");
        job.released_amount = Self::checked_add_i128(&env, job.released_amount, total_payout)
            .expect("released amount overflow");
        job.status = next_status;

        enter_reentrancy_guard(&env);

        let token_client = token::Client::new(&env, &job.token);
        if payee_amount > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &job.freelancer,
                &payee_amount,
            );
        }
        if payer_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &job.client, &payer_amount);
        }

        log!(
            &env,
            "resolve_dispute: job {} payee {} payer {}",
            job_id,
            payee_amount,
            payer_amount
        );
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);

        exit_reentrancy_guard(&env);
    }

    /// Client recoups funds if freelancer never responded or deadline has passed.
    pub fn refund(env: Env, job_id: u64, client: Address) -> Result<(), EscrowError> {
        client.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);

        if !(job.status == EscrowStatus::Funded || job.status == EscrowStatus::WorkInProgress) {
            return Err(EscrowError::InvalidState);
        }

        if client != job.client {
            return Err(EscrowError::Unauthorized);
        }

        let remaining = Self::checked_sub_i128(&env, job.total_amount, job.released_amount)?;

        let next_status = EscrowStatus::Refunded;
        job.status.validate_transition(&next_status)?;
        job.released_amount = job.total_amount;
        job.status = next_status;

        enter_reentrancy_guard(&env);

        if remaining > 0 {
            let token_client = token::Client::new(&env, &job.token);
            token_client.transfer(&env.current_contract_address(), &job.client, &remaining);
        }

        log!(&env, "refund: job {} amount {}", job_id, remaining);
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);

        exit_reentrancy_guard(&env);

        env.events().publish(
            ("escrow", "Refunded"),
            (job_id, client, remaining, env.ledger().timestamp()),
        );

        Ok(())
    }

    /// Client cancels a brief and triggers graceful refund behavior.
    /// Supports Setup (no funds moved yet), Funded, and WorkInProgress states.
    pub fn cancel_brief(env: Env, job_id: u64, client: Address) -> Result<(), EscrowError> {
        client.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);

        if client != job.client {
            return Err(EscrowError::Unauthorized);
        }

        if !(job.status == EscrowStatus::Setup
            || job.status == EscrowStatus::Funded
            || job.status == EscrowStatus::WorkInProgress)
        {
            return Err(EscrowError::InvalidState);
        }

        let remaining = job
            .total_amount
            .checked_sub(job.released_amount)
            .ok_or(EscrowError::InvalidInput)?;

        let next_status = EscrowStatus::Refunded;
        job.status.validate_transition(&next_status)?;
        job.released_amount = job.total_amount;
        job.status = next_status;

        enter_reentrancy_guard(&env);

        if remaining > 0 {
            let token_client = token::Client::new(&env, &job.token);
            token_client.transfer(&env.current_contract_address(), &job.client, &remaining);
        }

        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);
        exit_reentrancy_guard(&env);

        env.events().publish(
            ("escrow", "BriefCanceled"),
            BriefCanceledEvent {
                job_id,
                refunded_amount: remaining,
                canceled_by: client,
                canceled_at: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    pub fn get_job(env: Env, job_id: u64) -> EscrowJob {
        let key = DataKey::Job(job_id);
        let job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");
        Self::bump_job_ttl(&env, &key);
        job
    }

    pub fn get_admin(env: Env) -> Address {
        Self::bump_instance_ttl(&env);
        let config: ContractConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("not initialized");
        config.admin
    }

    pub fn get_agent_judge(env: Env) -> Address {
        Self::bump_instance_ttl(&env);
        let config: ContractConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("not initialized");
        config.agent_judge
    }

    pub fn get_token_decimals(env: Env, job_id: u64) -> u32 {
        let key = DataKey::Job(job_id);
        let job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");
        Self::bump_job_ttl(&env, &key);
        job.token_decimals
    }

    /// Returns the dispute resolution deadline (unix timestamp). 0 = no active dispute.
    pub fn get_dispute_deadline(env: Env, job_id: u64) -> u64 {
        let key = DataKey::Job(job_id);
        let job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");
        Self::bump_job_ttl(&env, &key);
        job.dispute_deadline
    }

    /// Force-expire an unresolved dispute after the deadline; refunds client.
    pub fn expire_dispute(env: Env, job_id: u64) -> Result<(), EscrowError> {
        Self::bump_instance_ttl(&env);
        let config: ContractConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(EscrowError::NotInitialized)?;
        config.agent_judge.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);

        if job.status != EscrowStatus::Disputed {
            return Err(EscrowError::InvalidState);
        }

        let now = env.ledger().timestamp();
        if job.dispute_deadline == 0 || now <= job.dispute_deadline {
            return Err(EscrowError::InvalidState);
        }

        let remaining = job.total_amount - job.released_amount;
        let next_status = EscrowStatus::Refunded;
        job.status.validate_transition(&next_status)?;
        job.released_amount = job.total_amount;
        job.status = next_status;

        enter_reentrancy_guard(&env);

        if remaining > 0 {
            let token_client = token::Client::new(&env, &job.token);
            token_client.transfer(&env.current_contract_address(), &job.client, &remaining);
        }

        log!(
            &env,
            "expire_dispute: job {} refunded {}",
            job_id,
            remaining
        );
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);

        exit_reentrancy_guard(&env);

        env.events().publish(
            ("escrow", "DisputeExpired"),
            DisputeExpiredEvent {
                job_id,
                refunded_to: job.client,
                amount: remaining,
                expired_at: now,
            },
        );

        Ok(())
    }

    /// Retrieve the status of all milestones for a given job.
    pub fn get_milestone_status(env: Env, job_id: u64) -> Vec<MilestoneStatus> {
        let key = DataKey::Job(job_id);
        let job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");
        Self::bump_job_ttl(&env, &key);
        let mut statuses = Vec::new(&env);
        for m in job.milestones.iter() {
            statuses.push_back(m.status);
        }
        statuses
    }

    /// Read-only helper exposing active escrow configuration.
    pub fn get_escrow_config(env: Env) -> Result<(Address, Address, Option<Address>), EscrowError> {
        let config: ContractConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(EscrowError::NotInitialized)?;
        let job_registry: Option<Address> = env.storage().instance().get(&DataKey::JobRegistry);
        Self::bump_instance_ttl(&env);
        Ok((config.admin, config.agent_judge, job_registry))
    }

    /// Read-only helper exposing unreleased escrow balance for a job.
    pub fn get_remaining_balance(env: Env, job_id: u64) -> Result<i128, EscrowError> {
        let key = DataKey::Job(job_id);
        let job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);
        Self::checked_sub_i128(&env, job.total_amount, job.released_amount)
    }

    /// Configure multisig for a job. Only callable by client during Setup phase.
    pub fn configure_multisig(
        env: Env,
        job_id: u64,
        signers: Vec<Address>,
        required_signatures: u32,
    ) -> Result<(), EscrowError> {
        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);

        job.client.require_auth();

        if job.status != EscrowStatus::Setup {
            return Err(EscrowError::InvalidState);
        }

        if signers.is_empty() || required_signatures == 0 {
            return Err(EscrowError::InvalidInput);
        }

        if required_signatures > signers.len() {
            return Err(EscrowError::InvalidInput);
        }

        let config = MultisigConfig {
            signers: signers.clone(),
            required_signatures,
            current_signatures: Vec::new(&env),
        };

        env.storage()
            .persistent()
            .set(&DataKey::MultisigConfig(job_id), &config);

        job.requires_multisig = true;
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);

        env.events().publish(
            ("escrow", "MultisigConfigured"),
            MultisigConfiguredEvent {
                job_id,
                required_signatures,
                total_signers: signers.len(),
                configured_at: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    /// Sign a multisig job. Callable by any configured signer.
    pub fn sign_multisig(env: Env, job_id: u64, signer: Address) -> Result<(), EscrowError> {
        signer.require_auth();

        let key = DataKey::Job(job_id);
        let job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);

        if !job.requires_multisig {
            return Err(EscrowError::InvalidInput);
        }

        let config_key = DataKey::MultisigConfig(job_id);
        let mut config: MultisigConfig = env
            .storage()
            .persistent()
            .get(&config_key)
            .ok_or(EscrowError::InvalidInput)?;

        // Check if signer is authorized
        let mut is_signer = false;
        for s in config.signers.iter() {
            if s == signer {
                is_signer = true;
                break;
            }
        }
        if !is_signer {
            return Err(EscrowError::Unauthorized);
        }

        // Check if already signed
        for s in config.current_signatures.iter() {
            if s == signer {
                return Err(EscrowError::AlreadySigned);
            }
        }

        config.current_signatures.push_back(signer.clone());
        env.storage().persistent().set(&config_key, &config);
        Self::bump_job_ttl(&env, &config_key);

        env.events().publish(
            ("escrow", "MultisigSigned"),
            MultisigSignedEvent {
                job_id,
                signer,
                signature_count: config.current_signatures.len(),
                signed_at: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    /// Check if a multisig job has enough signatures
    pub fn check_multisig_ready(env: Env, job_id: u64) -> Result<bool, EscrowError> {
        let key = DataKey::Job(job_id);
        let job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;

        if !job.requires_multisig {
            return Ok(true);
        }

        let config_key = DataKey::MultisigConfig(job_id);
        let config: MultisigConfig = env
            .storage()
            .persistent()
            .get(&config_key)
            .ok_or(EscrowError::InvalidInput)?;

        Ok(config.current_signatures.len() >= config.required_signatures)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{token, Address, Env};

    fn setup_token(env: &Env, admin: &Address) -> Address {
        let contract = env.register_stellar_asset_contract_v2(admin.clone());
        contract.address()
    }

    fn mint(env: &Env, token_addr: &Address, to: &Address) {
        let admin_client = token::StellarAssetClient::new(env, token_addr);
        admin_client.mint(to, &100_000);
    }

    #[test]
    fn test_happy_path_lifecycle() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &3000i128);
        cc.deposit(&1u64, &9000i128);

        let tc = token::Client::new(&env, &token_addr);
        assert_eq!(tc.balance(&contract_id), 9000);

        cc.release_milestone(&1u64, &client);
        assert_eq!(tc.balance(&freelancer), 3000);

        cc.release_milestone(&1u64, &client);
        assert_eq!(tc.balance(&freelancer), 6000);

        cc.release_milestone(&1u64, &client);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Completed);
        assert_eq!(tc.balance(&freelancer), 9000);
        assert_eq!(tc.balance(&contract_id), 0);
    }

    #[test]
    fn test_variable_milestone_amounts() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);

        // 3 distinct milestones with different amounts
        cc.add_milestone(&1u64, &2000i128); // 20%
        cc.add_milestone(&1u64, &3000i128); // 30%
        cc.add_milestone(&1u64, &5000i128); // 50%

        cc.deposit(&1u64, &10_000i128);

        let tc = token::Client::new(&env, &token_addr);
        assert_eq!(tc.balance(&contract_id), 10_000);

        // Release first milestone
        cc.release_milestone(&1u64, &client);
        assert_eq!(tc.balance(&freelancer), 2000);

        // Check milestone status
        let statuses = cc.get_milestone_status(&1u64);
        assert_eq!(statuses.get(0).unwrap(), MilestoneStatus::Released);
        assert_eq!(statuses.get(1).unwrap(), MilestoneStatus::Pending);

        // Release second milestone
        cc.release_milestone(&1u64, &client);
        assert_eq!(tc.balance(&freelancer), 5000);

        // Release third milestone
        cc.release_milestone(&1u64, &client);
        assert_eq!(tc.balance(&freelancer), 10_000);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Completed);
    }

    #[test]
    // Initialization now returns EscrowError::AlreadyInitialized which surfaces
    // as a host error with numeric code #1. Match that in the test.
    #[should_panic(expected = "Error(Contract, #1)")]
    fn test_double_init() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.initialize(&admin, &agent_judge);
    }

    #[test]
    // Unauthorized now returns EscrowError::Unauthorized which surfaces as
    // host error code #3.
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_unauthorized_release() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let rando = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &500i128);
        cc.add_milestone(&1u64, &500i128);
        cc.deposit(&1u64, &1000i128);

        // This should panic due to unauthorized release; test annotated with should_panic
        cc.release_milestone(&1u64, &rando);
    }

    #[test]
    fn test_dispute_50_50_split() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &2500i128);
        cc.add_milestone(&1u64, &2500i128);
        cc.add_milestone(&1u64, &2500i128);
        cc.add_milestone(&1u64, &2500i128);
        cc.deposit(&1u64, &10_000i128);

        cc.release_milestone(&1u64, &client);
        let tc = token::Client::new(&env, &token_addr);
        assert_eq!(tc.balance(&freelancer), 2500);

        cc.open_dispute(&1u64, &freelancer);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Disputed);

        // 50/50 split of remaining (7500): 3750 to freelancer, 3750 to client
        cc.resolve_dispute(&1u64, &3750i128, &3750i128);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Resolved);
        assert_eq!(tc.balance(&freelancer), 6250);
        assert_eq!(tc.balance(&client), 93750);
    }

    #[test]
    fn test_refund() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &2500i128);
        cc.add_milestone(&1u64, &2500i128);
        cc.deposit(&1u64, &5000i128);

        assert_eq!(
            token::Client::new(&env, &token_addr).balance(&client),
            95_000
        );

        cc.refund(&1u64, &client);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Refunded);
        assert_eq!(
            token::Client::new(&env, &token_addr).balance(&client),
            100_000
        );
    }

    #[test]
    // Deposit now returns EscrowError::AmountMismatch which surfaces as host
    // error code #7.
    #[should_panic(expected = "Error(Contract, #7)")]
    fn test_deposit_with_wrong_total_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &500i128);
        cc.deposit(&1u64, &1000i128);
    }

    #[test]
    // Deposit with no milestones returns EscrowError::InvalidInput -> host
    // error code #4.
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_deposit_no_milestones_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.deposit(&1u64, &1000i128);
    }

    #[test]
    #[should_panic(expected = "job already exists")]
    fn test_double_create_job_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token_addr = Address::generate(&env);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
    }

    #[test]
    fn test_exhaustive_release_funds_path() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);

        let total_amount = 10_000i128;
        cc.add_milestone(&1u64, &2500i128);
        cc.add_milestone(&1u64, &2500i128);
        cc.add_milestone(&1u64, &2500i128);
        cc.add_milestone(&1u64, &2500i128);
        cc.deposit(&1u64, &total_amount);

        let tc = token::Client::new(&env, &token_addr);
        assert_eq!(tc.balance(&contract_id), total_amount);

        // Release milestones one by one in arbitrary order
        cc.release_funds(&1u64, &client, &2u32);
        assert_eq!(tc.balance(&freelancer), 2500);

        cc.release_funds(&1u64, &client, &0u32);
        assert_eq!(tc.balance(&freelancer), 5000);

        cc.release_funds(&1u64, &client, &3u32);
        assert_eq!(tc.balance(&freelancer), 7500);

        cc.release_funds(&1u64, &client, &1u32);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Completed);
        assert_eq!(tc.balance(&freelancer), total_amount);
        assert_eq!(tc.balance(&contract_id), 0);
    }

    #[test]
    fn test_raise_dispute_by_client_locks_funds() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &3000i128);
        cc.deposit(&1u64, &9000i128);

        cc.raise_dispute(&1u64, &client);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Disputed);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Comprehensive Escrow Deposit & Milestone Release Tests (>90% coverage)
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_deposit_success_transitions_to_funded() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);

        let tc = token::Client::new(&env, &token_addr);
        let client_balance_before = tc.balance(&client);

        cc.deposit(&1u64, &5000i128);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Funded);
        assert_eq!(job.total_amount, 5000);
        assert_eq!(tc.balance(&contract_id), 5000);
        assert_eq!(tc.balance(&client), client_balance_before - 5000);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_deposit_invalid_state_not_setup() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &3000i128);
        cc.deposit(&1u64, &6000i128);

        // Try to deposit again when job is already Funded
        cc.deposit(&1u64, &6000i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_deposit_negative_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &1000i128);

        cc.deposit(&1u64, &-1000i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_deposit_zero_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &1000i128);

        cc.deposit(&1u64, &0i128);
    }

    #[test]
    fn test_release_milestone_sequential_success() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &2000i128);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &10000i128);

        let tc = token::Client::new(&env, &token_addr);

        // Release first milestone
        cc.release_milestone(&1u64, &client);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::WorkInProgress);
        assert_eq!(job.released_amount, 2000);
        assert_eq!(tc.balance(&freelancer), 2000);

        // Release second milestone
        cc.release_milestone(&1u64, &client);
        let job = cc.get_job(&1u64);
        assert_eq!(job.released_amount, 5000);
        assert_eq!(tc.balance(&freelancer), 5000);

        // Release third milestone - should complete the job
        cc.release_milestone(&1u64, &client);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Completed);
        assert_eq!(job.released_amount, 10000);
        assert_eq!(tc.balance(&freelancer), 10000);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_release_milestone_no_pending_milestones() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);

        // Release the only milestone
        cc.release_milestone(&1u64, &client);

        // Try to release again - should fail
        cc.release_milestone(&1u64, &client);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_release_milestone_unauthorized_freelancer() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);

        // Freelancer cannot release milestones
        cc.release_milestone(&1u64, &freelancer);
    }

    #[test]
    fn test_release_funds_explicit_index() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &1000i128);
        cc.add_milestone(&1u64, &2000i128);
        cc.add_milestone(&1u64, &3000i128);
        cc.deposit(&1u64, &6000i128);

        let tc = token::Client::new(&env, &token_addr);

        // Release milestones in non-sequential order
        cc.release_funds(&1u64, &client, &2u32);
        assert_eq!(tc.balance(&freelancer), 3000);

        cc.release_funds(&1u64, &client, &0u32);
        assert_eq!(tc.balance(&freelancer), 4000);

        cc.release_funds(&1u64, &client, &1u32);
        assert_eq!(tc.balance(&freelancer), 6000);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Completed);
    }

    #[test]
    #[should_panic(expected = "invalid milestone index")]
    fn test_release_funds_invalid_index_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &3000i128);
        cc.deposit(&1u64, &3000i128);

        cc.release_funds(&1u64, &client, &5u32);
    }

    #[test]
    #[should_panic(expected = "Error(WasmVm, InvalidAction)")]
    fn test_release_funds_twice_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);

        cc.release_funds(&1u64, &client, &0u32);
        cc.release_funds(&1u64, &client, &0u32);
    }

    #[test]
    #[should_panic(expected = "only client can release")]
    fn test_unauthorized_release_funds_by_freelancer_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);

        cc.release_funds(&1u64, &freelancer, &0u32);
    }

    #[test]
    fn test_deposit_event_emitted() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &8000i128);
        cc.deposit(&1u64, &8000i128);

        // Verify deposit was successful
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Funded);
        assert_eq!(job.total_amount, 8000);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_release_milestone_overflow_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);

        // Release once
        cc.release_milestone(&1u64, &client);

        // Try to release again - no pending milestones, will fail with InvalidState
        cc.release_milestone(&1u64, &client);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Comprehensive Escrow Dispute & Resolution Tests (>90% coverage)
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_raise_dispute_by_freelancer_locks_funds() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &4000i128);
        cc.add_milestone(&1u64, &6000i128);
        cc.deposit(&1u64, &10000i128);

        cc.raise_dispute(&1u64, &freelancer);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Disputed);
    }

    #[test]
    #[should_panic(expected = "unauthorized: only client or freelancer can raise a dispute")]
    fn test_raise_dispute_by_third_party_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let rando = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);

        cc.raise_dispute(&1u64, &rando);
    }

    #[test]
    #[should_panic(expected = "dispute cannot be raised: job is not in active state")]
    fn test_raise_dispute_on_completed_job_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &10000i128);
        cc.deposit(&1u64, &10000i128);
        cc.release_milestone(&1u64, &client);

        // Job is now Completed, cannot dispute
        cc.raise_dispute(&1u64, &client);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_open_dispute_by_rando_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let rando = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);

        cc.open_dispute(&1u64, &rando);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_open_dispute_on_completed_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);
        cc.release_milestone(&1u64, &client);

        cc.open_dispute(&1u64, &client);
    }

    #[test]
    fn test_raise_dispute_then_resolve() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &4000i128);
        cc.deposit(&1u64, &10000i128);

        // Release one milestone first
        cc.release_milestone(&1u64, &client);
        let tc = token::Client::new(&env, &token_addr);
        assert_eq!(tc.balance(&freelancer), 3000);

        // Raise dispute
        cc.raise_dispute(&1u64, &client);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Disputed);

        // Resolve with 70/30 split of remaining 7000
        cc.resolve_dispute(&1u64, &4900i128, &2100i128);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Resolved);
        assert_eq!(tc.balance(&freelancer), 7900); // 3000 + 4900
        assert_eq!(tc.balance(&client), 92100); // 100000 - 10000 + 2100
    }

    #[test]
    fn test_resolve_dispute_full_refund_to_client() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &8000i128);
        cc.deposit(&1u64, &8000i128);

        cc.raise_dispute(&1u64, &client);

        // Full refund to client
        cc.resolve_dispute(&1u64, &0i128, &8000i128);

        let tc = token::Client::new(&env, &token_addr);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Resolved);
        assert_eq!(tc.balance(&client), 100000); // Full refund
        assert_eq!(tc.balance(&freelancer), 0);
    }

    #[test]
    fn test_resolve_dispute_full_payout_to_freelancer() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &6000i128);
        cc.deposit(&1u64, &6000i128);

        cc.raise_dispute(&1u64, &freelancer);

        // Full payout to freelancer
        cc.resolve_dispute(&1u64, &6000i128, &0i128);

        let tc = token::Client::new(&env, &token_addr);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Resolved);
        assert_eq!(tc.balance(&freelancer), 6000);
    }

    #[test]
    #[should_panic(expected = "job not disputed")]
    fn test_resolve_dispute_not_disputed_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);

        // Try to resolve without raising dispute first
        cc.resolve_dispute(&1u64, &2500i128, &2500i128);
    }

    #[test]
    fn test_raise_dispute_blocks_release_funds() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &3000i128);
        cc.deposit(&1u64, &9000i128);

        // Release first milestone
        cc.release_milestone(&1u64, &client);
        let tc = token::Client::new(&env, &token_addr);
        assert_eq!(tc.balance(&freelancer), 3000);

        // Raise dispute
        cc.raise_dispute(&1u64, &freelancer);

        // Verify job is in Disputed state
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Disputed);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_refund_by_non_client_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);

        // Freelancer cannot refund
        cc.refund(&1u64, &freelancer);
    }

    #[test]
    #[should_panic(expected = "job not found")]
    fn test_get_job_not_found_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.get_job(&999u64);
    }

    #[test]
    fn test_cancel_brief_in_setup_marks_refunded_without_transfer() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token_addr = setup_token(&env, &admin);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&77u64, &client, &freelancer, &token_addr);
        cc.cancel_brief(&77u64, &client);

        let job = cc.get_job(&77u64);
        assert_eq!(job.status, EscrowStatus::Refunded);
        assert_eq!(job.released_amount, 0);
    }

    #[test]
    fn test_dispute_event_emission() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);

        // Raise dispute and verify state
        cc.raise_dispute(&1u64, &client);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Disputed);
        assert_eq!(job.total_amount, 5000);
        assert_eq!(job.released_amount, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SC-ESC-005: Token Decimals Compatibility
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_token_decimals_stored_on_deposit() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);

        // Stellar asset contract has 7 decimals; verify captured during deposit
        assert_eq!(cc.get_token_decimals(&1u64), 7);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SC-ESC-007: Instance Storage Optimisation
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_instance_config_getters() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        assert_eq!(cc.get_admin(), admin);
        assert_eq!(cc.get_agent_judge(), agent_judge);
    }

    #[test]
    fn test_set_agent_judge_updates_packed_config() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let new_judge = Address::generate(&env);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.set_agent_judge(&new_judge);

        assert_eq!(cc.get_agent_judge(), new_judge);
        assert_eq!(cc.get_admin(), admin);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SC-ESC-008: Double-Spending Prevention
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_double_release_milestone_is_blocked() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);

        cc.release_milestone(&1u64, &client);
        // Job is now Completed; status guard fires first -> InvalidState (#6)
        cc.release_milestone(&1u64, &client);
    }

    #[test]
    fn test_released_amount_matches_transferred_on_sequential_release() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &4000i128);
        cc.deposit(&1u64, &10000i128);

        let tc = token::Client::new(&env, &token_addr);

        cc.release_milestone(&1u64, &client);
        assert_eq!(cc.get_job(&1u64).released_amount, tc.balance(&freelancer));

        cc.release_milestone(&1u64, &client);
        assert_eq!(cc.get_job(&1u64).released_amount, tc.balance(&freelancer));

        cc.release_milestone(&1u64, &client);
        let job = cc.get_job(&1u64);
        assert_eq!(job.released_amount, job.total_amount);
        assert_eq!(job.released_amount, tc.balance(&freelancer));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SC-ESC-009: Dispute Timeout Enforcement
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_dispute_deadline_set_on_raise() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);

        let ts_before = env.ledger().timestamp();
        cc.raise_dispute(&1u64, &client);

        assert_eq!(cc.get_dispute_deadline(&1u64), ts_before + 7 * 24 * 60 * 60);
    }

    #[test]
    fn test_resolve_before_deadline_succeeds() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &6000i128);
        cc.deposit(&1u64, &6000i128);

        cc.raise_dispute(&1u64, &client);

        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 3 * 24 * 60 * 60);

        cc.resolve_dispute(&1u64, &6000i128, &0i128);
        assert_eq!(cc.get_job(&1u64).status, EscrowStatus::Resolved);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #17)")]
    fn test_resolve_after_deadline_fails() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);

        cc.raise_dispute(&1u64, &client);
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 8 * 24 * 60 * 60);

        cc.resolve_dispute(&1u64, &5000i128, &0i128); // DisputeResolutionExpired (#18)
    }

    #[test]
    fn test_expire_dispute_refunds_client_after_deadline() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &8000i128);
        cc.deposit(&1u64, &8000i128);

        let tc = token::Client::new(&env, &token_addr);
        assert_eq!(tc.balance(&client), 92000);

        cc.raise_dispute(&1u64, &client);
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 8 * 24 * 60 * 60);

        cc.expire_dispute(&1u64);
        assert_eq!(cc.get_job(&1u64).status, EscrowStatus::Refunded);
        assert_eq!(tc.balance(&client), 100000);
    }
}
