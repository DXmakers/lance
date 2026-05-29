# Soulbound Badge NFT Tiers Implementation
## Issue #396 [SC-REP-042]

### Overview
This document describes the implementation of soulbound badge NFT tiers for freelancer levels within the Reputation smart contract. Badges are non-transferable reputation rewards that automatically upgrade as freelancers achieve performance milestones.

---

## Architecture

### Badge Tiers
Four distinct tiers with specific requirements:

| Tier | Reputation Score | Completed Jobs | Badge Meaning |
|------|------------------|-----------------|-------------|
| None | N/A | N/A | No achievement |
| Bronze | ≥ 6000 BPS | ≥ 5 | Entry-level established freelancer |
| Silver | ≥ 7500 BPS | ≥ 15 | Proven track record |
| Gold | ≥ 9000 BPS | ≥ 30 | Highly skilled |
| Platinum | ≥ 9500 BPS | ≥ 50 | Elite performer |

**Soulbound Property**: Badges cannot be transferred, sold, or revoked arbitrarily. They remain bound to the freelancer's account and reflect cumulative performance.

---

## Data Structures

### `Profile` Struct
Extends reputation tracking with badge-specific fields:

```rust
pub struct Profile {
    pub address: Address,
    pub role: Role,
    pub badge_tier: BadgeTier,
    /// Average rating in fixed-point format (1000 = 1.0, 5000 = 5.0)
    pub avg_rating: i32,
    /// Number of completed jobs
    pub completed_jobs: u32,
    /// Total reputation score in basis points
    pub reputation_score: i32,
    /// Total review points collected
    pub total_review_points: i32,
    /// Number of reviews received
    pub review_count: u32,
    /// Last timestamp when rating was updated (for decay calculations)
    pub last_updated: u64,
}
```

### `BadgeTier` Enum
```rust
pub enum BadgeTier {
    None,
    Bronze,
    Silver,
    Gold,
    Platinum,
}
```

### `DataKey` Enum
Enhanced with profile storage:
```rust
pub enum DataKey {
    Score(Address, Role),           // Legacy reputation score
    Profile(Address, Role),          // New profile with badge data
    Admin,
    JobRegistry,
    Reviewed(u64, Address),
    AuthorizedContracts,
}
```

---

## Fixed-Point Arithmetic Module

Safe mathematical operations prevent overflow/underflow:

### `fixed_point::multiply(a: i32, b: i32) -> i32`
- Multiplies two fixed-point numbers (1000 = 1.0)
- Uses `i128` internally to prevent overflow
- Returns result clamped to valid range

### `fixed_point::divide(numerator: i32, denominator: i32) -> i32`
- Divides fixed-point numbers safely
- Returns zero for division by zero
- Uses `i128` for precision

### `fixed_point::calculate_avg_rating(total_points: i32, count: u32) -> i32`
- Converts raw rating points to fixed-point average
- Clamps result to valid range [1000, 5000] (1.0-5.0 stars)
- Returns 0 for empty accounts

### `fixed_point::apply_decay(initial_score: i32, periods_elapsed: u32) -> i32`
- Applies exponential decay (~1% per period)
- Uses 0.99 decay factor: `score * (990/1000)^periods`
- Capped at 100 iterations to prevent excessive computation
- Ensures score never goes negative

---

## Core Functions

### `initialize(env: Env, admin: Address)`
Initializes the contract with admin credentials. Must be called once before other functions.

### `set_job_registry(env: Env, admin: Address, registry: Address)`
Configures the JobRegistry contract address for cross-contract calls.
- **Authorization**: Admin only
- **Security**: Prevents rating submissions without verified job context

### `load_profile(env: Env, address: Address, role: Role) -> Profile`
Internal function to retrieve or create a profile.
- **Safety**: Never panics on empty accounts
- **Defaults**: Returns initialized profile with `badge_tier: None`

### `save_profile(env: Env, profile: &Profile)`
Persists profile to storage with all badge and rating data.

### `get_profile(env: Env, address: Address, role: Role) -> Profile`
Public getter for profile data. Returns current badge tier and metrics.

### `get_badge_tier(env: Env, address: Address) -> BadgeTier`
Public getter for badge tier only.

### `submit_rating(env: Env, caller: Address, job_id: u64, target: Address, score: u32)`
Submits a rating for a completed job and triggers badge upgrade checks.

**Flow**:
1. Verify caller is authorized (must be contract participant or authenticated)
2. Verify job exists and is completed
3. Verify caller participated in the job
4. Prevent duplicate reviews
5. Update profile with new rating
6. Recalculate average rating using fixed-point arithmetic
7. Update reputation score based on average
8. **Automatically trigger badge tier calculation**
9. Store updated profile
10. Maintain backward compatibility with legacy `ReputationScore`

**Badge Upgrade**: Triggered automatically when reviewing submissions cause thresholds to be crossed.

### `update_score(env: Env, address: Address, role: Role, delta: i32)`
Adjusts reputation by delta basis points.
- **Authorization**: Admin only
- **Logic**: Clamps final score to [0, 10000]
- **Badge Check**: Recalculates badge tier after update
- **Automatic Upgrade**: Badge upgrades immediately if new score meets tier requirements

### `slash(env: Env, address: Address, role: Role, reason: Symbol)`
Reduces score by 20% (2000 basis points) for fraud/abandonment.
- **Authorization**: Admin only
- **Side Effects**: May downgrade badge if score falls below tier threshold
- **Reason Tracking**: Logs reason for audit trail

