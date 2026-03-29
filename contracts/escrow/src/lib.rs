#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Vec};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum EscrowStatus {
    Active,
    Completed,
    Disputed,
    Resolved,
    Refunded,
}

#[contracttype]
#[derive(Clone)]
pub struct EscrowJob {
    pub client: Address,
    pub freelancer: Address,
    pub token: Address,
    pub total_amount: i128,
    pub released_amount: i128,
    pub milestones: u32,
    pub milestones_released: u32,
    pub status: EscrowStatus,
    pub created_at: u64,
    pub expires_at: u64,
    pub milestones_completed: Vec<bool>,
}

#[contracttype]
pub enum DataKey {
    Job(u64),
    Admin,
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
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Client deposits USDC and opens an escrow job.
    pub fn deposit(
        env: Env,
        job_id: u64,
        client: Address,
        freelancer: Address,
        token_addr: Address,
        amount: i128,
        milestones: u32,
    ) {
        client.require_auth();
        assert!(milestones > 0, "milestones must be > 0");
        assert!(amount > 0, "amount must be > 0");

        let key = DataKey::Job(job_id);
        if env.storage().persistent().has(&key) {
            panic!("job already exists");
        }
        let now: u64 = env.ledger().timestamp();
        let expires_at = now + 30 * 24 * 60 * 60;

        let mut completed: Vec<bool> = Vec::new(&env);
        let mut i = 0u32;
        while i < milestones {
            completed.push_back(false);
            i += 1;
        }

        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&client, &env.current_contract_address(), &amount);

