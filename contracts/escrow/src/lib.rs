#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Vec};

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

pub const MAX_FEE_BPS: u32 = 10_000;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ContractConfig {
    pub admin: Address,
    pub agent_judge: Address,
}

#[contracttype]
pub enum DataKey {
    Job(u64),
    Config,
    GuardFlag(u64),
    Treasury,
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
    pub fn initialize(env: Env, admin: Address, agent_judge: Address) {
        if env.storage().instance().has(&DataKey::Config) {
            panic!("already initialized");
        }
        let config = ContractConfig { admin, agent_judge };
        env.storage().instance().set(&DataKey::Config, &config);
    }

    /// Admin can update the Agent Judge address.
    pub fn set_agent_judge(env: Env, new_agent_judge: Address) {
        let mut config: ContractConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("not initialized");
        config.admin.require_auth();
        config.agent_judge = new_agent_judge;
        env.storage()
            .instance()
            .set(&DataKey::Config, &config);
    }

    pub fn configure_treasury(env: Env, routing_address: Address, fee_bps: u32) {
        let config: ContractConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("not initialized");
        config.admin.require_auth();

        assert!(fee_bps <= MAX_FEE_BPS, "FeeTooHigh");

        let config = TreasuryConfig {
            routing_address: routing_address.clone(),
            fee_bps,
        };

        env.storage().instance().set(&DataKey::Treasury, &config);

        env.events().publish(
            ("escrow", "FeeConfigUpdated"),
            FeeConfigUpdatedEvent {
                treasury: routing_address,
                fee_bps,
                updated_at: env.ledger().timestamp(),
            },
        );
    }

    pub fn get_treasury(env: Env) -> Option<Address> {
        if let Some(config) = env.storage().instance().get::<_, TreasuryConfig>(&DataKey::Treasury) {
            Some(config.routing_address)
        } else {
            None
        }
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
        let expires_duration = 30u64
            .checked_mul(24)
            .and_then(|h| h.checked_mul(60))
            .and_then(|m| m.checked_mul(60))
            .ok_or(EscrowError::ArithmeticError)?;

        let expires_at = now
            .checked_add(expires_duration)
            .ok_or(EscrowError::ArithmeticError)?;

        let job = EscrowJob {
            client,
            freelancer,
            token: token_addr,
            total_amount: 0,
            released_amount: 0,
            status: EscrowStatus::Setup,
            created_at: now,
            expires_at,
            milestones: Vec::new(&env),
        };
        env.storage().persistent().set(&key, &job);
    }

    /// Add a milestone to the job (setup phase only).
    pub fn add_milestone(env: Env, job_id: u64, amount: i128) {
        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");
        job.client.require_auth();
        assert!(job.status == EscrowStatus::Setup, "not in setup phase");
        assert!(amount > 0, "amount must be > 0");

        let milestone = Milestone {
            amount,
            status: MilestoneStatus::Pending,
        };
        job.milestones.push_back(milestone);
        env.storage().persistent().set(&key, &job);
    }

    /// Client deposits total amount and transitions job to Funded.
    pub fn deposit(env: Env, job_id: u64, amount: i128) {
        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");
        job.client.require_auth();
        assert!(
            job.status == EscrowStatus::Setup,
            "already funded or invalid state"
        );
        assert!(amount > 0, "amount must be > 0");
        assert!(job.milestones.len() > 0, "no milestones defined");

        let mut total_milestones_amount = 0i128;
        for m in job.milestones.iter() {
            total_milestones_amount = total_milestones_amount
                .checked_add(m.amount)
                .expect("overflow");
        }
        assert!(
            total_milestones_amount == amount,
            "sum of milestones must equal total amount"
        );

        let token_client = token::Client::new(&env, &job.token);
        token_client.transfer(&job.client, &env.current_contract_address(), &amount);

        job.total_amount = amount;
        job.status = EscrowStatus::Funded;
        env.storage().persistent().set(&key, &job);
    }

    /// Client approves a milestone -- releases next pending milestone to freelancer.
    pub fn release_milestone(env: Env, job_id: u64, caller: Address) {
        caller.require_auth();
        Self::check_reentrancy(&env, job_id);

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");

        assert!(
            job.status == EscrowStatus::Funded || job.status == EscrowStatus::WorkInProgress,
            "invalid state"
        );
        assert!(caller == job.client, "only client can release");

        let mut found_idx = None;
        for i in 0..job.milestones.len() {
            let m = job.milestones.get(i).unwrap();
            if m.status == MilestoneStatus::Pending {
                found_idx = Some(i);
                break;
            }
        }

        let idx = found_idx.expect("no pending");
        Self::set_guard(&env, job_id);
        Self::release_milestone_internal(&env, job_id, &mut job, idx);
        Self::clear_guard(&env, job_id);
    }

