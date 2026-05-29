#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

/// Storage keys for persistent and instance-based configuration.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,                  // Address of the contract administrator
    EscrowConfig(Address),  // Configuration details per Escrow Agreement
    SequenceCounter,        // Global incrementing counter for release sequence numbers
}

/// Structural representation of an Escrow Agreement parameters.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowConfig {
    pub arbiter: Address,
    pub vendor: Address,
    pub amount: i128,
    pub is_released: bool,
}

/// Highly structured event payload for absolute indexer determinism.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowReleaseEvent {
    pub sequence_number: u64,
    pub client: Address,
    pub vendor: Address,
    pub amount_released: i128,
}

#[contract]
pub struct LanceEscrowContract;

#[contractimpl]
impl LanceEscrowContract {
    /// Initializes the global administrator for the Escrow deployment.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::SequenceCounter, &0u64);
    }

    /// Creates a new escrow agreement between a client and a vendor managed by an arbiter.
    pub fn create_escrow(
        env: Env,
        client: Address,
        arbiter: Address,
        vendor: Address,
        amount: i128,
    ) {
        client.require_auth();

        if amount <= 0 {
            panic!("Escrow amount must be positive");
        }

        let config_key = DataKey::EscrowConfig(client.clone());
        if env.storage().persistent().has(&config_key) {
            panic!("Escrow agreement already exists for this client");
        }

        let config = EscrowConfig {
            arbiter,
            vendor,
            amount,
            is_released: false,
        };

        env.storage().persistent().set(&config_key, &config);
    }

    /// Executes an escrow release. Emits optimized sequence events for downstream indexers.
    pub fn release_escrow(env: Env, client: Address) {
        let config_key = DataKey::EscrowConfig(client.clone());

        if !env.storage().persistent().has(&config_key) {
            panic!("Escrow agreement not found");
        }

        let mut config: EscrowConfig = env.storage().persistent().get(&config_key).unwrap();

        if config.is_released {
            panic!("Escrow funds have already been released");
        }

        config.arbiter.require_auth();

        let current_sequence: u64 = env.storage().instance().get(&DataKey::SequenceCounter).unwrap_or(0u64);
        let next_sequence = current_sequence.checked_add(1).expect("Sequence counter overflow protection triggered");

        config.is_released = true;

        env.storage().persistent().set(&config_key, &config);
        env.storage().instance().set(&DataKey::SequenceCounter, &next_sequence);

        let event_payload = EscrowReleaseEvent {
            sequence_number: next_sequence,
            client: client.clone(),
            vendor: config.vendor.clone(),
            amount_released: config.amount,
        };

        env.events().publish(
            (Symbol::new(&env, "escrow_release"), client),
            event_payload,
        );
    }

    /// Returns the configuration parameters of an active escrow.
    pub fn get_escrow_config(env: Env, client: Address) -> Option<EscrowConfig> {
        let config_key = DataKey::EscrowConfig(client);
        env.storage().persistent().get(&config_key)
    }

    /// Returns the global sequence tracking counter used for indexer syncing.
    pub fn get_current_sequence(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::SequenceCounter).unwrap_or(0u64)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
    use soroban_sdk::{Address, Env, IntoVal};

    #[test]
    fn test_initialize_and_create_escrow() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let arbiter = Address::generate(&env);
        let vendor = Address::generate(&env);

        let contract_id = env.register_contract(None, LanceEscrowContract);
        let cc = LanceEscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.create_escrow(&client, &arbiter, &vendor, &10_000i128);

        let config = cc.get_escrow_config(&client).expect("config missing");
        assert_eq!(config.arbiter, arbiter);
        assert_eq!(config.vendor, vendor);
        assert_eq!(config.amount, 10_000);
        assert!(!config.is_released);
        assert_eq!(cc.get_current_sequence(), 0);
    }

    #[test]
    fn test_release_escrow_increments_sequence() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let arbiter = Address::generate(&env);
        let vendor = Address::generate(&env);

        let contract_id = env.register_contract(None, LanceEscrowContract);
        let cc = LanceEscrowContractClient::new(&env, &contract_id);

        cc.initialize(&admin);
        cc.create_escrow(&client, &arbiter, &vendor, &5_000i128);
        assert_eq!(cc.get_current_sequence(), 0);

        cc.release_escrow(&client);

        assert_eq!(cc.get_current_sequence(), 1);
        let config = cc.get_escrow_config(&client).expect("config missing");
        assert!(config.is_released);
    }

    #[test]
    #[should_panic]
    fn test_release_escrow_requires_arbiter_auth() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let client = Address::generate(&env);
        let arbiter = Address::generate(&env);
        let vendor = Address::generate(&env);

        let contract_id = env.register_contract(None, LanceEscrowContract);
        let cc = LanceEscrowContractClient::new(&env, &contract_id);

        env.mock_auths(&[
            MockAuth {
                address: &admin,
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "initialize",
                    args: (admin.clone(),).into_val(&env),
                    sub_invokes: &[],
                },
            },
            MockAuth {
                address: &client,
                invoke: &MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "create_escrow",
                    args: (client.clone(), arbiter.clone(), vendor.clone(), 5_000i128)
                        .into_val(&env),
                    sub_invokes: &[],
                },
            },
        ]);

        cc.initialize(&admin);
        cc.create_escrow(&client, &arbiter, &vendor, &5_000i128);

        cc.release_escrow(&client);
    }
}
