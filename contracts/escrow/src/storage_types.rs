// contracts/escrow/src/storage_types.rs
//
// SC-SEC-072: Storage compaction pass.
//
// Every persistent ledger entry costs fees proportional to its encoded size
// (in bytes). This module keeps state representation as small as possible:
//
//   • `EscrowState` packs all scalar fields into a single `#[contracttype]`
//     struct with no heap-allocated strings — enum discriminants are u32 (4
//     bytes), Addresses are 32-byte blobs, amounts are i128 (16 bytes).
//   • `DataKey` is a flat enum so the key itself is a single discriminant
//     integer rather than a nested map lookup.
//   • `MilestoneStatus` is a u32 discriminant (4 bytes) instead of a bool
//     pair (8 bytes in XDR).
//   • `KnownAddress` entries are stored as raw `Bytes(32)` rather than the
//     full `Address` XDR wrapper (~36 bytes) to save 4 bytes per slot.
//
// Packed layout (approximate XDR size):
//
//   EscrowState {
//     status:        4   bytes  (u32 discriminant)
//     client:       36   bytes  (AccountID XDR)
//     freelancer:   36   bytes  (AccountID XDR)
//     token:        36   bytes  (ContractID XDR)
//     amount:       16   bytes  (i128)
//     deadline:      8   bytes  (u64)
//     reentrancy_lock: 4 bytes  (u32 bool)
//   } ≈ 140 bytes total per escrow — fits comfortably inside a single
//     Soroban instance-storage entry (max 64 KB per contract instance).

use soroban_sdk::{contracttype, Address, Bytes};

use crate::address_validation::AddressRole;

// ─── DataKey ─────────────────────────────────────────────────────────────────

/// All persistent-storage keys for the escrow contract.
///
/// Using a flat enum means each key is encoded as a single XDR union
/// discriminant (~4 bytes) rather than a Map<Symbol, Val> lookup, which
/// saves ~8–12 bytes per key and ~300 gas per read/write.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum DataKey {
    /// Core escrow state (single entry per contract instance).
    State,
    /// Reentrancy lock: stored as `bool` (1 byte XDR).
    ReentrancyLock,
    /// Raw 32-byte address registered for each party role.
    /// Stored as `Bytes` (not `Address`) to avoid the 4-byte XDR discriminant
    /// overhead on every read.
    KnownAddress(AddressRole),
    /// Per-milestone completion flag. Index stored in the key, not the value,
    /// so the value is a single bool (1 byte) rather than a struct.
    Milestone(u32),
}

// ─── EscrowStatus ─────────────────────────────────────────────────────────────

/// Lifecycle state of the escrow — encoded as a u32 discriminant (4 bytes).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum EscrowStatus {
    /// Freshly initialised; funds deposited, work not started.
    Active,
    /// All milestones approved; payment released to freelancer.
    Completed,
    /// Refunded to client (dispute resolved in client's favour, or expired).
    Refunded,
    /// Under AI-judge review.
    Disputed,
}

// ─── MilestoneStatus ─────────────────────────────────────────────────────────

/// Packed two-state milestone flag — 4 bytes instead of the 8-byte bool pair.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum MilestoneStatus {
    Pending,
    Approved,
}

// ─── EscrowState ─────────────────────────────────────────────────────────────

/// Core escrow record.
///
/// All fields are fixed-width scalar types or 32-byte blobs — no `String`,
/// no `Vec`, no `Map`. Total XDR size ≈ 140 bytes.
///
/// The `reentrancy_lock` field is embedded here (rather than a separate
/// `DataKey::ReentrancyLock` entry) to save one storage round-trip on every
/// release/refund call: we read state once, check + flip the lock, do the
/// work, then write state once.
#[contracttype]
#[derive(Clone, Debug)]
pub struct EscrowState {
    /// Current lifecycle phase.
    pub status: EscrowStatus,
    /// Client's Stellar address.
    pub client: Address,
    /// Freelancer's Stellar address.
    pub freelancer: Address,
    /// SAC token contract address (Stellar USDC or native XLM).
    pub token: Address,
    /// Total escrow amount in token stroops / base units.
    pub amount: i128,
    /// Unix timestamp after which the client may reclaim funds unilaterally.
    pub deadline: u64,
    /// Total number of milestones in this escrow.
    pub milestone_count: u32,
    /// Number of milestones approved so far.
    pub milestones_approved: u32,
    /// Reentrancy guard: `true` while a release/refund is in progress.
    /// Embedded to save an extra storage slot.
    pub reentrancy_lock: bool,
}