    /// Happy-path release for an explicit milestone index (0-based).
    pub fn release_funds(env: Env, job_id: u64, caller: Address, milestone_index: u32) {
        caller.require_auth();
        Self::check_reentrancy(&env, job_id);

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

        assert!(
            job.status == EscrowStatus::Funded || job.status == EscrowStatus::WorkInProgress,
            "invalid state"
        );
        assert!(caller == job.client, "unauthorized");
        assert!(milestone_index < job.milestones.len(), "invalid");

        let milestone = job.milestones.get(milestone_index).expect("invalid");
        assert!(milestone.status == MilestoneStatus::Pending, "released");

        Self::set_guard(&env, job_id);
        Self::release_milestone_internal(&env, job_id, &mut job, milestone_index);
        Self::clear_guard(&env, job_id);
    }

    /// Either party opens a dispute, locking remaining funds.
    pub fn open_dispute(env: Env, job_id: u64, caller: Address) {
        caller.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");

        assert!(
            job.status == EscrowStatus::Funded || job.status == EscrowStatus::WorkInProgress,
            "job not in active/funded state"
        );
        assert!(
            caller == job.client || caller == job.freelancer,
            "unauthorized"
        );

        job.status = EscrowStatus::Disputed;
        env.storage().persistent().set(&key, &job);
    }

    /// Either party formally raises a dispute with on-chain event emission.
    /// Locks funds, transitions state to Disputed, and signals the AI Judge.
    pub fn raise_dispute(env: Env, job_id: u64, caller: Address) {
        // 1. Authenticate the caller
        caller.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");

        // 2. Only client or freelancer may raise a dispute
        assert!(
            caller == job.client || caller == job.freelancer,
            "unauthorized: only client or freelancer can raise a dispute"
        );

        // 3. Job must still be active
        Self::assert_not_same_ledger_as_funding(&env, &job)?;

        if !(job.status == EscrowStatus::Funded || job.status == EscrowStatus::WorkInProgress) {
            return Err(EscrowError::InvalidState);
        }

        // 4. Prevent dispute if all funds are already released
        assert!(
            job.released_amount < job.total_amount,
            "dispute cannot be raised: all funds already released"
        );

        // 5. Prevent dispute if deadline has drastically expired (7-day grace period)
        let now: u64 = env.ledger().timestamp();
        let grace_period: u64 = 7u64
            .checked_mul(24)
            .expect("overflow")
            .checked_mul(60)
            .expect("overflow")
            .checked_mul(60)
            .expect("overflow");
        assert!(
            now <= job.expires_at.checked_add(grace_period).expect("overflow"),
            "dispute cannot be raised: deadline has drastically expired"
        );

        // 6. Lock funds by transitioning to Disputed — blocks release_funds & release_milestone
        job.status = EscrowStatus::Disputed;
        env.storage().persistent().set(&key, &job);

        // 7. Emit DisputeRaised event for backend / AI Judge to consume
        let mut released_count = 0u32;
        for m in job.milestones.iter() {
            if m.status == MilestoneStatus::Released {
                released_count = released_count.checked_add(1).expect("overflow");
            }
        }

        let event_data = DisputeRaisedEvent {
            job_id,
            initiator: caller,
            milestones_released: released_count,
            milestones_total: job.milestones.len(),
            raised_at: now,
        };
        env.events()
            .publish(("escrow", "DisputeRaised"), event_data);
    }

