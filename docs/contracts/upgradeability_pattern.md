# Upgradeability Pattern

## Overview

This document describes the admin-gated contract upgrade pattern used in Lance Soroban contracts.

The pattern enables controlled WASM upgrades while preserving on-chain state and minimizing attack surface.

## Contracts Covered

- `contracts/escrow/src/lib.rs`
- `contracts/job_registry/src/lib.rs`
- `contracts/reputation/src/lib.rs`

## Pattern

1. Authorized upgrade caller is checked on-chain.
2. Caller must pass `require_auth()`.
3. Contract verifies caller matches stored upgrade/admin authority.
4. Contract executes `env.deployer().update_current_contract_wasm(new_wasm_hash)`.
5. Contract emits a `ContractUpgraded` event for auditability.

## Escrow

- Uses existing `DataKey::Admin` as upgrade authority.
- New method: `upgrade(env, caller, new_wasm_hash) -> Result<(), EscrowError>`.
- New error code: `UpgradeUnauthorized`.
- New event: `ContractUpgraded`.

## JobRegistry

- Adds explicit upgrade authority management:
  - `DataKey::UpgradeAdmin`
  - `init_upgrade_admin(env, admin)` (one-time)
  - `set_upgrade_admin(env, caller, new_admin)`
  - `get_upgrade_admin(env)`
  - `upgrade(env, caller, new_wasm_hash)`
- New errors:
  - `UpgradeAdminAlreadySet`
  - `UpgradeAdminNotSet`
  - reuses `Unauthorized` for non-admin calls.
- New events:
  - `UpgradeAdminSet`
  - `ContractUpgraded`

## Reputation

- Uses existing `DataKey::Admin` as upgrade authority.
- New method: `upgrade(env, caller, new_wasm_hash) -> Result<(), ReputationError>`.
- New errors:
  - `NotInitialized`
  - `Unauthorized`
- New event: `ContractUpgraded`.

## Security Considerations

- Upgrade authority checks are explicit and enforced before WASM update call.
- State-changing upgrade operations emit events for off-chain monitoring.
- No reentrancy-sensitive external call sequence was introduced.
- Existing business logic and storage schemas remain backward compatible.

## Operational Guidance

- Use multisig/governance-controlled admin addresses in production.
- Rotate `JobRegistry` upgrade admin with `set_upgrade_admin` when operational roles change.
- Validate new WASM hash in staging/testnet before main deployment.
