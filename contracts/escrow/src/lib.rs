#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Vec, token::Client as TokenClient};

/* -----------------------------------------------------------------
   1. Shared Enums & Storage Types
----------------------------------------------------------------- */

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EscrowStatus {
    Funded,
    WorkInProgress,
    Completed,
    Disputed,
    Resolved,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MilestoneStatus {
    Pending,
    Released,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    AgentJudge,
    Treasury,
    SequenceCounter,
    Job(u64),
    GuardFlag(u64),
    Milestone(u64, u32),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreasuryConfig {
    pub treasury_address: Address,
    pub fee_bps: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowJob {
    pub client: Address,
    pub freelancer: Address,
    pub token: Address,
    pub total_amount: i128,
    pub released_amount: i128,
    pub status: EscrowStatus,
    pub total_milestones: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Milestone {
    pub amount: i128,
    pub status: MilestoneStatus,
}

/* -----------------------------------------------------------------
   2. Optimized Event Schemas for Downstream Indexers
----------------------------------------------------------------- */

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowReleaseEvent {
    pub sequence_number: u64,
    pub job_id: u64,
    pub client: Address,
    pub freelancer: Address,
    pub token: Address,
    pub total_amount: i128,
    pub released_amount: i128,
    pub status: EscrowStatus,
}

/* -----------------------------------------------------------------
   3. Smart Contract Implementation
----------------------------------------------------------------- */

#[contract]
pub struct LanceEscrowContract;

#[contractimpl]
impl LanceEscrowContract {
    
    pub fn initialize(env: Env, admin: Address, agent_judge: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::AgentJudge, &agent_judge);
        env.storage().instance().set(&DataKey::SequenceCounter, &0u64);
    }

    pub fn set_agent_judge(env: Env, new_agent_judge: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("uninitialized");
        admin.require_auth();
        env.storage().instance().set(&DataKey::AgentJudge, &new_agent_judge);
    }

    pub fn set_treasury_config(env: Env, treasury_address: Address, fee_bps: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("uninitialized");
        admin.require_auth();
        
        if fee_bps < 0 || fee_bps > 10000 {
            panic!("Invalid basis points value");
        }

        let config = TreasuryConfig { treasury_address, fee_bps };
        env.storage().instance().set(&DataKey::Treasury, &config);
    }

    pub fn funding_job(
        env: Env,
        job_id: u64,
        client: Address,
        freelancer: Address,
        token: Address,
        milestone_amounts: Vec<i128>,
    ) {
        client.require_auth();

        let key = DataKey::Job(job_id);
        if env.storage().persistent().has(&key) {
            panic!("Job already exists");
        }

        let mut total_amount: i128 = 0;
        let total_milestones = milestone_amounts.len();

        for i in 0..total_milestones {
            let amt = milestone_amounts.get(i).unwrap();
            if amt <= 0 {
                panic!("Milestone amount must be positive");
            }
            total_amount = total_amount.checked_add(amt).expect("Overflow tracking total amount");
            
            let m_key = DataKey::Milestone(job_id, i);
            let milestone = Milestone {
                amount: amt,
                status: MilestoneStatus::Pending,
            };
            env.storage().persistent().set(&m_key, &milestone);
        }

        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&client, &env.current_contract_address(), &total_amount);

        let job = EscrowJob {
            client,
            freelancer,
            token,
            total_amount,
            released_amount: 0,
            status: EscrowStatus::Funded,
            total_milestones,
        };

        env.storage().persistent().set(&key, &job);
    }

    pub fn release_milestone(env: Env, job_id: u64, milestone_index: u32) {
        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");
        
        job.client.require_auth();

        EscrowContract::reentrancy_guard_protect(&env, job_id);

        let m_key = DataKey::Milestone(job_id, milestone_index);
        let mut milestone: Milestone = env.storage().persistent().get(&m_key).expect("invalid milestone index");

        if milestone.status == MilestoneStatus::Released {
            panic!("Milestone already released");
        }

        milestone.status = MilestoneStatus::Released;
        env.storage().persistent().set(&m_key, &milestone);

        job.released_amount = job.released_amount.checked_add(milestone.amount).expect("Overflow on release math");
        
        if job.status == EscrowStatus::Funded {
            job.status = EscrowStatus::WorkInProgress;
        }
        if job.released_amount == job.total_amount {
            job.status = EscrowStatus::Completed;
        }

        env.storage().persistent().set(&key, &job);

        Self::payout_with_fee(&env, &job, milestone.amount);
        
        Self::emit_optimized_release_event(&env, job_id, &job);

        EscrowContract::reentrancy_guard_clear(&env, job_id);
    }

    pub fn dispute_job(env: Env, job_id: u64, caller: Address) {
        caller.require_auth();
        
        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");
        
        if job.status != EscrowStatus::Funded && job.status != EscrowStatus::WorkInProgress {
            panic!("Job cannot be disputed in current state");
        }

        if caller != job.client && caller != job.freelancer {
            panic!("Unauthorized dispute initiator");
        }
        
        job.status = EscrowStatus::Disputed;
        env.storage().persistent().set(&key, &job);
    }

    pub fn resolve_dispute(
        env: Env,
        job_id: u64,
        payee_amount: i128,
        payer_amount: i128,
    ) {
        let judge: Address = env.storage().instance().get(&DataKey::AgentJudge).expect("uninitialized");
        judge.require_auth();

        assert!(payee_amount >= 0, "payee_amount must be >= 0");
        assert!(payer_amount >= 0, "payer_amount must be >= 0");

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");

        assert!(job.status == EscrowStatus::Disputed, "job not disputed");

        let total_payout = payee_amount.checked_add(payer_amount).expect("overflow calculation error");
        let remaining_pool = job.total_amount.checked_sub(job.released_amount).expect("Underflow tracking remaining pool");
        assert!(total_payout == remaining_pool, "Total payout must exactly match the remaining escrow funds");

        let token_client = TokenClient::new(&env, &job.token);

        if payee_amount > 0 {
            Self::payout_with_fee(&env, &job, payee_amount);
        }

        if payer_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &job.client, &payer_amount);
        }

        job.released_amount = job.released_amount.checked_add(total_payout).expect("Overflow updates");
        job.status = EscrowStatus::Resolved;
        env.storage().persistent().set(&key, &job);

        Self::emit_optimized_release_event(&env, job_id, &job);
    }

    /* -----------------------------------------------------------------
       Public Getters
    ----------------------------------------------------------------- */

    pub fn get_job(env: Env, job_id: u64) -> Option<EscrowJob> {
        env.storage().persistent().get(&DataKey::Job(job_id))
    }

    pub fn get_milestone(env: Env, job_id: u64, index: u32) -> Option<Milestone> {
        env.storage().persistent().get(&DataKey::Milestone(job_id, index))
    }

    pub fn get_milestone_status(env: Env, job_id: u64) -> Vec<MilestoneStatus> {
        let job: EscrowJob = env.storage().persistent().get(&DataKey::Job(job_id)).expect("job not found");
        let mut statuses = Vec::new(&env);
        for i in 0..job.total_milestones {
            let m: Milestone = env.storage().persistent().get(&DataKey::Milestone(job_id, i)).expect("missing milestone data");
            statuses.push_back(m.status);
        }
        statuses
    }

    pub fn get_current_sequence(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::SequenceCounter).unwrap_or(0u64)
    }

    /* -----------------------------------------------------------------
       Internal Helper Functions
    ----------------------------------------------------------------- */

    fn payout_with_fee(env: &Env, job: &EscrowJob, amount: i128) {
        let token_client = TokenClient::new(env, &job.token);

        if let Some(treasury_config) = env.storage().instance().get::<_, TreasuryConfig>(&DataKey::Treasury) {
            let fee = amount
                .checked_mul(treasury_config.fee_bps)
                .expect("Overflow calculation fee step 1")
                .checked_div(10000)
                .expect("Division calculation step 2");

            if fee > 0 {
                let freelancer_amount = amount.checked_sub(fee).expect("Math subtraction verification");
                token_client.transfer(&env.current_contract_address(), &job.freelancer, &freelancer_amount);
                token_client.transfer(&env.current_contract_address(), &treasury_config.treasury_address, &fee);
            } else {
                token_client.transfer(&env.current_contract_address(), &job.freelancer, &amount);
            }
        } else {
            token_client.transfer(&env.current_contract_address(), &job.freelancer, &amount);
        }
    }

    fn emit_optimized_release_event(env: &Env, job_id: u64, job: &EscrowJob) {
        let current_sequence: u64 = env.storage().instance().get(&DataKey::SequenceCounter).unwrap_or(0u64);
        let next_sequence = current_sequence.checked_add(1).expect("Sequence overflow safeguard triggered");
        env.storage().instance().set(&DataKey::SequenceCounter, &next_sequence);

        let event_payload = EscrowReleaseEvent {
            sequence_number: next_sequence,
            job_id,
            client: job.client.clone(),
            freelancer: job.freelancer.clone(),
            token: job.token.clone(),
            total_amount: job.total_amount,
            released_amount: job.released_amount,
            status: job.status,
        };

        env.events().publish(
            (Symbol::new(env, "escrow_release"), job_id),
            event_payload,
        );
    }
}

/// Namespace internal helper for Reentrancy Protections
struct EscrowContract;
impl EscrowContract {
    fn reentrancy_guard_protect(env: &Env, job_id: u64) {
        if env.storage().instance().has(&DataKey::GuardFlag(job_id)) {
            panic!("Reentrancy Guard Triggered");
        }
        env.storage().instance().set(&DataKey::GuardFlag(job_id), &true);
    }

    fn reentrancy_guard_clear(env: &Env, job_id: u64) {
        env.storage().instance().remove(&DataKey::GuardFlag(job_id));
    }
}
