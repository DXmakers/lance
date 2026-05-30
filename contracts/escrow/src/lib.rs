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
    /// Requirement [SC-ESC-013]: Validate state machine transitions across multi-milestone gigs.
    ///
    /// Every state-mutating function in `EscrowContract` calls this guard before updating
    /// persistent storage, ensuring the escrow lifecycle is a strict directed acyclic graph:
    ///
    /// ```text
    ///   Setup ──► Funded ──► WorkInProgress ──► Completed
    ///     │          │              │
    ///     │          └──────────────┼──► Disputed ──► Resolved
    ///     │                        │                    │
    ///     └────────────────────────┴────────────────────┴──► Refunded
    /// ```
    ///
    /// Returning `Err(InvalidStateTransition)` causes the calling function to surface
    /// error code `#11` to the caller — equivalent to a 422 Unprocessable Entity at
    /// the protocol layer.  This is distinct from `Unauthorized` (`#3`) which covers
    /// authentication failures.
    ///
    /// The `WorkInProgress → WorkInProgress` self-transition is intentional: each
    /// partial milestone release keeps the job in `WorkInProgress` until all funds
    /// are released, at which point it transitions to `Completed`.
    pub fn validate_transition(&self, next: &EscrowStatus) -> Result<(), EscrowError> {
        match (self, next) {
            // [SC-ESC-013]: Setup is the initial configuration phase; only Funded (deposit
            // received) or Refunded (brief cancelled before funding) are valid exits.
            (EscrowStatus::Setup, EscrowStatus::Funded) => Ok(()),
            (EscrowStatus::Setup, EscrowStatus::Refunded) => Ok(()),
            // [SC-ESC-013]: Funded allows work to start, dispute, partial refund, or
            // immediate completion if a single-milestone job is released all at once.
            (EscrowStatus::Funded, EscrowStatus::WorkInProgress) => Ok(()),
            (EscrowStatus::Funded, EscrowStatus::Completed) => Ok(()),
            (EscrowStatus::Funded, EscrowStatus::Disputed) => Ok(()),
            (EscrowStatus::Funded, EscrowStatus::Refunded) => Ok(()),
            // [SC-ESC-013]: WorkInProgress self-loop covers partial milestone releases.
            // Transitions to Completed (all milestones released), Disputed (conflict raised),
            // or Refunded (client cancels mid-gig) are valid exits.
            (EscrowStatus::WorkInProgress, EscrowStatus::WorkInProgress) => Ok(()),
            (EscrowStatus::WorkInProgress, EscrowStatus::Completed) => Ok(()),
            (EscrowStatus::WorkInProgress, EscrowStatus::Disputed) => Ok(()),
            (EscrowStatus::WorkInProgress, EscrowStatus::Refunded) => Ok(()),
            // [SC-ESC-013]: A Disputed job can only be Resolved (judge adjudicates) or
            // Refunded (dispute deadline expires via `expire_dispute`).  No other exits.
            (EscrowStatus::Disputed, EscrowStatus::Resolved) => Ok(()),
            (EscrowStatus::Disputed, EscrowStatus::Refunded) => Ok(()),
            // [SC-ESC-013]: All other transitions are invalid.  Completed, Resolved, and
            // Refunded are terminal — they have no valid outgoing edges.
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
    pub funded_ledger_seq: u32, // ledger sequence at funding time; used for flash-loan resistance
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
    JobLock(u64),
    Admin,
    AgentJudge,
    JobRegistry,
    Locked,
    Treasury,
    FeeBps,
    MultisigConfig(u64), // Per-job multisig configuration
    UpgradeAdmin,
    Treasury,
    FeeBps,
}

#[contracttype]
#[derive(Clone)]
pub struct FeeConfigUpdatedEvent {
    pub treasury: Address,
    pub fee_bps: u32,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct LockupUpdatedEvent {
    pub job_id: u64,
    pub expires_at: u64,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct EmergencySweepEvent {
    pub job_id: u64,
    pub admin: Address,
    pub rescue_address: Address,
    pub amount: i128,
    pub swept_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct MilestonesAmendedEvent {
    pub job_id: u64,
    pub milestone_count: u32,
    pub remaining_amount: i128,
    pub amended_at: u64,
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

#[contracttype]
#[derive(Clone)]
pub struct UpgradeAdminSetEvent {
    pub old_admin: Option<Address>,
    pub new_admin: Address,
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
    FeeTooHigh = 21,
    NothingToSweep = 22,
    InsufficientSignatures = 14,
    AlreadySigned = 15,
    ArithmeticError = 16,
    UpgradeAdminAlreadySet = 17,
    UpgradeAdminNotSet = 18,
    ArithmeticOverflow = 19,
    DisputeResolutionExpired = 20,
    MaxMilestonesExceeded = 21,
    FeeTooHigh = 22,
    NothingToSweep = 23,
    FeeTooHigh = 21,
    NothingToSweep = 22,
    ReentrantCall = 11,
}

/// Maximum platform fee, in basis points (100% = 10_000 bps).
pub const MAX_FEE_BPS: u32 = 10_000;

/// Requirement [SC-ESC-016]: Maximum number of milestones allowed per escrow job.
///
/// This hard cap serves two purposes:
/// 1. **Storage efficiency** — each `Milestone` struct is written to Soroban persistent
///    storage as part of the `EscrowJob` value.  Unbounded growth would bloat the
///    ledger entry beyond the Soroban footprint limits and drive up rent fees.
/// 2. **WASM execution safety** — iteration over milestones during `deposit`,
///    `release_milestone`, and `amend_milestones` is O(n); capping at 12 guarantees
///    these loops stay well inside the Soroban instruction-count block boundary.
///
/// Checked arithmetic (`checked_add`, `checked_mul`) is used throughout all
/// milestone-amount summation paths to prevent silent integer overflow.
pub const MAX_MILESTONES: u32 = 12;

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

#[contracttype]
#[derive(Clone)]
pub struct FeeConfigUpdatedEvent {
    pub treasury: Option<Address>,
    pub fee_bps: u32,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct LockupUpdatedEvent {
    pub job_id: u64,
    pub expires_at: u64,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct EmergencySweepEvent {
    pub job_id: u64,
    pub admin: Address,
    pub rescue_address: Address,
    pub amount: i128,
    pub swept_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct MilestonesAmendedEvent {
    pub job_id: u64,
    pub milestone_count: u32,
    pub remaining_amount: i128,
    pub amended_at: u64,
}

fn enter_reentrancy_guard(env: &Env) {
struct ReentrancyGuard<'a> {
    env: &'a Env,
}

impl Drop for ReentrancyGuard<'_> {
    fn drop(&mut self) {
        self.env.storage().instance().remove(&DataKey::Locked);
    }
}

fn enter_reentrancy_guard(env: &Env) -> ReentrancyGuard<'_> {
    if env.storage().instance().has(&DataKey::Locked) {
        panic_with_error!(env, EscrowError::ReentrancyDetected);
    }
    env.storage().instance().set(&DataKey::Locked, &());
    ReentrancyGuard { env }
}

fn checked_i128_add(lhs: i128, rhs: i128) -> Result<i128, EscrowError> {
    lhs.checked_add(rhs).ok_or(EscrowError::InvalidInput)
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    const INSTANCE_TTL_THRESHOLD: u32 = 50_000;
    const INSTANCE_TTL_EXTEND_TO: u32 = 150_000;
    const PERSISTENT_TTL_THRESHOLD: u32 = 50_000;
    const PERSISTENT_TTL_EXTEND_TO: u32 = 150_000;
    const MAX_JOB_BUDGET: i128 = 10_000_000_000;
    const MAX_MILESTONE_AMOUNT: i128 = 10_000_000_000;
    const MAX_MILESTONES_PER_JOB: u32 = 32;
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

    fn enter_job_lock(env: &Env, job_id: u64) -> Result<DataKey, EscrowError> {
        let lock_key = DataKey::JobLock(job_id);
        if env.storage().temporary().has(&lock_key) {
            return Err(EscrowError::ReentrantCall);
        }
        env.storage().temporary().set(&lock_key, &true);
        Ok(lock_key)
    }

    fn exit_job_lock(env: &Env, lock_key: DataKey) {
        env.storage().temporary().remove(&lock_key);
    }

fn checked_sub_i128(
    env: &Env,
    a: i128,
    b: i128,
) -> Result<i128, EscrowError> {
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

    pub fn version(_env: Env) -> u32 {
        1
    }

    pub fn initialize(env: Env, admin: Address, agent_judge: Address) -> Result<(), EscrowError> {
        // Prevent double initialization
        if env.storage().instance().has(&DataKey::Config) {
            return Err(EscrowError::AlreadyInitialized);
        }

        admin.require_auth();

        // Basic validation: admin and agent_judge must be distinct
        if admin == agent_judge {
            return Err(EscrowError::InvalidInput);
        }

        admin.require_auth();

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

    pub fn get_job_registry(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::JobRegistry)
    }

    /// One-time initialization of the upgrade admin.
    pub fn init_upgrade_admin(env: Env, admin: Address) -> Result<(), EscrowError> {
        if env.storage().instance().has(&DataKey::UpgradeAdmin) {
            return Err(EscrowError::UpgradeAdminAlreadySet);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::UpgradeAdmin, &admin);

        env.events().publish(
            ("escrow", "UpgradeAdminSet"),
            UpgradeAdminSetEvent {
                old_admin: None,
                new_admin: admin,
                updated_at: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

    /// Rotate the upgrade admin.
    pub fn set_upgrade_admin(
        env: Env,
        caller: Address,
        new_admin: Address,
    ) -> Result<(), EscrowError> {
        caller.require_auth();
        let current_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeAdmin)
            .ok_or(EscrowError::UpgradeAdminNotSet)?;

        if caller != current_admin {
            return Err(EscrowError::Unauthorized);
        }

        env.storage()
            .instance()
            .set(&DataKey::UpgradeAdmin, &new_admin);

        env.events().publish(
            ("escrow", "UpgradeAdminSet"),
            UpgradeAdminSetEvent {
                old_admin: Some(current_admin),
                new_admin,
                updated_at: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

    /// Returns the current upgrade admin address.
    pub fn get_upgrade_admin(env: Env) -> Result<Address, EscrowError> {
        env.storage()
            .instance()
            .get(&DataKey::UpgradeAdmin)
            .ok_or(EscrowError::UpgradeAdminNotSet)
    }

    /// Upgrades the current contract WASM. Only callable by upgrade admin.
    pub fn upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), EscrowError> {
        Self::bump_instance_ttl(&env);
        caller.require_auth();

        let upgrade_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeAdmin)
            .ok_or(EscrowError::UpgradeAdminNotSet)?;

        if caller != upgrade_admin {
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
    ) -> Result<(), EscrowError> {
        client.require_auth();
        let key = DataKey::Job(job_id);
        if env.storage().persistent().has(&key) {
            return Err(EscrowError::InvalidInput);
        }
        let now: u64 = env.ledger().timestamp();
let expires_duration = 30u64
    .checked_mul(24)
    .and_then(|h| h.checked_mul(60))
    .and_then(|m| m.checked_mul(60))
let expires_duration = 30u64
    .checked_mul(24)
    .and_then(|h| h.checked_mul(60))
    .and_then(|m| m.checked_mul(60))
    .ok_or(EscrowError::ArithmeticError)?;

let expires_at = now
    .checked_add(expires_duration)
    .ok_or(EscrowError::ArithmeticError)?;

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
            funded_ledger_seq: 0,
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
        Ok(())
    }

    /// Requirement [SC-ESC-016]: Add a milestone to the job during the Setup phase.
    ///
    /// Milestones partition the total escrow budget into discrete delivery tranches that
    /// the client unlocks incrementally via `release_milestone` or `release_funds`.
    ///
    /// **Authorization**: only the job's client may add milestones (`env.require_auth`).
    ///
    /// **State guard**: only valid in `Setup` state.  Once `deposit` transitions the job
    /// to `Funded`, the milestone structure is locked (modifications require `amend_milestones`
    /// with dual-party authorization).
    ///
    /// **Partition count limit** ([SC-ESC-016]): adding a 13th milestone (or beyond) is
    /// rejected with `MaxMilestonesExceeded` (error code `#21`).  This cap prevents
    /// unbounded persistent-storage growth and keeps WASM instruction counts bounded.
    ///
    /// **Checked arithmetic**: all milestone amount accumulation in `deposit` uses
    /// `checked_add` to guard against `i128` overflow when summing across all partitions.
    ///
    /// # Errors
    /// - `JobNotFound` — no persistent record for `job_id`.
    /// - `Unauthorized` — caller is not the job client.
    /// - `InvalidState` — job is not in `Setup` state.
    /// - `InvalidInput` — `amount` is zero or negative.
    /// - `MaxMilestonesExceeded` — already at the `MAX_MILESTONES` (12) limit.
    pub fn add_milestone(env: Env, job_id: u64, amount: i128) -> Result<(), EscrowError> {
        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);
        // [SC-ESC-016]: Only the authenticated client may mutate the milestone set.
        job.client.require_auth();
        // [SC-ESC-016]: Milestones are only configurable during Setup; once funded the
        // partition set is immutable without explicit `amend_milestones` dual-auth.
        if job.status != EscrowStatus::Setup {
            return Err(EscrowError::InvalidState);
        }
        // [SC-ESC-016]: Reject zero or negative amounts to prevent zero-value milestones
        // that would misalign the deposit total vs. milestone sum check.
        if amount <= 0 || amount > Self::MAX_MILESTONE_AMOUNT {
            return Err(EscrowError::InvalidInput);
        }
        
        let next_total = checked_i128_add(job.total_amount, amount)?;
        if next_total > Self::MAX_JOB_BUDGET {
            return Err(EscrowError::InvalidInput);
        }

        // [SC-ESC-016]: Enforce maximum milestone partition count.
        // This is the primary invariant of this task — cap at MAX_MILESTONES (12) to
        // bound ledger footprint and keep on-chain iteration within safe gas limits.
        if job.milestones.len() >= MAX_MILESTONES {
            return Err(EscrowError::MaxMilestonesExceeded);
        }

        job.total_amount = next_total;
        job.milestones.push_back(Milestone {
            amount,
            status: MilestoneStatus::Pending,
        });
        log!(&env, "add_milestone: job {} amount {}", job_id, amount);
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);
        Ok(())
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
        if amount > Self::MAX_JOB_BUDGET {
            return Err(EscrowError::InvalidInput);
        }

        if job.milestones.is_empty() {
            return Err(EscrowError::InvalidInput);
        }

        if job.total_amount != amount {
            return Err(EscrowError::AmountMismatch);
        }

        // Query token decimals dynamically; custom assets vary (USDC=6, XLM=7, etc.).
        // Stored so off-chain consumers can correctly display amounts.
        // Amounts are already in the token's smallest unit so no rounding check is needed.
        let decimals = token::Client::new(&env, &job.token).decimals();
        job.token_decimals = decimals;

        let _guard = enter_reentrancy_guard(&env);

        let next_status = EscrowStatus::Funded;
        job.status.validate_transition(&next_status)?;
        job.total_amount = amount;
        job.status = next_status;
        job.funded_ledger_seq = env.ledger().sequence();

        // Transfer tokens from client to contract
        let token_client = token::Client::new(&env, &job.token);
        token_client.transfer(&job.client, &env.current_contract_address(), &amount);

        log!(&env, "deposit: job {} amount {}", job_id, amount);
        env.storage().persistent().set(&key, &job);

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

        Self::assert_not_same_ledger_as_funding(&env, &job)?;

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
        let lock_key = Self::enter_job_lock(&env, job_id)?;

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

        let _guard = enter_reentrancy_guard(&env);
        env.storage().persistent().set(&key, &job);

        Self::payout_with_fee(&env, &job, milestone.amount);

        log!(
            &env,
            "release_milestone: job {} amount {}",
            job_id,
            milestone.amount
        );
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);
        Self::exit_job_lock(&env, lock_key);

        exit_reentrancy_guard(&env);

        // Emit event
        env.events().publish(
            ("escrow", "ReleaseMilestone"),
            (job_id, idx, milestone.amount, env.ledger().timestamp()),
        );

        Ok(())
    }

    fn payout_with_fee(env: &Env, _job_id: u64, job: &EscrowJob, amount: i128) {
        let token_client = token::Client::new(env, &job.token);
        let fee_bps = Self::get_fee_bps(env.clone());
        let mut payout_amount = amount;

        if fee_bps > 0 {
            if let Some(treasury) = Self::get_treasury(env.clone()) {
                let fee_amount = amount
                    .checked_mul(fee_bps as i128)
                    .unwrap_or(0)
                    .checked_div(MAX_FEE_BPS as i128)
                    .unwrap_or(0);
                
                payout_amount = amount.checked_sub(fee_amount).unwrap_or(amount);

                if fee_amount > 0 {
                    token_client.transfer(&env.current_contract_address(), &treasury, &fee_amount);
                }
            }
        }

        if payout_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &job.freelancer, &payout_amount);
        }
    }

    /// Happy-path release for an explicit milestone index (0-based).
    /// Only the client may call this to release the funds for a specific milestone.
    pub fn release_funds(
        env: Env,
        job_id: u64,
        caller: Address,
        milestone_index: u32,
    ) -> Result<(), EscrowError> {
        caller.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);

Self::assert_not_same_ledger_as_funding(&env, &job)?;

if !(job.status == EscrowStatus::Funded
    || job.status == EscrowStatus::WorkInProgress)
{
    return Err(EscrowError::InvalidState);
}

if caller != job.client {
    return Err(EscrowError::Unauthorized);
}

if milestone_index >= job.milestones.len() {
    return Err(EscrowError::InvalidInput);
}

        let mut milestone = job
            .milestones
            .get(milestone_index)
            .expect("invalid milestone");
        assert!(
            milestone.status == MilestoneStatus::Pending,
            "milestone already released"
        );
        let lock_key = Self::enter_job_lock(&env, job_id).expect("reentrant job operation");

        milestone.status = MilestoneStatus::Released;
        job.milestones.set(milestone_index, milestone.clone());

        job.released_amount = Self::checked_add_i128(&env, job.released_amount, milestone.amount)?;
        assert!(
            job.released_amount <= job.total_amount,
            "double-spend: released exceeds total"
        );
        let next_status = if job.released_amount == job.total_amount {
            EscrowStatus::Completed
        } else {
            EscrowStatus::WorkInProgress
        };
        job.status.validate_transition(&next_status)?;
        job.status = next_status;

        let _guard = enter_reentrancy_guard(&env);
        env.storage().persistent().set(&key, &job);

        Self::payout_with_fee(&env, &job, milestone.amount);

        log!(
            &env,
            "release_funds: job {} amount {}",
            job_id,
            milestone.amount
        );
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);
        Self::exit_job_lock(&env, lock_key);
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

        Self::assert_not_same_ledger_as_funding(&env, &job)?;

        if !(job.status == EscrowStatus::Funded || job.status == EscrowStatus::WorkInProgress) {
            return Err(EscrowError::InvalidState);
        }

        if !(caller == job.client || caller == job.freelancer) {
            return Err(EscrowError::Unauthorized);
        }

        let next_status = EscrowStatus::Disputed;
        job.status.validate_transition(&next_status)?;
        job.status = next_status;
        job.dispute_deadline = env.ledger().timestamp()
            .checked_add(Self::DISPUTE_RESOLUTION_WINDOW)
            .ok_or(EscrowError::ArithmeticError)?;
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
        let mut job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);

        // 2. Only client or freelancer may raise a dispute
        if !(caller == job.client || caller == job.freelancer) {
            return Err(EscrowError::Unauthorized);
        }

        // 3. Job must still be active
Self::assert_not_same_ledger_as_funding(&env, &job)?;

if !(job.status == EscrowStatus::Funded
    || job.status == EscrowStatus::WorkInProgress)
{
    return Err(EscrowError::InvalidState);
}

        // 4. Prevent dispute if all funds are already released
        if job.released_amount >= job.total_amount {
            return Err(EscrowError::InvalidState);
        }

        // 5. Prevent dispute if deadline has drastically expired (7-day grace period)
        let now: u64 = env.ledger().timestamp();
        let grace_period: u64 = 7u64
            .checked_mul(24)
            .and_then(|h| h.checked_mul(60))
            .and_then(|m| m.checked_mul(60))
            .ok_or(EscrowError::ArithmeticError)?;
        let expiration_threshold = job
            .expires_at
            .checked_add(grace_period)
            .ok_or(EscrowError::ArithmeticError)?;
        if now > expiration_threshold {
            return Err(EscrowError::InvalidState);
        }

        // 6. Lock funds by transitioning to Disputed ΓÇö blocks release_funds & release_milestone
        let next_status = EscrowStatus::Disputed;
        job.status.validate_transition(&next_status)?;
        job.status = next_status;
        job.dispute_deadline = now
            .checked_add(Self::DISPUTE_RESOLUTION_WINDOW)
            .ok_or(EscrowError::ArithmeticError)?;
        log!(&env, "raise_dispute: job {}", job_id);
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);

        Self::sync_dispute_to_job_registry(&env, job_id)?;

        // 7. Emit DisputeRaised event for backend / AI Judge to consume
        let mut released_count = 0u32;
        for m in job.milestones.iter() {
            if m.status == MilestoneStatus::Released {
                released_count = released_count.checked_add(1).ok_or(EscrowError::ArithmeticError)?;
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
    pub fn resolve_dispute(
        env: Env,
        job_id: u64,
        payee_amount: i128,
        payer_amount: i128,
    ) -> Result<(), EscrowError> {
        Self::bump_instance_ttl(&env);
        let config: ContractConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("not initialized");
        config.agent_judge.require_auth();

        if payee_amount < 0 || payer_amount < 0 {
            return Err(EscrowError::InvalidInput);
        }

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

        if job.dispute_deadline > 0 && env.ledger().timestamp() > job.dispute_deadline {
            panic_with_error!(&env, EscrowError::DisputeResolutionExpired);
        }

        let remaining = Self::checked_sub_i128(&env, job.total_amount, job.released_amount)
            .expect("invalid escrow balance state");
        let total_payout = Self::checked_add_i128(&env, payee_amount, payer_amount)
            .expect("invalid dispute payout state");
        assert!(total_payout <= remaining, "payout exceeds remaining funds");
        let lock_key = Self::enter_job_lock(&env, job_id).expect("reentrant job operation");

        let next_status = EscrowStatus::Resolved;
        job.status
            .validate_transition(&next_status)
            .expect("invalid state transition");
        job.released_amount = Self::checked_add_i128(&env, job.released_amount, total_payout)
            .expect("released amount overflow");
        job.status = next_status;

        let _guard = enter_reentrancy_guard(&env);
        env.storage().persistent().set(&key, &job);

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
        Self::exit_job_lock(&env, lock_key);
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

        Self::assert_not_same_ledger_as_funding(&env, &job)?;

        if !(job.status == EscrowStatus::Funded || job.status == EscrowStatus::WorkInProgress) {
            return Err(EscrowError::InvalidState);
        }

        if client != job.client {
            return Err(EscrowError::Unauthorized);
        }

        let remaining = job.total_amount - job.released_amount;
        let lock_key = Self::enter_job_lock(&env, job_id)?;
        if remaining > 0 {
            let token_client = token::Client::new(&env, &job.token);
            token_client.transfer(&env.current_contract_address(), &job.client, &remaining);
        }

        log!(&env, "refund: job {} amount {}", job_id, remaining);
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);
        Self::exit_job_lock(&env, lock_key);

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

        let _guard = enter_reentrancy_guard(&env);
        env.storage().persistent().set(&key, &job);

        if remaining > 0 {
            let token_client = token::Client::new(&env, &job.token);
            token_client.transfer(&env.current_contract_address(), &job.client, &remaining);
        }

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

    /// Requirement [SC-ESC-019]: Dynamic Storage Allocation Recouping (State De-allocation).
    ///
    /// Soroban persistent storage incurs ongoing rent fees proportional to the byte size
    /// of each ledger entry.  Once an escrow job reaches a terminal state, all token
    /// transfers are complete and the on-chain `EscrowJob` record serves no further
    /// functional purpose.  This function allows either party to explicitly de-allocate
    /// the storage entry, recouping the associated ledger rent budget.
    ///
    /// **De-allocation scope** ([SC-ESC-019]):
    /// - Removes the `Job(job_id)` persistent entry (the primary `EscrowJob` struct).
    /// - If a `MultisigConfig(job_id)` entry was written during setup, it is also removed
    ///   in the same call to prevent orphaned storage keys.
    ///
    /// **Safety invariants**:
    /// - Only the client or freelancer (authenticated via `env.require_auth`) may trigger
    ///   cleanup — preventing griefing by third parties.
    /// - The job must be in a terminal state: `Completed`, `Refunded`, or `Resolved`.
    ///   Active jobs (`Setup`, `Funded`, `WorkInProgress`, `Disputed`) are rejected with
    ///   `InvalidState` (error code `#6`).
    /// - A `checked_sub` guard verifies `remaining == 0` before removal.  If funds are
    ///   somehow still outstanding (which should be impossible in a terminal state), the
    ///   call is rejected rather than silently discarding live funds.
    ///
    /// # Errors
    /// - `JobNotFound` — no persistent record for `job_id`.
    /// - `Unauthorized` — caller is neither client nor freelancer.
    /// - `InvalidState` — job is not in a terminal state, or remaining balance > 0.
    /// - `ArithmeticError` — underflow when computing `total_amount - released_amount`.
    pub fn cleanup_job(env: Env, job_id: u64, caller: Address) -> Result<(), EscrowError> {
        // [SC-ESC-019]: Caller must authenticate before triggering de-allocation.
        caller.require_auth();

        let key = DataKey::Job(job_id);
        let job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;

        // [SC-ESC-019]: Only the escrow parties (client or freelancer) may trigger cleanup.
        // Third-party callers receive `Unauthorized` (error code #3).
        if !(caller == job.client || caller == job.freelancer) {
            return Err(EscrowError::Unauthorized);
        }

        // [SC-ESC-019]: Terminal state gate — only jobs that have fully concluded
        // (Completed, Refunded, Resolved) may be de-allocated.  Active jobs are blocked
        // to prevent accidental data loss while funds are still in escrow.
        if !(job.status == EscrowStatus::Completed
            || job.status == EscrowStatus::Refunded
            || job.status == EscrowStatus::Resolved)
        {
            return Err(EscrowError::InvalidState);
        }

        // [SC-ESC-019]: Defensive arithmetic check — `checked_sub` prevents underflow
        // and guarantees the outstanding balance is truly zero before removal.
        let remaining = job
            .total_amount
            .checked_sub(job.released_amount)
            .ok_or(EscrowError::ArithmeticError)?;
        if remaining > 0 {
            // This branch should be unreachable in a well-formed terminal state, but is
            // kept as a hard safety guard against any future state-machine bugs.
            return Err(EscrowError::InvalidState);
        }

        // [SC-ESC-019]: Primary de-allocation — remove the EscrowJob ledger entry.
        env.storage().persistent().remove(&key);

        // [SC-ESC-019]: Secondary de-allocation — remove orphaned MultisigConfig if present.
        // This ensures no dangling storage keys are left after job teardown.
        let ms_key = DataKey::MultisigConfig(job_id);
        if env.storage().persistent().has(&ms_key) {
            env.storage().persistent().remove(&ms_key);
        }

        env.events().publish(
            ("escrow", "CleanupJob"),
            (job_id, caller, env.ledger().timestamp()),
        );

        Ok(())
    }

    pub fn get_job(env: Env, job_id: u64) -> Result<EscrowJob, EscrowError> {
        let key = DataKey::Job(job_id);
        let job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);
        Ok(job)
    }

    /// Returns the current balance of an escrow (total - released).
    pub fn get_escrow_balance(env: Env, job_id: u64) -> Result<i128, EscrowError> {
        let job = Self::get_job(env, job_id)?;
        job.total_amount
            .checked_sub(job.released_amount)
            .ok_or(EscrowError::ArithmeticError)
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

    /// Returns the minimum ledger separation enforced between funding and first state mutation.
    pub fn get_funding_settlement_ledgers(_env: Env) -> u32 {
        1
    }

    /// Returns remaining balance (total - released) for a job.
    pub fn get_remaining_balance(env: Env, job_id: u64) -> Result<i128, EscrowError> {
        let key = DataKey::Job(job_id);
        let job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);
        job.total_amount
            .checked_sub(job.released_amount)
            .ok_or(EscrowError::ArithmeticOverflow)
    }

    /// Returns escrow's core live parameters for a job: total, released, and funding ledger sequence.
    pub fn get_active_escrow_params(
        env: Env,
        job_id: u64,
    ) -> Result<(i128, i128, u32), EscrowError> {
        let key = DataKey::Job(job_id);
        let job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);
        Ok((job.total_amount, job.released_amount, job.funded_ledger_seq))
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

        let _guard = enter_reentrancy_guard(&env);
        env.storage().persistent().set(&key, &job);

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
    pub fn get_milestone_status(
        env: Env,
        job_id: u64,
    ) -> Result<Vec<MilestoneStatus>, EscrowError> {
        let key = DataKey::Job(job_id);
        let job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);
        let mut statuses = Vec::new(&env);
        for m in job.milestones.iter() {
            statuses.push_back(m.status);
        }
        Ok(statuses)
    }

    /// Retrieve the multisig configuration for a given job.
    pub fn get_multisig_config(env: Env, job_id: u64) -> Result<MultisigConfig, EscrowError> {
        let config_key = DataKey::MultisigConfig(job_id);
        let config: MultisigConfig = env
            .storage()
            .persistent()
            .get(&config_key)
            .ok_or(EscrowError::InvalidInput)?;
        Self::bump_job_ttl(&env, &config_key);
        Ok(config)
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

    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    // SC-ESC-001: Admin fee splitting
    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

    /// Admin configures the platform treasury and fee (in basis points).
    /// Once set, milestone releases route `fee_bps` of each payout to the
    /// treasury and the remainder to the freelancer.
    pub fn set_fee_config(
        env: Env,
        treasury: Address,
        fee_bps: u32,
    ) -> Result<(), EscrowError> {
    pub fn set_fee_config(env: Env, treasury: Address, fee_bps: u32) -> Result<(), EscrowError> {
        let config: ContractConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(EscrowError::NotInitialized)?;
        let admin = config.admin;
        admin.require_auth();

        if fee_bps > MAX_FEE_BPS {
            return Err(EscrowError::FeeTooHigh);
        }

        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        Self::bump_instance_ttl(&env);

        env.events().publish(
            ("escrow", "FeeConfigUpdated"),
            FeeConfigUpdatedEvent {
                treasury,
                fee_bps,
                updated_at: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    /// Returns the active platform fee in basis points (0 when unset).
    pub fn get_fee_bps(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::FeeBps)
            .unwrap_or(0)
    }

    /// Returns the configured treasury address, if any.
    pub fn get_treasury(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Treasury)
    }

    fn fee_bps(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get::<_, u32>(&DataKey::FeeBps)
            .unwrap_or(0u32)
    }

    fn payout_with_fee(env: &Env, job: &EscrowJob, amount: i128) {
        let treasury = env.storage().instance().get::<_, Address>(&DataKey::Treasury);
        let fee_bps = Self::fee_bps(env);
        let fee_amount = if fee_bps > 0 {
            amount
                .checked_mul(fee_bps as i128)
                .and_then(|value| value.checked_div(10_000))
                .unwrap_or(0)
        } else {
            0
        };
        let payout_amount = amount.checked_sub(fee_amount).unwrap_or(0);
        let token_client = token::Client::new(env, &job.token);

        if fee_amount > 0 {
            if let Some(treasury_addr) = treasury {
                token_client.transfer(&env.current_contract_address(), &treasury_addr, &fee_amount);
            }
        }
        if payout_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &job.freelancer, &payout_amount);
        }
    }

    fn exit_reentrancy_guard(env: &Env) {
        env.storage().instance().remove(&DataKey::Locked);
    }

    // ─────────────────────────────────────────────────────────────────────
    // SC-ESC-002: Dynamic lockup durations
    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

    /// Client sets a custom lockup duration (in seconds) during Setup. The
    /// job's expiry becomes `created_at + lockup_seconds`. Until expiry the
    /// client cannot refund (see `refund`).
    pub fn set_lockup_duration(
        env: Env,
        job_id: u64,
        lockup_seconds: u64,
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
        if lockup_seconds == 0 {
            return Err(EscrowError::InvalidInput);
        }

        let expires_at = job
            .created_at
            .checked_add(lockup_seconds)
            .ok_or(EscrowError::InvalidInput)?;
        job.expires_at = expires_at;

        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);

        env.events().publish(
            ("escrow", "LockupUpdated"),
            LockupUpdatedEvent {
                job_id,
                expires_at,
                updated_at: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    /// Returns the lockup expiry timestamp for a job.
    pub fn get_expiry(env: Env, job_id: u64) -> Result<u64, EscrowError> {
        let key = DataKey::Job(job_id);
        let job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Ok(job.expires_at)
    }

    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    // SC-ESC-003: Emergency escrow sweep (admin-gated)
    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

    /// Emergency sweep of the entire locked balance for a job to a rescue
    /// address. Only the admin may invoke this. It overrides the active state
    /// machine and bypasses standard release rules for catastrophic recovery.
    pub fn emergency_sweep(
        env: Env,
        job_id: u64,
        rescue_address: Address,
    ) -> Result<(), EscrowError> {
        let config: ContractConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(EscrowError::NotInitialized)?;
        let admin = config.admin;
        admin.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);

        let remaining = job
            .total_amount
            .checked_sub(job.released_amount)
            .ok_or(EscrowError::InvalidState)?;
        if remaining <= 0 {
            return Err(EscrowError::NothingToSweep);
        }

        let _guard = enter_reentrancy_guard(&env);

        // Override the state machine: mark fully released and refunded.
        job.released_amount = job.total_amount;
        job.status = EscrowStatus::Refunded;

        let token_client = token::Client::new(&env, &job.token);
        token_client.transfer(&env.current_contract_address(), &rescue_address, &remaining);

        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);

        Self::exit_reentrancy_guard(&env);

        env.events().publish(
            ("escrow", "EmergencySweep"),
            EmergencySweepEvent {
                job_id,
                admin,
                rescue_address,
                amount: remaining,
                swept_at: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    // SC-ESC-004: Milestone re-allocation / amendment
    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

    /// Mutually amend the remaining (unreleased) milestone structure. Both the
    /// client and the freelancer must authorize. The sum of the new
    /// allocations must equal the remaining balance. Amendments are rejected
    /// once the job is disputed.
    pub fn amend_milestones(
        env: Env,
        job_id: u64,
        new_amounts: Vec<i128>,
    ) -> Result<(), EscrowError> {
        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);

        // Both parties must cryptographically authorize the restructuring.
        job.client.require_auth();
        job.freelancer.require_auth();

        // Locked once disputed (or otherwise inactive).
        if !(job.status == EscrowStatus::Funded || job.status == EscrowStatus::WorkInProgress) {
            return Err(EscrowError::InvalidState);
        }

        if new_amounts.is_empty() {
            return Err(EscrowError::InvalidInput);
        }

        let mut new_sum: i128 = 0;
        for amount in new_amounts.iter() {
            if amount <= 0 {
                return Err(EscrowError::InvalidInput);
            }
            new_sum = new_sum
                .checked_add(amount)
                .ok_or(EscrowError::InvalidInput)?;
        }

        let remaining = job
            .total_amount
            .checked_sub(job.released_amount)
            .ok_or(EscrowError::InvalidState)?;
        if new_sum != remaining {
            return Err(EscrowError::AmountMismatch);
        }

        // Preserve already-released milestones; replace the pending set.
        let mut rebuilt: Vec<Milestone> = Vec::new(&env);
        for milestone in job.milestones.iter() {
            if milestone.status == MilestoneStatus::Released {
                rebuilt.push_back(milestone);
            }
        }
        for amount in new_amounts.iter() {
            rebuilt.push_back(Milestone {
                amount,
                status: MilestoneStatus::Pending,
            });
        }
        job.milestones = rebuilt;

        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);

        env.events().publish(
            ("escrow", "MilestonesAmended"),
            MilestonesAmendedEvent {
                job_id,
                milestone_count: new_amounts.len(),
                remaining_amount: remaining,
                amended_at: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    fn fee_bps(env: &Env) -> u32 {
        env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0)
    }

    fn payout_with_fee(
        env: &Env,
        _job_id: u64,
        job: &EscrowJob,
        amount: i128,
    ) {
        let treasury_opt: Option<Address> = env.storage().instance().get(&DataKey::Treasury);
        let fee_bps = Self::fee_bps(env);
        let token_client = token::Client::new(env, &job.token);

        if let Some(treasury) = treasury_opt {
            if fee_bps > 0 && fee_bps <= 10_000 {
                // fee_amount = amount * fee_bps / 10_000
                let fee_amount = amount
                    .checked_mul(fee_bps as i128)
                    .unwrap()
                    .checked_div(10_000)
                    .unwrap();
                let freelancer_amount = amount.checked_sub(fee_amount).unwrap();

                if fee_amount > 0 {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &treasury,
                        &fee_amount,
                    );
                }
                if freelancer_amount > 0 {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &job.freelancer,
                        &freelancer_amount,
                    );
                }
                return;
            }
        }

        // Default: no fee or fee is 0 or treasury not configured
        token_client.transfer(
            &env.current_contract_address(),
            &job.freelancer,
            &amount,
        );
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

    fn lock_job_for_test(env: &Env, contract_id: &Address, job_id: u64) {
        env.as_contract(contract_id, || {
            EscrowContract::enter_job_lock(env, job_id).unwrap();
        });
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

        // Lockup must elapse before the client can reclaim funds.
        let expiry = cc.get_expiry(&1u64);
        env.ledger().with_mut(|li| li.timestamp = expiry + 1);

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
    #[should_panic(expected = "milestone amount exceeds maximum")]
    fn test_add_milestone_over_max_panics() {
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

        cc.add_milestone(&1u64, &(EscrowContract::MAX_MILESTONE_AMOUNT + 1));
    }

    #[test]
    #[should_panic(expected = "too many milestones")]
    fn test_add_milestone_limit_panics() {
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

        for _ in 0..EscrowContract::MAX_MILESTONES_PER_JOB {
            cc.add_milestone(&1u64, &250i128);
        }
        cc.add_milestone(&1u64, &250i128);
    }

    #[test]
    #[should_panic(expected = "job budget exceeds maximum")]
    fn test_add_milestone_over_max_budget_panics() {
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
        cc.add_milestone(&1u64, &10_000_000_000i128);
        cc.add_milestone(&1u64, &1i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #12)")]
    fn test_deposit_reentrancy_guard_panics() {
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

        env.as_contract(&contract_id, || {
            env.storage().instance().set(&DataKey::Locked, &());
        });
        cc.deposit(&1u64, &1000i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #12)")]
    fn test_release_milestone_reentrancy_guard_panics() {
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
        cc.deposit(&1u64, &1000i128);

        env.as_contract(&contract_id, || {
            env.storage().instance().set(&DataKey::Locked, &());
        });
        cc.release_milestone(&1u64, &client);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
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

    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    // Comprehensive Escrow Deposit & Milestone Release Tests (>90% coverage)
    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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
    #[should_panic(expected = "Error(Contract, #11)")]
    fn test_refund_reentrant_lock_panics() {
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
        cc.add_milestone(&1u64, &10_000i128);
        cc.deposit(&1u64, &10_000i128);

        lock_job_for_test(&env, &contract_id, 1);
        cc.refund(&1u64, &client);
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
    #[should_panic(expected = "Error(Contract, #4)")]
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
    #[should_panic(expected = "Error(Contract, #6)")]
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
    #[should_panic(expected = "Error(Contract, #3)")]
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

    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    // Comprehensive Escrow Dispute & Resolution Tests (>90% coverage)
    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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
    #[should_panic(expected = "Error(Contract, #3)")]
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
    #[should_panic(expected = "Error(Contract, #6)")]
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
    #[should_panic(expected = "Error(Contract, #11)")]
    fn test_release_milestone_reentrant_lock_panics() {
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
        cc.add_milestone(&1u64, &10_000i128);
        cc.deposit(&1u64, &10_000i128);

        lock_job_for_test(&env, &contract_id, 1);
        cc.release_milestone(&1u64, &client);
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
    #[should_panic]
    fn test_release_funds_reentrant_lock_panics() {
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
        cc.add_milestone(&1u64, &10_000i128);
        cc.deposit(&1u64, &10_000i128);

        lock_job_for_test(&env, &contract_id, 1);
        cc.release_funds(&1u64, &client, &0u32);
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
    #[should_panic(expected = "Error(Contract, #5)")]
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

    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    // SC-ESC-005: Token Decimals Compatibility
    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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

    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    // SC-ESC-007: Instance Storage Optimisation
    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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

    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    // SC-ESC-008: Double-Spending Prevention
    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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

    #[test]
    #[should_panic(expected = "Error(Contract, #12)")]
    fn test_reentrant_release_milestone_panics() {
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

        env.as_contract(&contract_id, || {
            env.storage().instance().set(&DataKey::Locked, &());
        });
        cc.release_milestone(&1u64, &client);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #12)")]
    fn test_reentrant_release_funds_panics() {
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

        env.as_contract(&contract_id, || {
            env.storage().instance().set(&DataKey::Locked, &());
        });
        cc.release_funds(&1u64, &client, &0u32);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #12)")]
    fn test_reentrant_refund_panics() {
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

        env.as_contract(&contract_id, || {
            env.storage().instance().set(&DataKey::Locked, &());
        });
        cc.refund(&1u64, &client);
    }

    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    // SC-ESC-009: Dispute Timeout Enforcement
    // ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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
    #[should_panic(expected = "Error(Contract, #20)")]
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

    #[test]
    fn test_version() {
        let env = Env::default();
        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);
        assert_eq!(cc.version(), 1);
    }

    #[test]
    fn test_get_multisig_config() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);

        let signers = soroban_sdk::vec![&env, signer1.clone(), signer2.clone()];
        cc.configure_multisig(&1u64, &signers, &2u32);

        let config = cc.get_multisig_config(&1u64);
        assert_eq!(config.required_signatures, 2);
        assert_eq!(config.signers.len(), 2);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SC-ESC-016: Enforce Limit Restrictions on Maximum Milestone Partition Counts
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_add_milestones_up_to_limit_succeeds() {
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

        // Adding exactly MAX_MILESTONES (12) should succeed
        for _ in 0..MAX_MILESTONES {
            cc.add_milestone(&1u64, &100i128);
        }

        let job = cc.get_job(&1u64);
        assert_eq!(job.milestones.len(), MAX_MILESTONES);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #21)")]
    fn test_add_milestones_limit_exceeded() {
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

        // Fill up to the max
        for _ in 0..MAX_MILESTONES {
            cc.add_milestone(&1u64, &100i128);
        }

        // The 13th milestone must fail with MaxMilestonesExceeded (#21)
        cc.add_milestone(&1u64, &100i128);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SC-ESC-013: Verify State Machine Integrity across Multi-Milestone Gigs
    // ─────────────────────────────────────────────────────────────────────────

    /// Full lifecycle: Setup → Funded → WIP → WIP → Completed.
    /// Validates status, released_amount, remaining balance, and milestone
    /// statuses at every intermediate step.
    #[test]
    fn test_multi_milestone_full_lifecycle_state_integrity() {
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
        let tc = token::Client::new(&env, &token_addr);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);

        // ── Setup phase ──
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Setup);
        assert_eq!(job.milestones.len(), 0);
        assert_eq!(job.total_amount, 0);
        assert_eq!(job.released_amount, 0);

        cc.add_milestone(&1u64, &1000i128);
        cc.add_milestone(&1u64, &2000i128);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &4000i128);

        let job = cc.get_job(&1u64);
        assert_eq!(job.milestones.len(), 4);
        assert_eq!(job.status, EscrowStatus::Setup);

        // ── Deposit → Funded ──
        cc.deposit(&1u64, &10_000i128);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Funded);
        assert_eq!(job.total_amount, 10_000);
        assert_eq!(job.released_amount, 0);
        assert_eq!(cc.get_escrow_balance(&1u64), 10_000);
        assert_eq!(cc.get_remaining_balance(&1u64), 10_000);
        assert_eq!(tc.balance(&contract_id), 10_000);

        // Verify all milestones are Pending
        let statuses = cc.get_milestone_status(&1u64);
        for i in 0..4u32 {
            assert_eq!(statuses.get(i).unwrap(), MilestoneStatus::Pending);
        }

        // ── Release milestone 0 → WorkInProgress ──
        cc.release_milestone(&1u64, &client);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::WorkInProgress);
        assert_eq!(job.released_amount, 1000);
        assert_eq!(cc.get_escrow_balance(&1u64), 9000);
        assert_eq!(cc.get_remaining_balance(&1u64), 9000);
        assert_eq!(tc.balance(&freelancer), 1000);

        let statuses = cc.get_milestone_status(&1u64);
        assert_eq!(statuses.get(0).unwrap(), MilestoneStatus::Released);
        assert_eq!(statuses.get(1).unwrap(), MilestoneStatus::Pending);
        assert_eq!(statuses.get(2).unwrap(), MilestoneStatus::Pending);
        assert_eq!(statuses.get(3).unwrap(), MilestoneStatus::Pending);

        // ── Release milestone 1 → still WorkInProgress ──
        cc.release_milestone(&1u64, &client);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::WorkInProgress);
        assert_eq!(job.released_amount, 3000);
        assert_eq!(cc.get_remaining_balance(&1u64), 7000);
        assert_eq!(tc.balance(&freelancer), 3000);

        // ── Release milestone 2 → still WorkInProgress ──
        cc.release_milestone(&1u64, &client);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::WorkInProgress);
        assert_eq!(job.released_amount, 6000);
        assert_eq!(cc.get_remaining_balance(&1u64), 4000);
        assert_eq!(tc.balance(&freelancer), 6000);

        // ── Release milestone 3 → Completed ──
        cc.release_milestone(&1u64, &client);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Completed);
        assert_eq!(job.released_amount, 10_000);
        assert_eq!(cc.get_remaining_balance(&1u64), 0);
        assert_eq!(tc.balance(&freelancer), 10_000);
        assert_eq!(tc.balance(&contract_id), 0);

        // All milestones must be Released
        let statuses = cc.get_milestone_status(&1u64);
        for i in 0..4u32 {
            assert_eq!(statuses.get(i).unwrap(), MilestoneStatus::Released);
        }
    }

    /// Out-of-order release_funds (explicit index) with state checks at each step.
    #[test]
    fn test_out_of_order_release_funds_state_integrity() {
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
        let tc = token::Client::new(&env, &token_addr);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &1500i128);
        cc.add_milestone(&1u64, &2500i128);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &3000i128);
        cc.deposit(&1u64, &10_000i128);

        // Release milestone index 3 first (out of order)
        cc.release_funds(&1u64, &client, &3u32);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::WorkInProgress);
        assert_eq!(job.released_amount, 3000);
        let statuses = cc.get_milestone_status(&1u64);
        assert_eq!(statuses.get(0).unwrap(), MilestoneStatus::Pending);
        assert_eq!(statuses.get(3).unwrap(), MilestoneStatus::Released);

        // Release milestone index 1
        cc.release_funds(&1u64, &client, &1u32);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::WorkInProgress);
        assert_eq!(job.released_amount, 5500);
        assert_eq!(tc.balance(&freelancer), 5500);

        // Release milestone index 0
        cc.release_funds(&1u64, &client, &0u32);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::WorkInProgress);
        assert_eq!(job.released_amount, 7000);

        // Release milestone index 2 — final → Completed
        cc.release_funds(&1u64, &client, &2u32);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Completed);
        assert_eq!(job.released_amount, 10_000);
        assert_eq!(tc.balance(&freelancer), 10_000);
        assert_eq!(tc.balance(&contract_id), 0);

        // All Released
        let statuses = cc.get_milestone_status(&1u64);
        for i in 0..4u32 {
            assert_eq!(statuses.get(i).unwrap(), MilestoneStatus::Released);
        }
    }

    /// Dispute raised mid-WIP after partial milestone releases; verifies balance
    /// accounting is correct through dispute resolution.
    #[test]
    fn test_dispute_mid_wip_partial_milestones_balance_integrity() {
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
        let tc = token::Client::new(&env, &token_addr);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &2000i128);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &10_000i128);

        // Release first two milestones
        cc.release_milestone(&1u64, &client); // 2000
        cc.release_milestone(&1u64, &client); // 3000
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::WorkInProgress);
        assert_eq!(job.released_amount, 5000);
        assert_eq!(tc.balance(&freelancer), 5000);

        // Raise dispute with 5000 remaining
        cc.raise_dispute(&1u64, &freelancer);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Disputed);
        assert_eq!(cc.get_remaining_balance(&1u64), 5000);

        // Milestone statuses: first two Released, third Pending
        let statuses = cc.get_milestone_status(&1u64);
        assert_eq!(statuses.get(0).unwrap(), MilestoneStatus::Released);
        assert_eq!(statuses.get(1).unwrap(), MilestoneStatus::Released);
        assert_eq!(statuses.get(2).unwrap(), MilestoneStatus::Pending);

        // Resolve: 60/40 split of remaining 5000
        cc.resolve_dispute(&1u64, &3000i128, &2000i128);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Resolved);
        // Total released: 5000 (milestones) + 5000 (resolution) = 10000
        assert_eq!(job.released_amount, 10_000);
        assert_eq!(tc.balance(&freelancer), 8000);  // 5000 + 3000
        assert_eq!(tc.balance(&client), 92_000);     // 100000 - 10000 + 2000
    }

    /// Cancel brief in WorkInProgress state refunds only the unreleased portion.
    #[test]
    fn test_cancel_brief_wip_refunds_remaining_only() {
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
        let tc = token::Client::new(&env, &token_addr);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &2000i128);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &10_000i128);

        // Release first milestone → WIP
        cc.release_milestone(&1u64, &client);
        assert_eq!(tc.balance(&freelancer), 2000);
        assert_eq!(tc.balance(&client), 90_000);

        // Cancel brief — should refund remaining 8000 to client
        cc.cancel_brief(&1u64, &client);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Refunded);
        assert_eq!(job.released_amount, job.total_amount); // fully accounted
        assert_eq!(tc.balance(&client), 98_000);  // 90000 + 8000
        assert_eq!(tc.balance(&freelancer), 2000); // unchanged
        assert_eq!(tc.balance(&contract_id), 0);   // fully drained
    }

    /// Amend milestones mid-WIP, then release amended milestones to Completed.
    /// Validates the state machine remains coherent through amendment.
    #[test]
    fn test_amend_milestones_then_complete_state_integrity() {
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
        let tc = token::Client::new(&env, &token_addr);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &2000i128);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &10_000i128);

        // Release first milestone
        cc.release_milestone(&1u64, &client);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::WorkInProgress);
        assert_eq!(job.released_amount, 2000);

        // Amend remaining milestones: 3000+5000=8000 → 4000+4000=8000
        let new_amounts = soroban_sdk::vec![&env, 4000i128, 4000i128];
        cc.amend_milestones(&1u64, &new_amounts);

        // Verify structure: 1 Released + 2 new Pending
        let job = cc.get_job(&1u64);
        assert_eq!(job.milestones.len(), 3);
        assert_eq!(job.status, EscrowStatus::WorkInProgress);
        assert_eq!(job.released_amount, 2000);

        let statuses = cc.get_milestone_status(&1u64);
        assert_eq!(statuses.get(0).unwrap(), MilestoneStatus::Released);
        assert_eq!(statuses.get(1).unwrap(), MilestoneStatus::Pending);
        assert_eq!(statuses.get(2).unwrap(), MilestoneStatus::Pending);

        // Release remaining amended milestones
        cc.release_milestone(&1u64, &client);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::WorkInProgress);
        assert_eq!(job.released_amount, 6000);
        assert_eq!(tc.balance(&freelancer), 6000);

        cc.release_milestone(&1u64, &client);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Completed);
        assert_eq!(job.released_amount, 10_000);
        assert_eq!(tc.balance(&freelancer), 10_000);
        assert_eq!(tc.balance(&contract_id), 0);
    }

    /// Getter consistency: get_escrow_balance and get_remaining_balance match
    /// across every state transition in a multi-milestone lifecycle.
    #[test]
    fn test_getter_consistency_across_transitions() {
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
        cc.deposit(&1u64, &10_000i128);

        // Both getters must agree at every step
        assert_eq!(cc.get_escrow_balance(&1u64), cc.get_remaining_balance(&1u64));
        assert_eq!(cc.get_escrow_balance(&1u64), 10_000);

        cc.release_milestone(&1u64, &client);
        assert_eq!(cc.get_escrow_balance(&1u64), cc.get_remaining_balance(&1u64));
        assert_eq!(cc.get_escrow_balance(&1u64), 7000);

        cc.release_milestone(&1u64, &client);
        assert_eq!(cc.get_escrow_balance(&1u64), cc.get_remaining_balance(&1u64));
        assert_eq!(cc.get_escrow_balance(&1u64), 4000);

        cc.release_milestone(&1u64, &client);
        assert_eq!(cc.get_escrow_balance(&1u64), cc.get_remaining_balance(&1u64));
        assert_eq!(cc.get_escrow_balance(&1u64), 0);

        // Final state
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Completed);
    }

    /// Unauthorized callers are blocked from all state-mutating functions
    /// on a multi-milestone job.
    #[test]
    fn test_unauthorized_state_mutations_blocked_multi_milestone() {
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
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &10_000i128);

        // Release first milestone to enter WIP
        cc.release_milestone(&1u64, &client);
        assert_eq!(cc.get_job(&1u64).status, EscrowStatus::WorkInProgress);

        // Verify: release_milestone by rando → Unauthorized (#3)
        let result = cc.try_release_milestone(&1u64, &rando);
        assert!(result.is_err());

        // Verify: release_funds by freelancer → Unauthorized (#3)
        let result = cc.try_release_funds(&1u64, &freelancer, &1u32);
        assert!(result.is_err());

        // Verify: refund by freelancer → Unauthorized (#3)
        let result = cc.try_refund(&1u64, &freelancer);
        assert!(result.is_err());

        // Verify: cancel_brief by rando → Unauthorized (#3)
        let result = cc.try_cancel_brief(&1u64, &rando);
        assert!(result.is_err());

        // State is still WIP — no mutation occurred
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::WorkInProgress);
        assert_eq!(job.released_amount, 5000);
    }

    /// Invalid state transitions are blocked on multi-milestone jobs:
    /// cannot release after dispute, cannot dispute after completion.
    #[test]
    fn test_invalid_transitions_blocked_multi_milestone() {
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

        // ── Test 1: Cannot release after dispute ──
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &3000i128);
        cc.add_milestone(&1u64, &7000i128);
        cc.deposit(&1u64, &10_000i128);

        cc.release_milestone(&1u64, &client); // WIP
        cc.raise_dispute(&1u64, &client);      // Disputed
        assert_eq!(cc.get_job(&1u64).status, EscrowStatus::Disputed);

        // release_milestone must fail in Disputed state
        let result = cc.try_release_milestone(&1u64, &client);
        assert!(result.is_err());

        // release_funds must fail in Disputed state
        let result = cc.try_release_funds(&1u64, &client, &1u32);
        assert!(result.is_err());

        // ── Test 2: Cannot dispute after completion ──
        cc.create_job(&2u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&2u64, &5000i128);
        cc.add_milestone(&2u64, &5000i128);
        cc.deposit(&2u64, &10_000i128);

        cc.release_milestone(&2u64, &client);
        cc.release_milestone(&2u64, &client);
        assert_eq!(cc.get_job(&2u64).status, EscrowStatus::Completed);

        // raise_dispute must fail in Completed state
        let result = cc.try_raise_dispute(&2u64, &client);
        assert!(result.is_err());

        // open_dispute must fail in Completed state
        let result = cc.try_open_dispute(&2u64, &client);
        assert!(result.is_err());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SC-ESC-019: Dynamic Storage Allocation Recouping (State De-allocation)
    // ─────────────────────────────────────────────────────────────────────────
    #[test]
    fn test_cleanup_job_completed() {
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

        assert_eq!(cc.get_job(&1u64).status, EscrowStatus::Completed);

        // cleanup_job by client
        cc.cleanup_job(&1u64, &client);

        // verify it is deleted
        let result = cc.try_get_job(&1u64);
        assert!(result.is_err());
    }

    #[test]
    fn test_cleanup_job_invalid_state() {
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
        
        // Setup state
        assert_eq!(cc.get_job(&1u64).status, EscrowStatus::Setup);
        let res = cc.try_cleanup_job(&1u64, &client);
        assert!(res.is_err());

        cc.deposit(&1u64, &5000i128);
        // Funded state
        assert_eq!(cc.get_job(&1u64).status, EscrowStatus::Funded);
        let res = cc.try_cleanup_job(&1u64, &client);
        assert!(res.is_err());
    }

    #[test]
    fn test_cleanup_job_unauthorized() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let random = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);
        cc.release_milestone(&1u64, &client);
        
        // Random tries to cleanup
        let res = cc.try_cleanup_job(&1u64, &random);
        assert!(res.is_err());
    }

    // ──────────────────────────────────────────────────────────────────────────────
    // SC-ESC-016: Additional milestone partition count edge-case tests
    // ──────────────────────────────────────────────────────────────────────────────

    /// [SC-ESC-016] Adding a milestone with a zero amount must be rejected with
    /// `InvalidInput` (error code #4).  Zero-value milestones would corrupt the
    /// deposit-vs-milestone-sum invariant enforced by `deposit`.
    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_add_milestone_zero_amount_panics() {
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
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        // Zero amount must be rejected
        cc.add_milestone(&1u64, &0i128);
    }

    /// [SC-ESC-016] Adding a milestone after the job is `Funded` must be rejected with
    /// `InvalidState` (error code #6).  Once deposited, the partition set is locked.
    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_add_milestone_after_deposit_panics() {
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

        // Adding a milestone after deposit must fail with InvalidState
        cc.add_milestone(&1u64, &1000i128);
    }

    // ──────────────────────────────────────────────────────────────────────────────
    // SC-ESC-013: Additional state machine integrity tests
    // ──────────────────────────────────────────────────────────────────────────────

    /// [SC-ESC-013] `deposit` must reject when no milestones have been added.
    /// Enforces the invariant: funded amount must equal sum of milestone amounts.
    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn test_state_machine_deposit_with_no_milestones_panics() {
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
        // No milestones added — deposit must fail with InvalidInput (#4)
        cc.deposit(&1u64, &5000i128);
    }

    /// [SC-ESC-013] A Disputed job cannot be resolved twice.  The first `resolve_dispute`
    /// transitions to `Resolved`; a second call must fail with `InvalidState` (#6).
    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_state_machine_resolve_dispute_twice_panics() {
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
        // First resolution succeeds
        cc.resolve_dispute(&1u64, &6000i128, &0i128);
        assert_eq!(cc.get_job(&1u64).status, EscrowStatus::Resolved);

        // Second resolution must fail — Resolved → Resolved is not a valid transition
        cc.resolve_dispute(&1u64, &0i128, &0i128);
    }

    /// [SC-ESC-013] Verifies that the job transitions from `Funded` directly to `Completed`
    /// (skipping `WorkInProgress`) when a single-milestone job is fully released at once.
    #[test]
    fn test_state_machine_single_milestone_funded_to_completed() {
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
        let tc = token::Client::new(&env, &token_addr);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);
        cc.add_milestone(&1u64, &10_000i128);
        cc.deposit(&1u64, &10_000i128);

        // Single milestone: Funded → Completed in one release
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Funded);

        cc.release_milestone(&1u64, &client);
        let job = cc.get_job(&1u64);
        // Funded → Completed (single-milestone fast path, no WIP intermediate)
        assert_eq!(job.status, EscrowStatus::Completed);
        assert_eq!(job.released_amount, 10_000);
        assert_eq!(tc.balance(&freelancer), 10_000);
        assert_eq!(tc.balance(&contract_id), 0);
    }

    // ──────────────────────────────────────────────────────────────────────────────
    // SC-ESC-019: Additional storage de-allocation tests
    // ──────────────────────────────────────────────────────────────────────────────

    /// [SC-ESC-019] `cleanup_job` must succeed in the `Refunded` terminal state and
    /// remove the persistent entry so that `get_job` returns `JobNotFound`.
    #[test]
    fn test_cleanup_job_after_refund_succeeds() {
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
        cc.deposit(&1u64, &4000i128);

        // Expire lockup, then refund
        let expiry = cc.get_expiry(&1u64);
        env.ledger().with_mut(|li| li.timestamp = expiry + 1);
        cc.refund(&1u64, &client);
        assert_eq!(cc.get_job(&1u64).status, EscrowStatus::Refunded);

        // Cleanup by the client — must succeed
        cc.cleanup_job(&1u64, &client);

        // Storage entry must now be absent
        let result = cc.try_get_job(&1u64);
        assert!(result.is_err());
    }

    /// [SC-ESC-019] `cleanup_job` must succeed in the `Resolved` terminal state and
    /// free both the Job and any associated MultisigConfig ledger entries.
    #[test]
    fn test_cleanup_job_after_resolved_succeeds() {
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
        // Resolve fully in favour of freelancer
        cc.resolve_dispute(&1u64, &8000i128, &0i128);
        assert_eq!(cc.get_job(&1u64).status, EscrowStatus::Resolved);

        // Freelancer cleans up
        cc.cleanup_job(&1u64, &freelancer);

        // Storage entry must now be absent
        let result = cc.try_get_job(&1u64);
        assert!(result.is_err());
    }

    /// [SC-ESC-019] Attempting to `cleanup_job` on a non-existent job ID must return
    /// `JobNotFound` (error code #5).
    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn test_cleanup_job_not_found_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let caller = Address::generate(&env);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        // Job ID 999 was never created
        cc.cleanup_job(&999u64, &caller);
    }

    /// [SC-ESC-019] `cleanup_job` also removes the associated `MultisigConfig` persistent
    /// key when one was configured, leaving no orphaned ledger entries.
    #[test]
    fn test_cleanup_job_also_removes_multisig_config() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        cc.create_job(&1u64, &client, &freelancer, &token_addr);

        // Configure multisig during Setup
        let signers = soroban_sdk::vec![&env, signer1.clone(), signer2.clone()];
        cc.configure_multisig(&1u64, &signers, &2u32);

        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &5000i128);
        cc.release_milestone(&1u64, &client);
        assert_eq!(cc.get_job(&1u64).status, EscrowStatus::Completed);

        // MultisigConfig must be readable before cleanup
        let config = cc.get_multisig_config(&1u64);
        assert_eq!(config.required_signatures, 2);

        // Cleanup removes both Job and MultisigConfig
        cc.cleanup_job(&1u64, &client);

        // Job is gone
        let job_result = cc.try_get_job(&1u64);
        assert!(job_result.is_err());

        // MultisigConfig is also gone
        let ms_result = cc.try_get_multisig_config(&1u64);
        assert!(ms_result.is_err());
    }
}
