use crate::profile::Profile;
use soroban_sdk::{Address, Env};

const PERSISTENT_TTL_THRESHOLD: u32 = 50_000;
const PERSISTENT_TTL_EXTEND_TO: u32 = 150_000;

#[soroban_sdk::contracttype]
pub enum StorageKey {
    Profile(Address),
}

pub fn read_profile(env: &Env, address: &Address) -> Option<Profile> {
    let key = StorageKey::Profile(address.clone());
    if env.storage().persistent().has(&key) {
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
    }

    env.storage().persistent().get(&key)
}

pub fn read_profile_or_default(env: &Env, address: &Address) -> Profile {
    read_profile(env, address).unwrap_or_else(|| Profile::new(env, address.clone()))
}

pub fn write_profile(env: &Env, address: &Address, profile: &Profile) {
    let key = StorageKey::Profile(address.clone());
    env.storage().persistent().set(&key, profile);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}