### `get_score(env: Env, address: Address, role: Role) -> ReputationScore`
Returns legacy reputation score struct for backward compatibility.

### `get_public_metrics(env: Env, address: Address, role_name: Symbol) -> Vec<i128>`
Returns frontend-friendly metrics: `[score_bps, total_jobs, total_points, reviews]`

---

## Security Measures

### Authorization Checks
1. **Caller Authentication**: All critical functions require `caller.require_auth()`
2. **Job Verification**: Ratings must reference completed jobs from JobRegistry
3. **Participant Verification**: Only job participants can submit reviews
4. **Admin-Only Functions**: `update_score`, `slash`, and `set_job_registry` require admin signature

### Unverified Review Prevention
- Reviews without completed job context are rejected
- Double-review attempts return error (no state modification)
- Cross-contract calls validated against registered JobRegistry

### Overflow Protection
- All arithmetic uses `saturating_add/sub` to prevent overflow
- Fixed-point operations use `i128` internally
- Score always clamped to valid range [0, 10000]
- Rating values clamped to [1, 5]

---

## Testing

### Test Coverage

#### 1. `test_profile_load_save_empty_account()`
✓ Profiles load and save correctly without panicking on empty accounts
✓ Default profile initialized with correct values

#### 2. `test_badge_tier_none()`
✓ New accounts receive `BadgeTier::None`

#### 3. `test_badge_upgrade_to_bronze()`
✓ Badge upgrades to Bronze when score ≥ 6000 BPS and jobs ≥ 5
✓ Profile state reflects immediately

#### 4. `test_badge_upgrade_to_silver()`
✓ Badge upgrades to Silver when score ≥ 7500 BPS and jobs ≥ 15

#### 5. `test_badge_upgrade_to_gold()`
✓ Badge upgrades to Gold when score ≥ 9000 BPS and jobs ≥ 30

#### 6. `test_badge_upgrade_to_platinum()`
✓ Badge upgrades to Platinum when score ≥ 9500 BPS and jobs ≥ 50

#### 7. `test_badge_level_changes_immediately()`
✓ Badge level changes reflect immediately after score update
✓ Transitional states verified (None → Bronze → Silver)

#### 8. `test_badge_downgrade_on_slash()`
✓ Badge downgrades when score falls below tier threshold
✓ Fraud penalty correctly applied

#### 9. `test_unverified_review_rejected()`
✓ Arbitrary direct reviews from unverified public keys are rejected
✓ Authorization checks prevent unauthorized score modifications

#### 10. `test_fixed_point_arithmetic()`
✓ Fixed-point multiply/divide operations prevent overflow
✓ Safe handling of edge cases (zero divisor, large numbers)

#### 11. `test_fixed_point_decay()`
✓ Exponential decay correctly applied
✓ Scores never go negative
✓ Decay factor applied consistently

---

## Acceptance Criteria Fulfillment

### ✓ Reputation profiles load and save correctly without panicking on empty accounts
- `load_profile()` returns initialized profile with default values
- No `unwrap()` calls that could panic
- Tests: `test_profile_load_save_empty_account()`

### ✓ Badge upgrades trigger and level changes reflect immediately in the public getters
- Badge tier calculated on each `submit_rating()` call
- `get_badge_tier()` reflects latest state
- Immediate visibility via `get_profile()`
- Tests: `test_badge_upgrade_to_*()`, `test_badge_level_changes_immediately()`

### ✓ Vulnerability tests prove that arbitrary direct reviews from unverified public keys are rejected
- `submit_rating()` requires job context from JobRegistry
- Authorization checks enforce authentication
- Double-review prevention active
- Tests: `test_unverified_review_rejected()`

---

## Implementation Details

### Score Calculation Formula
```
avg_rating_fp = total_points * 1000 / review_count
reputation_score_bps = (avg_rating_fp * 2) / 1000
range: [2000, 10000] BPS (corresponding to 1-5 star average)
```

### Badge Tier Calculation
```
if score >= 9500 AND jobs >= 50:
    Platinum
else if score >= 9000 AND jobs >= 30:
    Gold
else if score >= 7500 AND jobs >= 15:
    Silver
else if score >= 6000 AND jobs >= 5:
    Bronze
else:
    None
```

### Decay Formula
```
decayed_score = initial_score * (0.99)^periods_elapsed
maximum iterations: 100
minimum result: 0
```

---

## Backward Compatibility

Legacy `ReputationScore` struct remains supported:
- Both `Profile` and `ReputationScore` updated simultaneously
- Existing queries continue working
- New functionality accessible via `get_profile()` and `get_badge_tier()`

---

## Future Enhancements

1. **Time-Based Decay**: Implement reputation decay for inactive freelancers
2. **Badge Metadata**: Add IPFS hashes for badge artwork/certificates
3. **Dispute Resolution**: Special case handling for disputed transactions
4. **Role-Based Badges**: Implement separate badge tracks for clients
5. **Milestone Events**: Emit events on badge upgrades for indexing

---

## Deployment Notes

1. Deploy contract with `initialize()` call
2. Register JobRegistry contract with `set_job_registry()`
3. Admin must authorize first rating submissions until JobRegistry is registered
4. Monitor storage usage for profile growth
5. Plan for reputation decay implementation in future versions

---

## Code Quality

- ✓ No compiler errors (verified with `cargo check`)
- ✓ Safe arithmetic (no overflow/underflow possible)
- ✓ Comprehensive test coverage (11 test cases)
- ✓ Clear documentation for all public functions
- ✓ Fixed-point arithmetic prevents floating-point precision issues
- ✓ Authorization checks on all state-modifying functions
