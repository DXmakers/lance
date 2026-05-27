# Testing Guide: Lance Marketplace Contracts

## Overview

This guide provides comprehensive instructions for testing the Lance marketplace smart contracts, including unit tests, integration tests, and manual testing procedures.

---

## Prerequisites

### Required Tools

```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Soroban CLI
cargo install --locked soroban-cli --version 21.0.0

# Optional: Stellar CLI for testnet interaction
cargo install --locked stellar-cli
```

### Environment Setup

```bash
# Clone repository
git clone <repository-url>
cd lance

# Verify Rust installation
rustc --version  # Should be 1.75+
cargo --version

# Verify Soroban CLI
soroban --version  # Should be 21.0.0
```

---

## Unit Tests

### Running All Tests

```bash
# Run all tests in workspace
cargo test --workspace

# Run with output
cargo test --workspace -- --nocapture

# Run with specific test filter
cargo test --workspace overflow
```

### Running Contract-Specific Tests

#### job_registry Tests

```bash
# All job_registry tests
cargo test --manifest-path contracts/job_registry/Cargo.toml

# CID validation tests only
cargo test --manifest-path contracts/job_registry/Cargo.toml cid

# Overflow tests only
cargo test --manifest-path contracts/job_registry/Cargo.toml overflow
```

**Expected Output:**
```
running 28 tests
test test_initialize_bootstraps_storage ... ok
test test_valid_cidv0_accepted ... ok
test test_valid_cidv1_base32_accepted ... ok
test test_oversized_cid_rejected ... ok
...
test result: ok. 28 passed; 0 failed; 0 ignored; 0 measured
```

#### escrow Tests

```bash
# All escrow tests
cargo test --manifest-path contracts/escrow/Cargo.toml

# Reentrancy tests only
cargo test --manifest-path contracts/escrow/Cargo.toml reentrancy

# Overflow tests only
cargo test --manifest-path contracts/escrow/Cargo.toml overflow

# Gas optimization tests
cargo test --manifest-path contracts/escrow/Cargo.toml optimization
```

**Expected Output:**
```
running 45 tests
test test_happy_path_lifecycle ... ok
test test_reentrancy_guard_prevents_double_deposit ... ok
test test_release_milestone_checked_add ... ok
...
test result: ok. 45 passed; 0 failed; 0 ignored; 0 measured
```

### Test Categories

#### 1. CID Validation Tests (job_registry)

```bash
cargo test --manifest-path contracts/job_registry/Cargo.toml -- \
  test_valid_cidv0_accepted \
  test_valid_cidv1_base32_accepted \
  test_valid_cidv1_base58_accepted \
  test_oversized_cid_rejected \
  test_undersized_cid_rejected \
  test_malformed_cidv0_wrong_prefix_rejected \
  test_malformed_cidv0_wrong_length_rejected \
  test_invalid_multibase_prefix_rejected
```

**What's Tested:**
- ✅ Valid CIDv0 format (46 bytes, "Qm" prefix)
- ✅ Valid CIDv1 formats (base32, base58btc, etc.)
- ✅ Rejection of oversized CIDs (>96 bytes)
- ✅ Rejection of undersized CIDs (<34 bytes)
- ✅ Rejection of malformed prefixes
- ✅ Validation in all entry points (post_job, submit_bid, submit_deliverable)

#### 2. Reentrancy Protection Tests (escrow)

```bash
cargo test --manifest-path contracts/escrow/Cargo.toml -- \
  test_reentrancy_guard_prevents_double_deposit \
  test_reentrancy_guard_cleared_after_release \
  test_reentrancy_guard_cleared_after_refund \
  test_reentrancy_guard_cleared_after_resolve_dispute
```

**What's Tested:**
- ✅ Guard prevents nested calls
- ✅ Guard properly cleared after successful operations
- ✅ Guard works across all protected functions
- ✅ No deadlocks from uncleaned guards

#### 3. Overflow Protection Tests (both contracts)

```bash
# job_registry overflow tests
cargo test --manifest-path contracts/job_registry/Cargo.toml -- \
  test_job_id_overflow_protection \
  test_explicit_job_id_near_max

# escrow overflow tests
cargo test --manifest-path contracts/escrow/Cargo.toml -- \
  test_large_milestone_amounts_no_overflow \
  test_release_milestone_checked_add \
  test_refund_checked_sub \
  test_multiple_milestones_sum_validation
```

