// contracts/escrow/src/error.rs
//
// SC-SEC-072: Extended error codes covering address-poisoning defences.
//
// All variants map to a unique u32 so clients can pattern-match on the
// XDR error code without depending on the symbol string (which costs extra
// ledger bytes per invocation). Keep variants sorted by numeric value.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    // ── Authorisation ──────────────────────────────────────────────
    /// Caller is not the expected party for this operation.
    Unauthorized = 1,

    // ── State machine ──────────────────────────────────────────────
    /// Escrow has already been initialised.
    AlreadyInitialised = 2,
    /// Escrow is not in the required state for this operation.
    InvalidState = 3,
    /// Milestone index is out of bounds.
    InvalidMilestone = 4,

    // ── Funds ──────────────────────────────────────────────────────
    /// Deposited amount is zero or below minimum.
    InsufficientDeposit = 5,
    /// Token transfer failed.
    TransferFailed = 6,

    // ── Re-entrancy ────────────────────────────────────────────────
    /// A re-entrant call was detected and aborted.
    ReentrancyDetected = 7,

    // ── Address validation (SC-SEC-072) ────────────────────────────
    /// Raw XDR decode produced fewer than 32 bytes — malformed input.
    AddressDecodeFailed = 8,
    /// The all-zero address (GAAAAAA…) was supplied — invalid on Stellar.
    ZeroAddress = 9,
    /// Address matches the prefix+suffix of a registered party but differs
    /// in the middle — classic address-poisoning signature.
    PoisonedAddress = 10,
    /// Client and freelancer address are identical — role-binding violation.
    AddressRoleConflict = 11,
    /// A dispute was raised but the judge address has not been registered.
    JudgeNotRegistered = 12,
}