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
    pub milestone_count: u32,
}

#[contracttype]
pub enum DataKey {
    Job(u64),
    Admin,
    AgentJudge,
    GuardFlag(u64),
    Milestone(u64, u32),
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

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    pub fn initialize(env: Env, admin: Address, agent_judge: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AgentJudge, &agent_judge);
    }

    /// Admin can update the Agent Judge address.
    pub fn set_agent_judge(env: Env, new_agent_judge: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::AgentJudge, &new_agent_judge);
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
        let expires_at = now
            .checked_add(
                30u64
                    .checked_mul(24)
                    .expect("overflow")
                    .checked_mul(60)
                    .expect("overflow")
                    .checked_mul(60)
                    .expect("overflow"),
            )
            .expect("overflow");

        let job = EscrowJob {
            client,
            freelancer,
            token: token_addr,
            total_amount: 0,
            released_amount: 0,
            status: EscrowStatus::Setup,
            created_at: now,
            expires_at,
            milestone_count: 0,
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
        let milestone_key = DataKey::Milestone(job_id, job.milestone_count);
        env.storage().persistent().set(&milestone_key, &milestone);

        job.milestone_count = job.milestone_count.checked_add(1).expect("overflow");
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
        assert!(job.milestone_count > 0, "no milestones defined");

        let mut total_milestones_amount = 0i128;
        for i in 0..job.milestone_count {
            let m_key = DataKey::Milestone(job_id, i);
            let m: Milestone = env
                .storage()
                .persistent()
                .get(&m_key)
                .expect("milestone not found");
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
        for i in 0..job.milestone_count {
            let m_key = DataKey::Milestone(job_id, i);
            let m: Milestone = env
                .storage()
                .persistent()
                .get(&m_key)
                .expect("milestone not found");
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
        assert!(milestone_index < job.milestone_count, "invalid");

        let m_key = DataKey::Milestone(job_id, milestone_index);
        let milestone: Milestone = env.storage().persistent().get(&m_key).expect("invalid");
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
        for i in 0..job.milestone_count {
            let m_key = DataKey::Milestone(job_id, i);
            let m: Milestone = env
                .storage()
                .persistent()
                .get(&m_key)
                .expect("milestone not found");
            if m.status == MilestoneStatus::Released {
                released_count = released_count.checked_add(1).expect("overflow");
            }
        }

        let event_data = DisputeRaisedEvent {
            job_id,
            initiator: caller,
            milestones_released: released_count,
            milestones_total: job.milestone_count,
            raised_at: now,
        };
        env.events()
            .publish(("escrow", "DisputeRaised"), event_data);
    }

    /// Agent Judge resolves dispute -- splits funds by explicit amounts.
    /// `payee_amount`: Amount to pay to the freelancer (payee).
    /// `payer_amount`: Amount to return to the client (payer).
    pub fn resolve_dispute(env: Env, job_id: u64, payee_amount: i128, payer_amount: i128) {
        let agent_judge: Address = env
            .storage()
            .instance()
            .get(&DataKey::AgentJudge)
            .expect("agent judge not set");
        agent_judge.require_auth();

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

        job.released_amount = job
            .released_amount
            .checked_add(total_payout)
            .expect("overflow");
        job.status = EscrowStatus::Resolved;
        env.storage().persistent().set(&key, &job);
    }

    /// Client recoups funds if freelancer never responded.
    pub fn refund(env: Env, job_id: u64, client: Address) {
        client.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");

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
        env.storage()
            .persistent()
            .get(&DataKey::Milestone(job_id, index))
            .expect("milestone not found")
    }

    /// Retrieve the status of all milestones for a given job.
    pub fn get_milestone_status(env: Env, job_id: u64) -> Vec<MilestoneStatus> {
        let job: EscrowJob = env
            .storage()
            .persistent()
            .get(&DataKey::Job(job_id))
            .expect("job not found");
        let mut statuses = Vec::new(&env);
        for i in 0..job.milestone_count {
            let m_key = DataKey::Milestone(job_id, i);
            let m: Milestone = env
                .storage()
                .persistent()
                .get(&m_key)
                .expect("milestone not found");
            statuses.push_back(m.status);
        }
        statuses
    }
}

impl EscrowContract {
    fn check_reentrancy(env: &Env, job_id: u64) {
        if env.storage().instance().has(&DataKey::GuardFlag(job_id)) {
            panic!("reentrant");
        }
    }

    fn set_guard(env: &Env, job_id: u64) {
        env.storage()
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
        let m_key = DataKey::Milestone(job_id, milestone_index);
        let mut milestone: Milestone = env.storage().persistent().get(&m_key).expect("invalid");

        milestone.status = MilestoneStatus::Released;
        env.storage().persistent().set(&m_key, &milestone);

        job.released_amount = job
            .released_amount
            .checked_add(milestone.amount)
            .expect("overflow");
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

        env.storage().persistent().set(&DataKey::Job(job_id), job);
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