**What's Tested:**
- ✅ Checked addition in milestone sums
- ✅ Checked addition in release operations
- ✅ Checked subtraction in refund calculations
- ✅ Proper error handling on overflow
- ✅ Large but valid amounts handled correctly

#### 4. Gas Optimization Verification Tests (escrow)

```bash
cargo test --manifest-path contracts/escrow/Cargo.toml -- \
  test_single_ttl_bump_optimization \
  test_inline_validation_performance \
  test_checks_effects_interactions_pattern
```

**What's Tested:**
- ✅ Single TTL bump per operation
- ✅ Inline validation efficiency
- ✅ CEI pattern enforcement
- ✅ State consistency after operations

---

## Integration Tests

### Local Testnet Setup

```bash
# Start local Soroban network (in separate terminal)
soroban network start local

# Configure network
soroban network add local \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017"
```

### Build Contracts

```bash
# Build job_registry
cd contracts/job_registry
cargo build --target wasm32-unknown-unknown --release
cd ../..

# Build escrow
cd contracts/escrow
cargo build --target wasm32-unknown-unknown --release
cd ../..

# Optimize WASM (optional)
soroban contract optimize \
  --wasm target/wasm32-unknown-unknown/release/job_registry.wasm

soroban contract optimize \
  --wasm target/wasm32-unknown-unknown/release/escrow.wasm
```

### Deploy Contracts

```bash
# Generate test identity
soroban keys generate admin --network local
soroban keys generate client --network local
soroban keys generate freelancer --network local

# Deploy job_registry
JOB_REGISTRY_ID=$(soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/job_registry.wasm \
  --source admin \
  --network local)

echo "Job Registry: $JOB_REGISTRY_ID"

# Deploy escrow
ESCROW_ID=$(soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/escrow.wasm \
  --source admin \
  --network local)

echo "Escrow: $ESCROW_ID"
```

### Initialize Contracts

```bash
# Initialize job_registry
soroban contract invoke \
  --id $JOB_REGISTRY_ID \
  --source admin \
  --network local \
  -- initialize \
  --admin $(soroban keys address admin)

# Initialize escrow
soroban contract invoke \
  --id $ESCROW_ID \
  --source admin \
  --network local \
  -- initialize \
  --admin $(soroban keys address admin) \
  --agent_judge $(soroban keys address admin)
```

### Integration Test Scenarios

#### Scenario 1: Complete Job Lifecycle

```bash
# 1. Post job
soroban contract invoke \
  --id $JOB_REGISTRY_ID \
  --source client \
  --network local \
  -- post_job_auto \
  --client $(soroban keys address client) \
  --hash "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG" \
  --budget 10000

# 2. Submit bid
soroban contract invoke \
  --id $JOB_REGISTRY_ID \
  --source freelancer \
  --network local \
  -- submit_bid \
  --job_id 1 \
  --freelancer $(soroban keys address freelancer) \
  --proposal_hash "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"

# 3. Accept bid
soroban contract invoke \
  --id $JOB_REGISTRY_ID \
  --source client \
  --network local \
  -- accept_bid \
  --job_id 1 \
  --client $(soroban keys address client) \
  --freelancer $(soroban keys address freelancer)

# 4. Submit deliverable
soroban contract invoke \
  --id $JOB_REGISTRY_ID \
  --source freelancer \
  --network local \
  -- submit_deliverable \
  --job_id 1 \
  --freelancer $(soroban keys address freelancer) \
  --hash "zdj7WWeQ43G6JJvLWQWZpyHuAMq6uYWRjkBXFad11vE2LHhQ7"

# 5. Verify job status
soroban contract invoke \
  --id $JOB_REGISTRY_ID \
  --network local \
  -- get_job \
  --job_id 1
```

#### Scenario 2: Escrow with Milestones