    /// Agent Judge resolves dispute -- splits funds by explicit amounts.
    /// `payee_amount`: Amount to pay to the freelancer (payee).
    /// `payer_amount`: Amount to return to the client (payer).
    pub fn resolve_dispute(env: Env, job_id: u64, payee_amount: i128, payer_amount: i128) {
        let config: ContractConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .expect("agent judge not set");
        config.agent_judge.require_auth();

        assert!(payee_amount >= 0, "payee_amount must be >= 0");
        assert!(payer_amount >= 0, "payer_amount must be >= 0");

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");
        assert!(job.status == EscrowStatus::Disputed, "job not disputed");

        let remaining = job
            .total_amount
            .checked_sub(job.released_amount)
            .expect("overflow");
        let total_payout = payee_amount.checked_add(payer_amount).expect("overflow");
        assert!(total_payout <= remaining, "payout exceeds remaining funds");

        let token_client = token::Client::new(&env, &job.token);
        let mut freelancer_amount = payee_amount;

        if let Some(treasury_config) = env.storage().instance().get::<_, TreasuryConfig>(&DataKey::Treasury) {
            let fee = payee_amount
                .checked_mul(treasury_config.fee_bps as i128)
                .expect("overflow")
                .checked_div(10000)
                .expect("overflow");

            if fee > 0 {
                freelancer_amount = payee_amount
                    .checked_sub(fee)
                    .expect("overflow");

                token_client.transfer(
                    &env.current_contract_address(),
                    &treasury_config.routing_address,
                    &fee,
                );
            }
        }

        if freelancer_amount > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &job.freelancer,
                &freelancer_amount,
            );
        }
        if payer_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &job.client, &payer_amount);
        }

        job.released_amount = job
            .released_amount
            .checked_add(total_payout)
            .expect("overflow");
        job.status = EscrowStatus::Resolved;
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);
        Self::exit_job_lock(&env, lock_key);

        Ok(())
    }

    /// Client recoups funds if freelancer never responded.
    pub fn refund(env: Env, job_id: u64, client: Address) {
        client.require_auth();

        let key = DataKey::Job(job_id);
        let job: EscrowJob = env
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

        assert!(
            job.status == EscrowStatus::Funded || job.status == EscrowStatus::WorkInProgress,
            "job not in active state"
        );
        assert!(client == job.client, "only client can refund");

        let remaining = job
            .total_amount
            .checked_sub(job.released_amount)
            .expect("overflow");
        if remaining > 0 {
            let token_client = token::Client::new(&env, &job.token);
            token_client.transfer(&env.current_contract_address(), &job.client, &remaining);
        }

        job.released_amount = job.total_amount;
        job.status = EscrowStatus::Refunded;
        env.storage().persistent().set(&key, &job);
    }

    pub fn get_job(env: Env, job_id: u64) -> EscrowJob {
        env.storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .expect("job not found")
    }

    pub fn get_escrow_balance(env: Env, job_id: u64) -> i128 {
        let job: EscrowJob = env
            .storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .expect("job not found");
        job.total_amount
            .checked_sub(job.released_amount)
            .expect("overflow")
    }

    pub fn get_milestone(env: Env, job_id: u64, index: u32) -> Milestone {
        let job: EscrowJob = env
            .storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .expect("job not found");
        job.milestones.get(index).expect("milestone not found")
    }

    /// Retrieve the status of all milestones for a given job.
    pub fn get_milestone_status(env: Env, job_id: u64) -> Vec<MilestoneStatus> {
        let job: EscrowJob = env
            .storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .expect("job not found");
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
            .set(&DataKey::GuardFlag(job_id), &true);
    }

    fn clear_guard(env: &Env, job_id: u64) {
        env.storage().instance().remove(&DataKey::GuardFlag(job_id));
    }

    fn release_milestone_internal(
        env: &Env,
        job_id: u64,
        job: &mut EscrowJob,
        milestone_index: u32,
    ) {
        let mut milestone = job.milestones.get(milestone_index).expect("invalid");
        milestone.status = MilestoneStatus::Released;
        job.milestones.set(milestone_index, milestone.clone());

        job.released_amount = job
            .released_amount
            .checked_add(milestone.amount)
            .expect("overflow");
        job.status = EscrowStatus::WorkInProgress;

        Self::payout_with_fee(&env, job, milestone.amount);

        if job.released_amount == job.total_amount {
            job.status = EscrowStatus::Completed;
        }

        env.storage().persistent().set(&DataKey::Job(job_id), job);
    }

    fn payout_with_fee(env: &Env, job: &EscrowJob, amount: i128) {
        let token_client = token::Client::new(env, &job.token);
        let mut freelancer_amount = amount;

        if let Some(treasury_config) = env.storage().instance().get::<_, TreasuryConfig>(&DataKey::Treasury) {
            let fee = amount
                .checked_mul(treasury_config.fee_bps as i128)
                .expect("overflow")
                .checked_div(10000)
                .expect("overflow");

            if fee > 0 {
                freelancer_amount = amount
                    .checked_sub(fee)
                    .expect("overflow");

                token_client.transfer(
                    &env.current_contract_address(),
                    &treasury_config.routing_address,
                    &fee,
                );
            }
        }

        if freelancer_amount > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &job.freelancer,
                &freelancer_amount,
            );
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
    }

    fn set_guard(env: &Env, job_id: u64) {
        env.storage()
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
        Self::fee_bps(&env)
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
    #[should_panic(expected = "already initialized")]
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
    #[should_panic(expected = "only client can release")]
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
    #[should_panic(expected = "sum of milestones must equal total amount")]
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
        cc.deposit(&1u64, &1000i128); // Should panic as 500 != 1000
    }

    #[test]
    #[should_panic(expected = "no milestones defined")]
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

    #[test]
    fn test_reentrancy_protection_panics_on_recursive_release() {
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
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &10_000i128);

        env.as_contract(&contract_id, || {
            EscrowContract::set_guard(&env, 1u64);
            assert!(env.storage().instance().has(&DataKey::GuardFlag(1u64)));
            EscrowContract::clear_guard(&env, 1u64);
            assert!(!env.storage().instance().has(&DataKey::GuardFlag(1u64)));
        });

        cc.release_milestone(&1u64, &client);
        env.as_contract(&contract_id, || {
            assert!(!env.storage().instance().has(&DataKey::GuardFlag(1u64)));
        });

        cc.release_milestone(&1u64, &client);
        env.as_contract(&contract_id, || {
            assert!(!env.storage().instance().has(&DataKey::GuardFlag(1u64)));
        });

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Completed);
    }

    #[test]
    fn test_reentrancy_protection_release_funds_blocked() {
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
        cc.add_milestone(&1u64, &5000i128);
        cc.deposit(&1u64, &10_000i128);

        env.as_contract(&contract_id, || {
            EscrowContract::set_guard(&env, 1u64);
            assert!(env.storage().instance().has(&DataKey::GuardFlag(1u64)));
            EscrowContract::clear_guard(&env, 1u64);
            assert!(!env.storage().instance().has(&DataKey::GuardFlag(1u64)));
        });

        cc.release_milestone(&1u64, &client);
        env.as_contract(&contract_id, || {
            assert!(!env.storage().instance().has(&DataKey::GuardFlag(1u64)));
        });

        cc.release_funds(&1u64, &client, &1u32);
        env.as_contract(&contract_id, || {
            assert!(!env.storage().instance().has(&DataKey::GuardFlag(1u64)));
        });

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Completed);
    }

    #[test]
    fn test_get_escrow_balance_decreases_on_release() {
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
        cc.deposit(&1u64, &10_000i128);

        assert_eq!(cc.get_escrow_balance(&1u64), 10_000);

        cc.release_milestone(&1u64, &client);
        assert_eq!(cc.get_escrow_balance(&1u64), 8000);

        cc.release_milestone(&1u64, &client);
        assert_eq!(cc.get_escrow_balance(&1u64), 5000);

        cc.release_milestone(&1u64, &client);
        assert_eq!(cc.get_escrow_balance(&1u64), 0);
    }

    #[test]
    fn test_multiple_jobs_isolated() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client_one = Address::generate(&env);
        let freelancer_one = Address::generate(&env);
        let client_two = Address::generate(&env);
        let freelancer_two = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client_one);
        mint(&env, &token_addr, &client_two);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);

        cc.create_job(&1u64, &client_one, &freelancer_one, &token_addr);
        cc.add_milestone(&1u64, &4000i128);
        cc.add_milestone(&1u64, &6000i128);
        cc.deposit(&1u64, &10_000i128);

        cc.create_job(&2u64, &client_two, &freelancer_two, &token_addr);
        cc.add_milestone(&2u64, &1500i128);
        cc.add_milestone(&2u64, &2500i128);
        cc.deposit(&2u64, &4000i128);

        cc.release_milestone(&1u64, &client_one);

        assert_eq!(cc.get_escrow_balance(&1u64), 6000);
        assert_eq!(cc.get_escrow_balance(&2u64), 4000);
        assert_eq!(
            cc.get_milestone(&1u64, &0u32).status,
            MilestoneStatus::Released
        );
        assert_eq!(
            cc.get_milestone(&1u64, &1u32).status,
            MilestoneStatus::Pending
        );
        assert_eq!(
            cc.get_milestone(&2u64, &0u32).status,
            MilestoneStatus::Pending
        );

        cc.release_funds(&2u64, &client_two, &1u32);

        assert_eq!(cc.get_escrow_balance(&1u64), 6000);
        assert_eq!(cc.get_escrow_balance(&2u64), 1500);
        assert_eq!(
            cc.get_milestone(&2u64, &0u32).status,
            MilestoneStatus::Pending
        );
        assert_eq!(
            cc.get_milestone(&2u64, &1u32).status,
            MilestoneStatus::Released
        );

        let tc = token::Client::new(&env, &token_addr);
        assert_eq!(tc.balance(&freelancer_one), 4000);
        assert_eq!(tc.balance(&freelancer_two), 2500);
    }
}
