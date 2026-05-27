# Quick Reference: Lance Marketplace Contracts

## 🚀 Quick Start

```bash
# Build contracts
cargo build --target wasm32-unknown-unknown --release --workspace

# Run all tests
cargo test --workspace

# Deploy to local network
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/job_registry.wasm --network local
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/escrow.wasm --network local
```

---

## 📋 Contract APIs

### job_registry Contract

#### Initialization
```rust
initialize(admin: Address)
```

#### Job Management
```rust
post_job(job_id: u64, client: Address, hash: Bytes, budget: i128)
post_job_auto(client: Address, hash: Bytes, budget: i128) -> u64
get_job(job_id: u64) -> JobRecord
```

#### Bidding
```rust
submit_bid(job_id: u64, freelancer: Address, proposal_hash: Bytes)
get_bids(job_id: u64) -> Vec<BidRecord>
accept_bid(job_id: u64, client: Address, freelancer: Address)
```

#### Deliverables
```rust
submit_deliverable(job_id: u64, freelancer: Address, hash: Bytes)
get_deliverable(job_id: u64) -> Bytes
```

#### Disputes
```rust
mark_disputed(job_id: u64)  // Admin only
```

### escrow Contract

#### Initialization
```rust
initialize(admin: Address, agent_judge: Address)
set_agent_judge(new_agent_judge: Address)
set_job_registry(job_registry: Address)
```

#### Job Setup
```rust
create_job(job_id: u64, client: Address, freelancer: Address, token_addr: Address)
add_milestone(job_id: u64, amount: i128)
deposit(job_id: u64, amount: i128)
```

#### Milestone Release
```rust
release_milestone(job_id: u64, caller: Address)
release_funds(job_id: u64, caller: Address, milestone_index: u32)
get_milestone_status(job_id: u64) -> Vec<MilestoneStatus>
```

#### Disputes
```rust
open_dispute(job_id: u64, caller: Address)
raise_dispute(job_id: u64, caller: Address)
resolve_dispute(job_id: u64, payee_amount: i128, payer_amount: i128)
```

#### Refunds
```rust
refund(job_id: u64, client: Address)
```

#### Queries
```rust
get_job(job_id: u64) -> EscrowJob
```

---

## 🔐 Security Features

### IPFS CID Validation

**Valid Formats:**
- CIDv0: `Qm...` (exactly 46 bytes)
- CIDv1: `b...`, `B...`, `z...`, `m...`, `u...` (34-96 bytes)

**Validation Points:**
- `post_job()` - Job metadata
- `submit_bid()` - Proposal hash
- `submit_deliverable()` - Deliverable hash

### Reentrancy Protection

**Protected Functions:**
- `deposit()`
- `release_milestone()`
- `release_funds()`
- `refund()`
- `resolve_dispute()`

**Pattern:**
```rust
enter_reentrancy_guard(&env);
// ... state updates ...
// ... external calls ...
exit_reentrancy_guard(&env);
```

### Overflow Protection

**All arithmetic uses checked operations:**
```rust
.checked_add()  // Addition
.checked_sub()  // Subtraction
.checked_mul()  // Multiplication
```

**Error:** `EscrowError::ArithmeticOverflow`

---

## 📊 Gas Optimization

### Optimized Operations

| Operation | Gas Reduction |
|-----------|---------------|
| `deposit` | -10% |
| `release_milestone` | -17% |
| `release_funds` | -18% |
| `refund` | -15% |

### Optimization Techniques

1. **Single TTL Bump:** One bump at end of operation
2. **Inline Validation:** Direct comparisons instead of negation
3. **Function Inlining:** `#[inline(always)]` on hot paths
4. **Early Exit:** Break loops when result found

---

## 🧪 Testing Commands

### Unit Tests

```bash
# All tests
cargo test --workspace

# Specific contract
cargo test --manifest-path contracts/job_registry/Cargo.toml
cargo test --manifest-path contracts/escrow/Cargo.toml

# Specific test category
cargo test cid                    # CID validation
cargo test reentrancy             # Reentrancy protection
cargo test overflow               # Overflow protection
cargo test optimization           # Gas optimization

# With output
cargo test -- --nocapture

# Specific test
cargo test test_valid_cidv0_accepted
```

### Integration Tests

```bash
# Start local network
soroban network start local

# Deploy contracts
soroban contract deploy --wasm <path> --network local

# Invoke functions
soroban contract invoke --id <contract_id> --network local -- <function> <args>
```

---

## 🏗️ Build Commands

### Development Build

```bash
cargo build --target wasm32-unknown-unknown
```

### Release Build

```bash
cargo build --target wasm32-unknown-unknown --release
```

### Optimized Build

```bash
soroban contract optimize --wasm target/wasm32-unknown-unknown/release/<contract>.wasm
```

### Check WASM Size

```bash
ls -lh target/wasm32-unknown-unknown/release/*.wasm
```

**Target:** <40KB per contract

---

## 🔍 Common Error Codes

### job_registry Errors

| Code | Error | Description |
|------|-------|-------------|
| 1 | AlreadyInitialized | Contract already initialized |
| 2 | NotInitialized | Contract not initialized |
| 3 | InvalidJobId | Job ID is 0 or invalid |
| 4 | InvalidBudget | Budget <= 0 |
| 5 | InvalidHash | CID format invalid |
| 6 | JobAlreadyExists | Job ID already used |
| 7 | JobNotFound | Job doesn't exist |
| 8 | JobNotOpen | Job not in Open status |
| 9 | Unauthorized | Caller not authorized |
| 10 | BidAlreadySubmitted | Freelancer already bid |
| 11 | BidNotFound | Bid doesn't exist |
| 12 | InvalidStateTransition | Invalid status change |
| 13 | NoDeliverable | No deliverable submitted |
| 14 | Overflow | Arithmetic overflow |