```bash
# Assume TOKEN_ID is a deployed token contract

# 1. Create escrow job
soroban contract invoke \
  --id $ESCROW_ID \
  --source client \
  --network local \
  -- create_job \
  --job_id 1 \
  --client $(soroban keys address client) \
  --freelancer $(soroban keys address freelancer) \
  --token_addr $TOKEN_ID

# 2. Add milestones
soroban contract invoke \
  --id $ESCROW_ID \
  --source client \
  --network local \
  -- add_milestone \
  --job_id 1 \
  --amount 3000

soroban contract invoke \
  --id $ESCROW_ID \
  --source client \
  --network local \
  -- add_milestone \
  --job_id 1 \
  --amount 3000

soroban contract invoke \
  --id $ESCROW_ID \
  --source client \
  --network local \
  -- add_milestone \
  --job_id 1 \
  --amount 4000

# 3. Deposit funds
soroban contract invoke \
  --id $ESCROW_ID \
  --source client \
  --network local \
  -- deposit \
  --job_id 1 \
  --amount 10000

# 4. Release milestones
soroban contract invoke \
  --id $ESCROW_ID \
  --source client \
  --network local \
  -- release_milestone \
  --job_id 1 \
  --caller $(soroban keys address client)

# 5. Verify job state
soroban contract invoke \
  --id $ESCROW_ID \
  --network local \
  -- get_job \
  --job_id 1
```

#### Scenario 3: Dispute Resolution

```bash
# 1. Setup job with deposit (steps 1-3 from Scenario 2)

# 2. Raise dispute
soroban contract invoke \
  --id $ESCROW_ID \
  --source client \
  --network local \
  -- raise_dispute \
  --job_id 1 \
  --caller $(soroban keys address client)

# 3. Resolve dispute (as agent judge)
soroban contract invoke \
  --id $ESCROW_ID \
  --source admin \
  --network local \
  -- resolve_dispute \
  --job_id 1 \
  --payee_amount 5000 \
  --payer_amount 5000

# 4. Verify resolution
soroban contract invoke \
  --id $ESCROW_ID \
  --network local \
  -- get_job \
  --job_id 1
```

---

## Manual Testing Checklist

### CID Validation Testing

#### Valid CIDs

- [ ] CIDv0: `QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG` (46 bytes)
- [ ] CIDv1 base32: `bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi`
- [ ] CIDv1 base58btc: `zdj7WWeQ43G6JJvLWQWZpyHuAMq6uYWRjkBXFad11vE2LHhQ7`
- [ ] CIDv1 base64: `mAXASILp4IGCEhQnfxrL0KvHL9TLAcYLFDcNgTb+RLcaRAYW`

#### Invalid CIDs (Should Reject)

- [ ] Too short: `QmShort` (< 34 bytes)
- [ ] Too long: 97+ byte string
- [ ] Wrong prefix: `XmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG`
- [ ] Invalid multibase: `xafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi`
- [ ] Empty string: ``

### Security Testing

#### Reentrancy Protection

- [ ] Attempt nested deposit calls (should fail)
- [ ] Attempt nested release calls (should fail)
- [ ] Verify guard cleared after successful operation
- [ ] Verify guard cleared after failed operation

#### Overflow Protection

- [ ] Add milestones summing to i128::MAX (should succeed)
- [ ] Add milestones summing beyond i128::MAX (should fail)
- [ ] Release milestone causing overflow (should fail)
- [ ] Refund with underflow scenario (should fail)

#### Authorization

- [ ] Non-client attempts to release milestone (should fail)
- [ ] Non-admin attempts to upgrade contract (should fail)
- [ ] Non-agent-judge attempts to resolve dispute (should fail)
- [ ] Third party attempts to refund (should fail)

### Gas Optimization Verification

#### Measure Gas Consumption

```bash
# Enable gas metering
export SOROBAN_RPC_URL="http://localhost:8000/soroban/rpc"

# Measure deposit gas
soroban contract invoke \
  --id $ESCROW_ID \
  --source client \
  --network local \
  -- deposit \
  --job_id 1 \
  --amount 10000 \
  | grep "gas"

# Measure release_milestone gas
soroban contract invoke \
  --id $ESCROW_ID \
  --source client \
  --network local \
  -- release_milestone \
  --job_id 1 \
  --caller $(soroban keys address client) \
  | grep "gas"
```

#### Compare Before/After

- [ ] Record baseline gas consumption
- [ ] Apply optimizations
- [ ] Measure new gas consumption
- [ ] Verify >=15% reduction

---

## Performance Testing

### Load Testing

