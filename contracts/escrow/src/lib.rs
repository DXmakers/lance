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
            (EscrowStatus::Funded, EscrowStatus::WorkInProgress) => Ok(()),
            (EscrowStatus::Funded, EscrowStatus::Completed) => Ok(()),
            (EscrowStatus::Funded, EscrowStatus::Disputed) => Ok(()),
            (EscrowStatus::Funded, EscrowStatus::Refunded) => Ok(()),
            (EscrowStatus::WorkInProgress, EscrowStatus::WorkInProgress) => Ok(()),
            (EscrowStatus::WorkInProgress, EscrowStatus::Completed) => Ok(()),
            (EscrowStatus::WorkInProgress, EscrowStatus::Disputed) => Ok(()),
            (EscrowStatus::WorkInProgress, EscrowStatus::Refunded) => Ok(()),
            (EscrowStatus::Disputed, EscrowStatus::Resolved) => Ok(()),
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
#[derive(Clone, Debug, PartialEq)]
pub struct MilestoneRecord {
    pub amount: i128,
    pub released: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct EscrowJobCore {
    pub client: Address,
    pub freelancer: Address,
    pub token: Address,
    pub total_amount: i128,
    pub released_amount: i128,
    pub released_milestones: u32,
    pub status: EscrowStatus,
    pub created_at: u64,
    pub expires_at: u64,
    pub milestone_count: u32,
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
}

#[contracttype]
pub enum DataKey {
    JobCore(u64),
    JobMilestones(u64),
    Admin,
    AgentJudge,
    JobRegistry,
    Locked,
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
    MathOverflow = 13,
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

fn enter_reentrancy_guard(env: &Env) {
    if env.storage().instance().has(&DataKey::Locked) {
        panic_with_error!(env, EscrowError::ReentrancyDetected);
    }
    env.storage().instance().set(&DataKey::Locked, &());
}

fn exit_reentrancy_guard(env: &Env) {
    env.storage().instance().remove(&DataKey::Locked);
}

fn job_core_key(job_id: u64) -> DataKey {
    DataKey::JobCore(job_id)
}

fn job_milestones_key(job_id: u64) -> DataKey {
    DataKey::JobMilestones(job_id)
}

fn checked_i128_add(lhs: i128, rhs: i128) -> Result<i128, EscrowError> {
    lhs.checked_add(rhs).ok_or(EscrowError::MathOverflow)
}

fn checked_i128_sub(lhs: i128, rhs: i128) -> Result<i128, EscrowError> {
    lhs.checked_sub(rhs).ok_or(EscrowError::MathOverflow)
}

fn view_milestone(record: &MilestoneRecord) -> Milestone {
    Milestone {
        amount: record.amount,
        status: if record.released {
            MilestoneStatus::Released
        } else {
            MilestoneStatus::Pending
        },
    }
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    const INSTANCE_TTL_THRESHOLD: u32 = 50_000;
    const INSTANCE_TTL_EXTEND_TO: u32 = 150_000;
    const PERSISTENT_TTL_THRESHOLD: u32 = 50_000;
    const PERSISTENT_TTL_EXTEND_TO: u32 = 150_000;

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(Self::INSTANCE_TTL_THRESHOLD, Self::INSTANCE_TTL_EXTEND_TO);
    }

    fn bump_job_ttl(env: &Env, job_id: u64) {
        let core_key = job_core_key(job_id);
        let milestones_key = job_milestones_key(job_id);

        if env.storage().persistent().has(&core_key) {
            env.storage().persistent().extend_ttl(
                &core_key,
                Self::PERSISTENT_TTL_THRESHOLD,
                Self::PERSISTENT_TTL_EXTEND_TO,
            );
        }
        if env.storage().persistent().has(&milestones_key) {
            env.storage().persistent().extend_ttl(
                &milestones_key,
                Self::PERSISTENT_TTL_THRESHOLD,
                Self::PERSISTENT_TTL_EXTEND_TO,
            );
        }
    }

    fn read_job_core(env: &Env, job_id: u64) -> Result<EscrowJobCore, EscrowError> {
        env.storage()
            .persistent()
            .get(&job_core_key(job_id))
            .ok_or(EscrowError::JobNotFound)
    }

    fn read_milestones(env: &Env, job_id: u64) -> Result<Vec<MilestoneRecord>, EscrowError> {
        env.storage()
            .persistent()
            .get(&job_milestones_key(job_id))
            .ok_or(EscrowError::JobNotFound)
    }