### escrow Errors

| Code | Error | Description |
|------|-------|-------------|
| 1 | AlreadyInitialized | Contract already initialized |
| 2 | NotInitialized | Contract not initialized |
| 3 | Unauthorized | Caller not authorized |
| 4 | InvalidInput | Invalid input parameter |
| 5 | JobNotFound | Job doesn't exist |
| 6 | InvalidState | Job in wrong state |
| 7 | AmountMismatch | Amount != milestone sum |
| 8 | NoPendingMilestones | All milestones released |
| 9 | JobRegistrySyncFailed | Cross-contract call failed |
| 10 | UpgradeUnauthorized | Not admin |
| 11 | InvalidStateTransition | Invalid status change |
| 12 | ReentrancyDetected | Reentrancy attempt |
| 13 | ArithmeticOverflow | Overflow in calculation |

---

## 📝 State Transitions

### job_registry Job Status

```
Open → InProgress → DeliverableSubmitted → Completed
  ↓
Disputed
```

### escrow Job Status

```
Setup → Funded → WorkInProgress → Completed
         ↓           ↓
      Refunded    Disputed → Resolved
```

---

## 🎯 Best Practices

### CID Validation

```rust
// ✅ DO: Use valid CID formats
let cid = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";  // CIDv0
let cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";  // CIDv1

// ❌ DON'T: Use arbitrary strings
let cid = "my-file-hash";  // Will be rejected
```

### Milestone Management

```rust
// ✅ DO: Ensure milestones sum to deposit amount
add_milestone(1000);
add_milestone(2000);
add_milestone(3000);
deposit(6000);  // Matches sum

// ❌ DON'T: Mismatch amounts
add_milestone(1000);
deposit(2000);  // Will fail: AmountMismatch
```

### Authorization

```rust
// ✅ DO: Call with correct authority
release_milestone(job_id, client_address);  // Client releases

// ❌ DON'T: Call with wrong authority
release_milestone(job_id, freelancer_address);  // Will fail: Unauthorized
```

### Error Handling

```rust
// ✅ DO: Handle Result types
match escrow.deposit(job_id, amount) {
    Ok(()) => println!("Deposit successful"),
    Err(e) => println!("Deposit failed: {:?}", e),
}

// ❌ DON'T: Unwrap in production
escrow.deposit(job_id, amount).unwrap();  // May panic
```

---

## 🔧 Troubleshooting

### Issue: Tests Failing

```bash
# Clean and rebuild
cargo clean
cargo test --workspace
```

### Issue: WASM Too Large

```bash
# Check size
ls -lh target/wasm32-unknown-unknown/release/*.wasm

# Optimize
soroban contract optimize --wasm <path>

# Verify profile settings in Cargo.toml
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
```

### Issue: Gas Limit Exceeded

- Break operation into smaller steps
- Check for infinite loops
- Review optimization techniques
- Use `release_funds()` for specific milestones

### Issue: Reentrancy Error

- Ensure guard is cleared after operations
- Don't call protected functions from callbacks
- Check for nested contract calls

---

## 📚 Documentation Files

- **OPTIMIZATION_REPORT.md** - Detailed optimization analysis
- **SECURITY_ANALYSIS.md** - Security threat model & defenses
- **TESTING_GUIDE.md** - Comprehensive testing instructions
- **PULL_REQUEST_SUMMARY.md** - PR summary with benchmarks
- **QUICK_REFERENCE.md** - This file

---

## 🔗 Useful Links

- [Soroban Docs](https://soroban.stellar.org/docs)
- [IPFS CID Spec](https://github.com/multiformats/cid)
- [Rust Book](https://doc.rust-lang.org/book/)
- [Cargo Book](https://doc.rust-lang.org/cargo/)

---

## 💡 Tips

### Development

- Use `cargo watch` for auto-rebuild: `cargo watch -x test`
- Enable debug logs: `RUST_LOG=debug cargo test`
- Format code: `cargo fmt`
- Lint code: `cargo clippy`

### Testing

- Test one function: `cargo test test_name`
- Show test output: `cargo test -- --nocapture`
- Run ignored tests: `cargo test -- --ignored`
- Parallel tests: `cargo test -- --test-threads=4`

### Deployment

- Always test on testnet first
- Verify WASM size before deploy
- Monitor gas consumption
- Set up event monitoring
- Have rollback plan ready

---

## 🎓 Key Concepts

### Checks-Effects-Interactions (CEI)

```rust
// 1. CHECKS: Validate inputs
caller.require_auth();
if job.status != EscrowStatus::Funded { return Err(...); }

// 2. EFFECTS: Update state
job.released_amount += amount;
env.storage().persistent().set(&key, &job);

// 3. INTERACTIONS: External calls
token_client.transfer(...);
```

### Reentrancy Guard

```rust
// Prevents nested calls to protected functions
enter_reentrancy_guard(&env);  // Set lock
// ... protected code ...
exit_reentrancy_guard(&env);   // Clear lock
```

### Checked Arithmetic

```rust
// Explicit error on overflow
let result = a.checked_add(b).ok_or(Error::Overflow)?;
```

---

**Version:** 1.0.0  
**Last Updated:** 2026-05-27  
**Soroban SDK:** 21.0.0