```bash
# Create multiple jobs
for i in {1..100}; do
  soroban contract invoke \
    --id $JOB_REGISTRY_ID \
    --source client \
    --network local \
    -- post_job_auto \
    --client $(soroban keys address client) \
    --hash "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG" \
    --budget 10000
done

# Measure response time
time soroban contract invoke \
  --id $JOB_REGISTRY_ID \
  --network local \
  -- get_job \
  --job_id 50
```

### Stress Testing

```bash
# Create job with many milestones
for i in {1..50}; do
  soroban contract invoke \
    --id $ESCROW_ID \
    --source client \
    --network local \
    -- add_milestone \
    --job_id 1 \
    --amount 100
done

# Measure deposit performance
time soroban contract invoke \
  --id $ESCROW_ID \
  --source client \
  --network local \
  -- deposit \
  --job_id 1 \
  --amount 5000
```

---

## Continuous Integration

### GitHub Actions Workflow

```yaml
name: Test Contracts

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Rust
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
          target: wasm32-unknown-unknown
      
      - name: Run tests
        run: cargo test --workspace
      
      - name: Build contracts
        run: |
          cd contracts/job_registry
          cargo build --target wasm32-unknown-unknown --release
          cd ../escrow
          cargo build --target wasm32-unknown-unknown --release
      
      - name: Check WASM size
        run: |
          ls -lh target/wasm32-unknown-unknown/release/*.wasm
          # Fail if any contract > 40KB
          find target/wasm32-unknown-unknown/release -name "*.wasm" -size +40k -exec false {} +
```

---

## Troubleshooting

### Common Issues

#### 1. Tests Failing with "job not found"

**Cause:** Test isolation issue, jobs from previous tests persisting.

**Solution:**
```bash
# Clean and rebuild
cargo clean
cargo test --workspace
```

#### 2. WASM Build Fails

**Cause:** Missing wasm32-unknown-unknown target.

**Solution:**
```bash
rustup target add wasm32-unknown-unknown
```

#### 3. Soroban CLI Not Found

**Cause:** Soroban CLI not installed or not in PATH.

**Solution:**
```bash
cargo install --locked soroban-cli
# Add to PATH if needed
export PATH="$HOME/.cargo/bin:$PATH"
```

#### 4. Gas Limit Exceeded

**Cause:** Operation too complex or inefficient.

**Solution:**
- Review gas optimization techniques
- Break operation into smaller steps
- Check for infinite loops or excessive iterations

---

## Test Maintenance

### Adding New Tests

```rust
#[test]
fn test_new_feature() {
    let env = Env::default();
    env.mock_all_auths();
    
    // Setup
    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, MyContract);
    let cc = MyContractClient::new(&env, &contract_id);
    
    // Execute
    cc.new_feature(&param);
    
    // Assert
    assert_eq!(expected, actual);
}
```

### Test Naming Convention

- `test_<feature>_<scenario>` - Positive tests
- `test_<feature>_<error_condition>_<expected_behavior>` - Negative tests
- `test_<security_property>_<attack_scenario>` - Security tests

### Test Organization

```
contracts/
├── job_registry/
│   └── src/
│       └── lib.rs
│           ├── Core functionality tests
│           ├── CID validation tests
│           └── Overflow protection tests
└── escrow/
    └── src/
        └── lib.rs
            ├── Core functionality tests
            ├── Reentrancy protection tests
            ├── Overflow protection tests
            └── Gas optimization tests
```

---

## Reporting Issues

### Bug Report Template

```markdown
**Description:**
Brief description of the issue

**Steps to Reproduce:**
1. Step 1
2. Step 2
3. Step 3

**Expected Behavior:**
What should happen

**Actual Behavior:**
What actually happens

**Environment:**
- Rust version: 
- Soroban SDK version:
- OS:

**Test Output:**
```
Paste test output here
```

**Additional Context:**
Any other relevant information
```

---

## Resources

- [Soroban Testing Guide](https://soroban.stellar.org/docs/getting-started/testing)
- [Rust Testing Documentation](https://doc.rust-lang.org/book/ch11-00-testing.html)
- [Cargo Test Documentation](https://doc.rust-lang.org/cargo/commands/cargo-test.html)

---

**Last Updated:** 2026-05-27  
**Version:** 1.0.0