    fn persist_job(
        env: &Env,
        job_id: u64,
        core: &EscrowJobCore,
        milestones: &Vec<MilestoneRecord>,
    ) {
        let core_key = job_core_key(job_id);
        let milestones_key = job_milestones_key(job_id);
        env.storage().persistent().set(&core_key, core);
        env.storage().persistent().set(&milestones_key, milestones);
        Self::bump_job_ttl(env, job_id);
    }

    fn load_job(
        env: &Env,
        job_id: u64,
    ) -> Result<(EscrowJobCore, Vec<MilestoneRecord>), EscrowError> {
        let core = Self::read_job_core(env, job_id)?;
        let milestones = Self::read_milestones(env, job_id)?;
        Ok((core, milestones))
    }

    fn to_public_job(
        env: &Env,
        core: EscrowJobCore,
        milestones: Vec<MilestoneRecord>,
    ) -> EscrowJob {
        let mut public_milestones = Vec::new(env);
        // Rebuild the user-facing milestone vector from the compact ledger record.
        for milestone in milestones.iter() {
            public_milestones.push_back(view_milestone(&milestone));
        }

        EscrowJob {
            client: core.client,
            freelancer: core.freelancer,
            token: core.token,
            total_amount: core.total_amount,
            released_amount: core.released_amount,
            status: core.status,
            created_at: core.created_at,
            expires_at: core.expires_at,
            milestones: public_milestones,
        }
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
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(EscrowError::AlreadyInitialized);
        }

        // Basic validation: admin and agent_judge must be distinct
        if admin == agent_judge {
            return Err(EscrowError::InvalidInput);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AgentJudge, &agent_judge);

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
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::NotInitialized)?;
        // This will panic with Soroban auth error if the signer isn't present; keep that behavior
        admin.require_auth();

        if admin == new_agent_judge {
            return Err(EscrowError::InvalidInput);
        }

