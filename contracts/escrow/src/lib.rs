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
    pub created_at: u64,
    pub expires_at: u64,
    pub milestones: Vec<Milestone>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TreasuryConfig {
    pub routing_address: Address,
    pub fee_bps: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct FeeConfigUpdatedEvent {
    pub treasury: Address,
    pub fee_bps: u32,
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
        if env.storage().instance().has(&DataKey::Config) {
            panic!("already initialized");
        }
        let config = ContractConfig { admin, agent_judge };
        env.storage().instance().set(&DataKey::Config, &config);
    }

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
            status: EscrowStatus::Setup,
            created_at: now,
            expires_at,
            milestones: Vec::new(&env),
        };

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

    pub fn release_milestone(env: Env, job_id: u64, milestone_index: u32) {
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

        let m_key = DataKey::Milestone(job_id, milestone_index);
        let mut milestone: Milestone = env.storage().persistent().get(&m_key).expect("invalid milestone index");

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
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");

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

        let total_payout = payee_amount.checked_add(payer_amount).expect("overflow calculation error");
        let remaining_pool = job.total_amount.checked_sub(job.released_amount).expect("Underflow tracking remaining pool");
        assert!(total_payout == remaining_pool, "Total payout must exactly match the remaining escrow funds");

        let token_client = TokenClient::new(&env, &job.token);

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

    pub fn get_milestone(env: Env, job_id: u64, index: u32) -> Milestone {
        let job: EscrowJob = env
            .storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .expect("job not found");
        job.milestones.get(index).expect("milestone not found")
    }

    pub fn get_milestone_status(env: Env, job_id: u64) -> Vec<MilestoneStatus> {
        let job: EscrowJob = env.storage().persistent().get(&DataKey::Job(job_id)).expect("job not found");
        let mut statuses = Vec::new(&env);
        for m in job.milestones.iter() {
            statuses.push_back(m.status);
        }
        statuses
    }

    pub fn get_current_sequence(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::SequenceCounter).unwrap_or(0u64)
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