        let job = EscrowJob {
            client,
            freelancer,
            token: token_addr,
            total_amount: amount,
            released_amount: 0,
            milestones,
            milestones_released: 0,
            status: EscrowStatus::Active,
            created_at: now,
            expires_at,
            milestones_completed: completed,
        };
        env.storage().persistent().set(&key, &job);
    }

    /// Client approves a milestone -- releases proportional USDC to freelancer.
    pub fn release_milestone(env: Env, job_id: u64, caller: Address) {
        caller.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");

        assert!(
            job.milestones_released < job.milestones,
            "all milestones already released"
        );
        assert!(job.status == EscrowStatus::Active, "job not active");
        assert!(caller == job.client, "only client can release");

        let idx = job.milestones_released;
        let already: bool = job
            .milestones_completed
            .get(idx)
            .expect("invalid milestone index");
        assert!(!already, "milestone already released");

        let per_milestone = job.total_amount / (job.milestones as i128);
        job.milestones_released += 1;
        job.released_amount += per_milestone;
        job.milestones_completed.set(idx, true);

        let token_client = token::Client::new(&env, &job.token);
        token_client.transfer(
            &env.current_contract_address(),
            &job.freelancer,
            &per_milestone,
        );

        if job.milestones_released == job.milestones {
            let remainder = job.total_amount - job.released_amount;
            if remainder > 0 {
                token_client.transfer(
                    &env.current_contract_address(),
                    &job.freelancer,
                    &remainder,
                );
                job.released_amount += remainder;
            }
            job.status = EscrowStatus::Completed;
        }

        env.storage().persistent().set(&key, &job);
    }

    /// Happy-path release for an explicit milestone index (0-based).
    /// Only the client may call this to release the funds for a specific milestone.
    pub fn release_funds(env: Env, job_id: u64, caller: Address, milestone_index: u32) {
        caller.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");

        assert!(job.status == EscrowStatus::Active, "job not active");
        assert!(caller == job.client, "only client can release");
        assert!(milestone_index < job.milestones, "invalid milestone index");

        let already: bool = job
            .milestones_completed
            .get(milestone_index)
            .expect("invalid milestone index");
        assert!(!already, "milestone already released");

        let per_milestone = job.total_amount / (job.milestones as i128);

        let token_client = token::Client::new(&env, &job.token);
        token_client.transfer(
            &env.current_contract_address(),
            &job.freelancer,
            &per_milestone,
        );

        job.milestones_completed.set(milestone_index, true);
        job.milestones_released += 1;
        job.released_amount += per_milestone;

        if job.milestones_released == job.milestones {
            let remainder = job.total_amount - job.released_amount;
            if remainder > 0 {
                token_client.transfer(
                    &env.current_contract_address(),
                    &job.freelancer,
                    &remainder,
                );
                job.released_amount += remainder;
            }
            job.status = EscrowStatus::Completed;
        }

        env.storage().persistent().set(&key, &job);
    }

    /// Either party opens a dispute, locking remaining funds.
    pub fn open_dispute(env: Env, job_id: u64, caller: Address) {
        caller.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");

        assert!(job.status == EscrowStatus::Active, "job not active");
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
        let mut job: EscrowJob = env
            .storage()
            .persistent()
            .get(&key)
            .expect("job not found");

        // 2. Only client or freelancer may raise a dispute
        assert!(
            caller == job.client || caller == job.freelancer,
            "unauthorized: only client or freelancer can raise a dispute"
        );

        // 3. Job must still be active
        assert!(
            job.status == EscrowStatus::Active,
            "dispute cannot be raised: job is not active"
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

        // 7. Emit DisputeRaised event for backend / AI Judge to consume
        let event_data = DisputeRaisedEvent {
            job_id,
            initiator: caller,
            milestones_released: job.milestones_released,
            milestones_total: job.milestones,
            raised_at: now,
        };
        env.events()
            .publish(("escrow", "DisputeRaised"), event_data);
    }

    /// Admin (AI judge authority) resolves dispute -- splits funds by BPS.
    /// `freelancer_share_bps`: 0-10000 (100% = 10000).
    pub fn resolve_dispute(env: Env, job_id: u64, freelancer_share_bps: u32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        assert!(freelancer_share_bps <= 10_000, "bps out of range");

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");
        assert!(job.status == EscrowStatus::Disputed, "job not disputed");

        let remaining = job.total_amount - job.released_amount;
        let freelancer_share = (remaining * (freelancer_share_bps as i128)) / 10_000;
        let client_share = remaining - freelancer_share;

        let token_client = token::Client::new(&env, &job.token);
        if freelancer_share > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &job.freelancer,
                &freelancer_share,
            );
        }
        if client_share > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &job.client,
                &client_share,
            );
        }

        job.released_amount = job.total_amount;
        job.status = EscrowStatus::Resolved;
        env.storage().persistent().set(&key, &job);
    }

    /// Client recoups funds if freelancer never responded.
    pub fn refund(env: Env, job_id: u64, client: Address) {
        client.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");

        assert!(job.status == EscrowStatus::Active, "job not active");
        assert!(client == job.client, "only client can refund");

        let remaining = job.total_amount - job.released_amount;
        if remaining > 0 {
            let token_client = token::Client::new(&env, &job.token);
            token_client.transfer(
                &env.current_contract_address(),
                &job.client,
                &remaining,
            );
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
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &9000i128, &3u32);

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
    #[should_panic(expected = "already initialized")]
    fn test_double_init() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.initialize(&admin);
    }

    #[test]
    #[should_panic(expected = "only client can release")]
    fn test_unauthorized_release() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let rando = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &1000i128, &2u32);
        cc.release_milestone(&1u64, &rando);
    }

    #[test]
    fn test_dispute_50_50_split() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &10_000i128, &4u32);

        cc.release_milestone(&1u64, &client);
        let tc = token::Client::new(&env, &token_addr);
        assert_eq!(tc.balance(&freelancer), 2500);

        cc.open_dispute(&1u64, &freelancer);
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Disputed);

        cc.resolve_dispute(&1u64, &5000u32);
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
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &5000i128, &2u32);
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

    // --- Edge case and security tests ---

    #[test]
    #[should_panic(expected = "amount must be > 0")]
    fn test_deposit_zero_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &0i128, &1u32);
    }

    #[test]
    #[should_panic(expected = "amount must be > 0")]
    fn test_deposit_negative_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &-100i128, &1u32);
    }

    #[test]
    #[should_panic(expected = "job already exists")]
    fn test_double_deposit_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &1000i128, &2u32);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &1000i128, &2u32);
    }

    #[test]
    #[should_panic(expected = "only client can release")]
    fn test_unauthorized_release_funds_by_freelancer_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &1000i128, &2u32);
        cc.release_funds(&1u64, &freelancer, &0u32);
    }

    #[test]
    #[should_panic(expected = "invalid milestone index")]
    fn test_release_funds_invalid_index_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &1000i128, &2u32);
        cc.release_funds(&1u64, &client, &5u32);
    }

    #[test]
    #[should_panic(expected = "milestone already released")]
    fn test_release_funds_twice_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &1000i128, &2u32);
        cc.release_funds(&1u64, &client, &0u32);
        cc.release_funds(&1u64, &client, &0u32);
    }

    #[test]
    #[should_panic(expected = "all milestones already released")]
    fn test_release_milestone_overflow_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &900i128, &3u32);

        cc.release_milestone(&1u64, &client);
        cc.release_milestone(&1u64, &client);
        cc.release_milestone(&1u64, &client);
        cc.release_milestone(&1u64, &client);
    }

    #[test]
    #[should_panic(expected = "unauthorized")]
    fn test_open_dispute_by_rando_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let rando = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &1000i128, &2u32);
        cc.open_dispute(&1u64, &rando);
    }

    #[test]
    #[should_panic(expected = "job not disputed")]
    fn test_resolve_dispute_not_disputed_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &1000i128, &2u32);
        cc.resolve_dispute(&1u64, &5000u32);
    }

    #[test]
    #[should_panic(expected = "only client can refund")]
    fn test_refund_by_non_client_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &1000i128, &2u32);
        cc.refund(&1u64, &freelancer);
    }

    #[test]
    #[should_panic(expected = "job not active")]
    fn test_open_dispute_on_completed_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &9000i128, &3u32);

        cc.release_milestone(&1u64, &client);
        cc.release_milestone(&1u64, &client);
        cc.release_milestone(&1u64, &client);
        cc.open_dispute(&1u64, &freelancer);
    }

    #[test]
    #[should_panic]
    fn test_resolve_dispute_non_admin_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let rando = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &9000i128, &3u32);
        cc.resolve_dispute(&1u64, &5000u32);
    }

    #[test]
    #[should_panic(expected = "job not found")]
    fn test_get_job_not_found_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.get_job(&999u64);
    }

    // --- raise_dispute tests ---

    #[test]
    fn test_exhaustive_release_funds_path() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        
        let total_amount = 10_000i128;
        let num_milestones = 4u32;
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &total_amount, &num_milestones);

        let tc = token::Client::new(&env, &token_addr);
        assert_eq!(tc.balance(&contract_id), total_amount);
        assert_eq!(tc.balance(&client), 90_000); // 100k - 10k

        let per_milestone = total_amount / (num_milestones as i128);

        // Release milestones one by one in arbitrary order
        cc.release_funds(&1u64, &client, &2u32);
        assert_eq!(tc.balance(&freelancer), per_milestone);
        
        cc.release_funds(&1u64, &client, &0u32);
        assert_eq!(tc.balance(&freelancer), per_milestone * 2);

        cc.release_funds(&1u64, &client, &3u32);
        assert_eq!(tc.balance(&freelancer), per_milestone * 3);

        cc.release_funds(&1u64, &client, &1u32);
        
        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Completed);
        assert_eq!(tc.balance(&freelancer), total_amount);
        assert_eq!(tc.balance(&contract_id), 0);
        assert_eq!(tc.balance(&client), 90_000);
    }

    #[test]
    fn test_raise_dispute_by_client_locks_funds() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &9000i128, &3u32);

        cc.raise_dispute(&1u64, &client);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Disputed);
    }

    #[test]
    fn test_raise_dispute_by_freelancer_locks_funds() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &9000i128, &3u32);

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
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let rando = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &1000i128, &2u32);
        cc.raise_dispute(&1u64, &rando);
    }

    #[test]
    #[should_panic]
    fn test_raise_dispute_on_completed_job_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &9000i128, &3u32);

        cc.release_milestone(&1u64, &client);
        cc.release_milestone(&1u64, &client);
        cc.release_milestone(&1u64, &client);

        cc.raise_dispute(&1u64, &client);
    }

    #[test]
    #[should_panic]
    fn test_raise_dispute_blocks_release_funds() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &1000i128, &2u32);

        cc.raise_dispute(&1u64, &freelancer);

        // Should panic — job is now Disputednot Active
        cc.release_funds(&1u64, &client, &0u32);
    }

    #[test]
    fn test_raise_dispute_then_resolve() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_addr = setup_token(&env, &admin);
        mint(&env, &token_addr, &client);

        let contract_id = env.register_contract(None, EscrowContract);
        let cc = EscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.deposit(&1u64, &client, &freelancer, &token_addr, &10_000i128, &2u32);

        cc.raise_dispute(&1u64, &freelancer);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Disputed);

        // Admin resolves 70% to freelancer
        cc.resolve_dispute(&1u64, &7000u32);

        let job = cc.get_job(&1u64);
        assert_eq!(job.status, EscrowStatus::Resolved);

        let tc = token::Client::new(&env, &token_addr);
        assert_eq!(tc.balance(&freelancer), 7000);
        assert_eq!(tc.balance(&client), 93000);
    }
}