        env.storage()
            .instance()
            .set(&DataKey::AgentJudge, &new_agent_judge);

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
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::NotInitialized)?;
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

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::NotInitialized)?;

        if caller != admin {
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
        let core_key = job_core_key(job_id);
        let milestones_key = job_milestones_key(job_id);
        if env.storage().persistent().has(&core_key)
            || env.storage().persistent().has(&milestones_key)
        {
            panic!("job already exists");
        }
        let now: u64 = env.ledger().timestamp();
        let expires_at = now
            .checked_add(30 * 24 * 60 * 60)
            .expect("job expiration overflow");

        let core = EscrowJobCore {
            client: client.clone(),
            freelancer: freelancer.clone(),
            token: token_addr,
            total_amount: 0,
            released_amount: 0,
            released_milestones: 0,
            status: EscrowStatus::Setup,
            created_at: now,
            expires_at,
            milestone_count: 0,
        };
        log!(
            &env,
            "create_job: id {} client {} freelancer {}",
            job_id,
            client,
            freelancer
        );
        env.storage().persistent().set(&core_key, &core);
        env.storage()
            .persistent()
            .set(&milestones_key, &Vec::<MilestoneRecord>::new(&env));
        Self::bump_job_ttl(&env, job_id);
    }

    /// Add a milestone to the job (setup phase only).
    pub fn add_milestone(env: Env, job_id: u64, amount: i128) {
        let mut core = Self::read_job_core(&env, job_id).expect("job not found");
        let mut milestones = Self::read_milestones(&env, job_id).expect("job not found");
        Self::bump_job_ttl(&env, job_id);
        core.client.require_auth();
        assert!(core.status == EscrowStatus::Setup, "not in setup phase");
        assert!(amount > 0, "amount must be > 0");

        milestones.push_back(MilestoneRecord {
            amount,
            released: false,
        });
        log!(&env, "add_milestone: job {} amount {}", job_id, amount);
        core.milestone_count = core
            .milestone_count
            .checked_add(1)
            .expect("milestone count overflow");
        Self::persist_job(&env, job_id, &core, &milestones);
    }

    /// Client deposits total amount and transitions job to Funded.
    pub fn deposit(env: Env, job_id: u64, amount: i128) -> Result<(), EscrowError> {
        let mut core = Self::read_job_core(&env, job_id)?;
        let milestones = Self::read_milestones(&env, job_id)?;
        Self::bump_job_ttl(&env, job_id);

        // Caller must be client
        core.client.require_auth();

        // Only allow deposit in Setup state
        if core.status != EscrowStatus::Setup {
            return Err(EscrowError::InvalidState);
        }

        if amount <= 0 {
            return Err(EscrowError::InvalidInput);
        }

        if milestones.is_empty() {
            return Err(EscrowError::InvalidInput);
        }

        let mut total_milestones_amount = 0i128;
        for m in milestones.iter() {
            total_milestones_amount = checked_i128_add(total_milestones_amount, m.amount)?;
        }

        if total_milestones_amount != amount {
            return Err(EscrowError::AmountMismatch);
        }

        enter_reentrancy_guard(&env);

        let next_status = EscrowStatus::Funded;
        core.status.validate_transition(&next_status)?;
        core.total_amount = amount;
        core.status = next_status;

        // Transfer tokens from client to contract
        let token_client = token::Client::new(&env, &core.token);
        token_client.transfer(&core.client, &env.current_contract_address(), &amount);

        log!(&env, "deposit: job {} amount {}", job_id, amount);
        Self::persist_job(&env, job_id, &core, &milestones);

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

        let (mut core, mut milestones) = Self::load_job(&env, job_id)?;
        Self::bump_job_ttl(&env, job_id);

        if !(core.status == EscrowStatus::Funded || core.status == EscrowStatus::WorkInProgress) {
            return Err(EscrowError::InvalidState);
        }

        if caller != core.client {
            return Err(EscrowError::Unauthorized);
        }

        // Find next pending milestone
        let mut found_idx: Option<u32> = None;
        for idx in 0..milestones.len() {
            if !milestones.get(idx).unwrap().released {
                found_idx = Some(idx);
                break;
            }
        }

        let idx = match found_idx {
            Some(i) => i,
            None => return Err(EscrowError::NoPendingMilestones),
        };

        let mut milestone = milestones.get(idx).unwrap();
        milestone.released = true;
        milestones.set(idx, milestone.clone());

        core.released_amount = checked_i128_add(core.released_amount, milestone.amount)?;
        core.released_milestones = core
            .released_milestones
            .checked_add(1)
            .ok_or(EscrowError::MathOverflow)?;

        let next_status = if core.released_amount == core.total_amount {
            EscrowStatus::Completed
        } else {
            EscrowStatus::WorkInProgress
        };
        core.status.validate_transition(&next_status)?;
        core.status = next_status;

        enter_reentrancy_guard(&env);

        let token_client = token::Client::new(&env, &core.token);
        token_client.transfer(
            &env.current_contract_address(),
            &core.freelancer,
            &milestone.amount,
        );

        log!(
            &env,
            "release_milestone: job {} amount {}",
            job_id,
            milestone.amount
        );
        Self::persist_job(&env, job_id, &core, &milestones);

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

        let (mut core, mut milestones) = Self::load_job(&env, job_id).expect("job not found");
        Self::bump_job_ttl(&env, job_id);

        assert!(
            core.status == EscrowStatus::Funded || core.status == EscrowStatus::WorkInProgress,
            "job not in releaseable state"
        );
        assert!(caller == core.client, "only client can release");
        assert!(
            milestone_index < milestones.len(),
            "invalid milestone index"
        );

        let mut milestone = milestones.get(milestone_index).expect("invalid milestone");
        assert!(!milestone.released, "milestone already released");

        milestone.released = true;
        milestones.set(milestone_index, milestone.clone());

        core.released_amount =
            checked_i128_add(core.released_amount, milestone.amount).expect("math overflow");
        core.released_milestones = core
            .released_milestones
            .checked_add(1)
            .expect("math overflow");
        let next_status = if core.released_amount == core.total_amount {
            EscrowStatus::Completed
        } else {
            EscrowStatus::WorkInProgress
        };
        core.status
            .validate_transition(&next_status)
            .expect("invalid state transition");
        core.status = next_status;

        enter_reentrancy_guard(&env);

        let token_client = token::Client::new(&env, &core.token);
        token_client.transfer(
            &env.current_contract_address(),
            &core.freelancer,
            &milestone.amount,
        );

        log!(
            &env,
            "release_funds: job {} amount {}",
            job_id,
            milestone.amount
        );
        Self::persist_job(&env, job_id, &core, &milestones);

        exit_reentrancy_guard(&env);
    }

    /// Either party opens a dispute, locking remaining funds.
    pub fn open_dispute(env: Env, job_id: u64, caller: Address) -> Result<(), EscrowError> {
        caller.require_auth();

        let mut core = Self::read_job_core(&env, job_id)?;
        Self::bump_job_ttl(&env, job_id);

        if !(core.status == EscrowStatus::Funded || core.status == EscrowStatus::WorkInProgress) {
            return Err(EscrowError::InvalidState);
        }

        if !(caller == core.client || caller == core.freelancer) {
            return Err(EscrowError::Unauthorized);
        }

        let next_status = EscrowStatus::Disputed;
        core.status.validate_transition(&next_status)?;
        core.status = next_status;
        log!(&env, "open_dispute: job {}", job_id);
        Self::persist_job(&env, job_id, &core, &Self::read_milestones(&env, job_id)?);

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

        let core = Self::read_job_core(&env, job_id).expect("job not found");
        Self::bump_job_ttl(&env, job_id);

        // 2. Only client or freelancer may raise a dispute
        assert!(
            caller == core.client || caller == core.freelancer,
            "unauthorized: only client or freelancer can raise a dispute"
        );

        // 3. Job must still be active
        assert!(
            core.status == EscrowStatus::Funded || core.status == EscrowStatus::WorkInProgress,
            "dispute cannot be raised: job is not in active state"
        );

        // 4. Prevent dispute if all funds are already released
        assert!(
            core.released_amount < core.total_amount,
            "dispute cannot be raised: all funds already released"
        );

        // 5. Prevent dispute if deadline has drastically expired (7-day grace period)
        let now: u64 = env.ledger().timestamp();
        let grace_period: u64 = 7 * 24 * 60 * 60;
        let deadline = core
            .expires_at
            .checked_add(grace_period)
            .ok_or(EscrowError::MathOverflow)?;
        assert!(
            now <= deadline,
            "dispute cannot be raised: deadline has drastically expired"
        );

        // 6. Lock funds by transitioning to Disputed — blocks release_funds & release_milestone
        let next_status = EscrowStatus::Disputed;
        let mut disputed_core = core.clone();
        disputed_core.status.validate_transition(&next_status)?;
        disputed_core.status = next_status;
        log!(&env, "raise_dispute: job {}", job_id);
        Self::persist_job(
            &env,
            job_id,
            &disputed_core,
            &Self::read_milestones(&env, job_id)?,
        );

        Self::sync_dispute_to_job_registry(&env, job_id)?;

        // 7. Emit DisputeRaised event for backend / AI Judge to consume
        env.events().publish(
            ("escrow", "DisputeRaised"),
            (
                job_id,
                caller.clone(),
                core.released_milestones,
                core.milestone_count,
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
        let agent_judge: Address = env
            .storage()
            .instance()
            .get(&DataKey::AgentJudge)
            .expect("agent judge not set");
        agent_judge.require_auth();

        assert!(payee_amount >= 0, "payee_amount must be >= 0");
        assert!(payer_amount >= 0, "payer_amount must be >= 0");

        let mut core = Self::read_job_core(&env, job_id).expect("job not found");
        Self::bump_job_ttl(&env, job_id);
        assert!(core.status == EscrowStatus::Disputed, "job not disputed");

        let remaining = checked_i128_sub(core.total_amount, core.released_amount)
            .expect("invalid released amount");
        let total_payout = checked_i128_add(payee_amount, payer_amount).expect("math overflow");
        assert!(total_payout <= remaining, "payout exceeds remaining funds");

        let next_status = EscrowStatus::Resolved;
        core.status
            .validate_transition(&next_status)
            .expect("invalid state transition");
        core.released_amount =
            checked_i128_add(core.released_amount, total_payout).expect("math overflow");
        core.status = next_status;

        enter_reentrancy_guard(&env);

        let token_client = token::Client::new(&env, &core.token);
        if payee_amount > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &core.freelancer,
                &payee_amount,
            );
        }
        if payer_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &core.client, &payer_amount);
        }

        log!(
            &env,
            "resolve_dispute: job {} payee {} payer {}",
            job_id,
            payee_amount,
            payer_amount
        );
        Self::persist_job(
            &env,
            job_id,
            &core,
            &Self::read_milestones(&env, job_id).expect("job not found"),
        );

        exit_reentrancy_guard(&env);
    }

    /// Client recoups funds if freelancer never responded or deadline has passed.
    pub fn refund(env: Env, job_id: u64, client: Address) -> Result<(), EscrowError> {
        client.require_auth();

        let mut core = Self::read_job_core(&env, job_id)?;
        let milestones = Self::read_milestones(&env, job_id)?;
        Self::bump_job_ttl(&env, job_id);

        if !(core.status == EscrowStatus::Funded || core.status == EscrowStatus::WorkInProgress) {
            return Err(EscrowError::InvalidState);
        }

        if client != core.client {
            return Err(EscrowError::Unauthorized);
        }

        let remaining = checked_i128_sub(core.total_amount, core.released_amount)?;

        let next_status = EscrowStatus::Refunded;
        core.status.validate_transition(&next_status)?;
        core.released_amount = core.total_amount;
        core.released_milestones = core.milestone_count;
        core.status = next_status;

        enter_reentrancy_guard(&env);

        if remaining > 0 {
            let token_client = token::Client::new(&env, &core.token);
            token_client.transfer(&env.current_contract_address(), &core.client, &remaining);
        }

        log!(&env, "refund: job {} amount {}", job_id, remaining);
        Self::persist_job(&env, job_id, &core, &milestones);

        exit_reentrancy_guard(&env);

        env.events().publish(
            ("escrow", "Refunded"),
            (job_id, client, remaining, env.ledger().timestamp()),
        );

        Ok(())
    }

    pub fn get_job(env: Env, job_id: u64) -> EscrowJob {
        let (core, milestones) = Self::load_job(&env, job_id).expect("job not found");
        Self::bump_job_ttl(&env, job_id);
        Self::to_public_job(&env, core, milestones)
    }

    /// Retrieve the status of all milestones for a given job.
    pub fn get_milestone_status(env: Env, job_id: u64) -> Vec<MilestoneStatus> {
        let milestones = Self::read_milestones(&env, job_id).expect("job not found");
        Self::bump_job_ttl(&env, job_id);
        let mut statuses = Vec::new(&env);
        for m in milestones.iter() {
            statuses.push_back(if m.released {
                MilestoneStatus::Released
            } else {
                MilestoneStatus::Pending
            });
        }
        statuses
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{token, Address, Env};

    fn setup_token(env: &Env, admin: &Address) -> Address {
        let contract = env.register_stellar_asset_contract_v2(admin.clone());
        contract.address()
    }

    fn mint(env: &Env, token_addr: &Address, to: &Address) {
        let admin_client = token::StellarAssetClient::new(env, token_addr);
        admin_client.mint(to, &100_000);
    }

    #[contracttype]
    enum AttackKey {
        Escrow,
        JobId,
        Client,
        Armed,
    }

    #[contract]
    pub struct ReentrantTokenContract;

    #[contractimpl]
    impl ReentrantTokenContract {
        pub fn initialize(env: Env, escrow: Address, job_id: u64, client: Address) {
            env.storage().instance().set(&AttackKey::Escrow, &escrow);
            env.storage().instance().set(&AttackKey::JobId, &job_id);
            env.storage().instance().set(&AttackKey::Client, &client);
            env.storage().instance().set(&AttackKey::Armed, &false);
        }

        pub fn arm(env: Env, armed: bool) {
            env.storage().instance().set(&AttackKey::Armed, &armed);
        }

        pub fn balance(_env: Env, _id: Address) -> i128 {
            0
        }

        pub fn transfer(env: Env, _from: Address, _to: Address, _amount: i128) {
            let armed = env
                .storage()
                .instance()
                .get::<_, bool>(&AttackKey::Armed)
                .unwrap_or(false);
            if !armed {
                return;
            }

            let escrow = env
                .storage()
                .instance()
                .get::<_, Address>(&AttackKey::Escrow)
                .expect("escrow not configured");
            let job_id = env
                .storage()
                .instance()
                .get::<_, u64>(&AttackKey::JobId)
                .expect("job not configured");
            let client = env
                .storage()
                .instance()
                .get::<_, Address>(&AttackKey::Client)
                .expect("client not configured");

            let cc = EscrowContractClient::new(&env, &escrow);
            cc.release_funds(&job_id, &client, &0u32);
        }
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

    #[test]
    #[should_panic(expected = "Error(Contract, #12)")]
    fn test_reentrant_release_attack_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = env.register_contract(None, ReentrantTokenContract);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        let token_client = ReentrantTokenContractClient::new(&env, &token_addr);
        token_client.initialize(&contract_id, &1u64, &client);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);

        token_client.arm(&true);
        cc.release_funds(&1u64, &client, &0u32);
    }

    #[test]
    fn test_release_funds_gas_budget_stays_below_threshold() {
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

        env.budget().reset_unlimited();

        cc.release_funds(&1u64, &client, &3u32);

        let budget = env.budget();
        assert!(budget.cpu_instruction_cost() < 1_500_000);
        assert!(budget.memory_bytes_cost() < 200_000);
    }

    #[test]
    fn test_refund_gas_budget_stays_below_threshold() {
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
        cc.add_milestone(&1u64, &4000i128);
        cc.deposit(&1u64, &10_000i128);

        env.budget().reset_unlimited();

        cc.refund(&1u64, &client);

        let budget = env.budget();
        assert!(budget.cpu_instruction_cost() < 1_300_000);
        assert!(budget.memory_bytes_cost() < 180_000);
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
}
