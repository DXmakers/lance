#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

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
}

#[contracttype]
pub enum DataKey {
    Job(u64),
    Admin,
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
        };
        env.storage().persistent().set(&key, &job);
    }

    /// Client approves a milestone -- releases proportional USDC to freelancer.
    pub fn release_milestone(env: Env, job_id: u64, caller: Address) {
        caller.require_auth();

        let key = DataKey::Job(job_id);
        let mut job: EscrowJob = env.storage().persistent().get(&key).expect("job not found");

        assert!(job.status == EscrowStatus::Active, "job not active");
        assert!(caller == job.client, "only client can release");
        assert!(
            job.milestones_released < job.milestones,
            "all milestones already released"
        );

        let per_milestone = job.total_amount / (job.milestones as i128);
        job.milestones_released += 1;
        job.released_amount += per_milestone;

        let token_client = token::Client::new(&env, &job.token);
        token_client.transfer(
            &env.current_contract_address(),
            &job.freelancer,
            &per_milestone,
        );

        if job.milestones_released == job.milestones {
            let remainder = job.total_amount - job.released_amount;
            if remainder > 0 {
                token_client.transfer(&env.current_contract_address(), &job.freelancer, &remainder);
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
            token_client.transfer(&env.current_contract_address(), &job.client, &client_share);
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
        // Freelancer: 2500 (milestone) + 3750 (50% of 7500 remaining) = 6250
        assert_eq!(tc.balance(&freelancer), 6250);
        // Client: 100000 - 10000 (deposited) + 3750 (50% of 7500) = 93750
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
}
