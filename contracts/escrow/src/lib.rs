#![no_std]

use soroban_sdk::BytesN;
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, token, Address, Env, Vec,
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
    Admin,
    AgentJudge,
    JobRegistry,
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
pub struct DisputeResolvedEvent {
    pub job_id: u64,
    pub freelancer_amount: i128,
    pub client_amount: i128,
    pub resolved_by: Address,
    pub resolved_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct RefundEvent {
    pub job_id: u64,
    pub client: Address,
    pub amount: i128,
    pub refunded_at: u64,
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

    fn bump_job_ttl(env: &Env, key: &DataKey) {
        if env.storage().persistent().has(key) {
            env.storage().persistent().extend_ttl(
                key,
                Self::PERSISTENT_TTL_THRESHOLD,
                Self::PERSISTENT_TTL_EXTEND_TO,
            );
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

        let mut total_milestones_amount = 0i128;
        for m in job.milestones.iter() {
            total_milestones_amount = total_milestones_amount.saturating_add(m.amount);
        }

        if total_milestones_amount != amount {
            return Err(EscrowError::AmountMismatch);
        }

        // Transfer tokens from client to contract
        let token_client = token::Client::new(&env, &job.token);
        token_client.transfer(&job.client, &env.current_contract_address(), &amount);

        job.total_amount = amount;
        job.status = EscrowStatus::Funded;
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);

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

        job.released_amount = job.released_amount.saturating_add(milestone.amount);
        job.status = EscrowStatus::WorkInProgress;

        let token_client = token::Client::new(&env, &job.token);
        token_client.transfer(
            &env.current_contract_address(),
            &job.freelancer,
            &milestone.amount,
        );

        if job.released_amount == job.total_amount {
            job.status = EscrowStatus::Completed;
        }

        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);

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

        job.released_amount += milestone.amount;
        job.status = EscrowStatus::WorkInProgress;

        let token_client = token::Client::new(&env, &job.token);
        token_client.transfer(
            &env.current_contract_address(),
            &job.freelancer,
            &milestone.amount,
        );

        if job.released_amount == job.total_amount {
            job.status = EscrowStatus::Completed;
        }

        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);
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

        job.status = EscrowStatus::Disputed;
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
        job.status = EscrowStatus::Disputed;
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
    pub fn resolve_dispute(
        env: Env,
        job_id: u64,
        payee_amount: i128,
        payer_amount: i128,
    ) -> Result<(), EscrowError> {
        Self::bump_instance_ttl(&env);
        let agent_judge: Address = env
            .storage()
            .instance()
            .get(&DataKey::AgentJudge)
            .ok_or(EscrowError::NotInitialized)?;
        agent_judge.require_auth();

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

        let remaining = job
            .total_amount
            .checked_sub(job.released_amount)
            .ok_or(EscrowError::InvalidState)?;
        let total_payout = payee_amount
            .checked_add(payer_amount)
            .ok_or(EscrowError::InvalidInput)?;
        if total_payout != remaining {
            return Err(EscrowError::AmountMismatch);
        }

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

        job.released_amount = job.total_amount;
        job.status = EscrowStatus::Resolved;
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);

        env.events().publish(
            ("escrow", "ResolveDispute"),
            DisputeResolvedEvent {
                job_id,
                freelancer_amount: payee_amount,
                client_amount: payer_amount,
                resolved_by: agent_judge,
                resolved_at: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    /// Client recoups funds if freelancer never responded.
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

        let remaining = job
            .total_amount
            .checked_sub(job.released_amount)
            .ok_or(EscrowError::InvalidState)?;
        if remaining <= 0 {
            return Err(EscrowError::InvalidState);
        }

        let token_client = token::Client::new(&env, &job.token);
        token_client.transfer(&env.current_contract_address(), &job.client, &remaining);

        job.released_amount = job.total_amount;
        job.status = EscrowStatus::Refunded;
        env.storage().persistent().set(&key, &job);
        Self::bump_job_ttl(&env, &key);

        env.events().publish(
            ("escrow", "Refund"),
            RefundEvent {
                job_id,
                client,
                amount: remaining,
                refunded_at: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    /// Returns the full escrow record for a job.
    pub fn get_job(env: Env, job_id: u64) -> Result<EscrowJob, EscrowError> {
        let key = DataKey::Job(job_id);
        let job = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::JobNotFound)?;
        Self::bump_job_ttl(&env, &key);
        Ok(job)
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
}

#[cfg(test)]
mod test {
    use super::*;
    use job_registry::{JobRegistryContract, JobRegistryContractClient, JobStatus};
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{token, Address, Bytes, BytesN, Env};

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
    #[should_panic(expected = "Error(Contract, #6)")]
 
    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn test_resolve_dispute_requires_full_allocation() {
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
        cc.open_dispute(&1u64, &client);

        cc.resolve_dispute(&1u64, &2000i128, &2000i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn test_get_job_not_found_panics() {
        let env = Env::default();
        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.get_job(&999u64);
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

    #[test]
    fn test_open_dispute_syncs_job_registry_status() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let escrow_id = env.register_contract(None, EscrowContract);
        let escrow = EscrowContractClient::new(&env, &escrow_id);

        let registry_id = env.register_contract(None, JobRegistryContract);
        let registry = JobRegistryContractClient::new(&env, &registry_id);

        let metadata = Bytes::from_slice(&env, b"QmJobMetadataHash");
        let proposal = Bytes::from_slice(&env, b"QmBidProposalHash");

        registry.post_job(&1u64, &client, &metadata, &9000i128);
        registry.submit_bid(&1u64, &freelancer, &proposal);
        registry.accept_bid(&1u64, &client, &freelancer);
        assert_eq!(registry.get_job(&1u64).status, JobStatus::InProgress);

        escrow.initialize(&admin, &agent_judge);
        escrow.set_job_registry(&registry_id);
        escrow.create_job(&1u64, &client, &freelancer, &token_addr);
        escrow.add_milestone(&1u64, &4500i128);
        escrow.add_milestone(&1u64, &4500i128);
        escrow.deposit(&1u64, &9000i128);

        escrow.open_dispute(&1u64, &client);

        let escrow_job = escrow.get_job(&1u64);
        let registry_job = registry.get_job(&1u64);

        assert_eq!(escrow_job.status, EscrowStatus::Disputed);
        assert_eq!(registry_job.status, JobStatus::Disputed);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn test_upgrade_requires_admin() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let agent_judge = Address::generate(&env);
        let attacker = Address::generate(&env);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin, &agent_judge);
        let wasm_hash = BytesN::from_array(&env, &[0; 32]);
        cc.upgrade(&attacker, &wasm_hash);
    }
}
