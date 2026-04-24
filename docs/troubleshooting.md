# Troubleshooting Guide for Stellar & Soroban Errors

This guide covers common errors you may encounter when interacting with the Lance platform's Stellar blockchain integration, along with their causes and solutions.

## Table of Contents

- [Transaction Errors](#transaction-errors)
- [Wallet Connection Issues](#wallet-connection-issues)
- [Smart Contract Errors](#smart-contract-errors)
- [Network & RPC Issues](#network--rpc-issues)
- [Development & Debugging](#development--debugging)

---

## Transaction Errors

### `tx_bad_seq` - Transaction Sequence Error

**Symptom:** Transaction fails with "Sequence Number Mismatch" or "tx_bad_seq"

**Cause:** Your wallet's sequence number is out of sync with the network. This happens when:
- Multiple transactions are submitted rapidly
- A previous transaction failed but consumed a sequence number
- The wallet state is stale

**Solution:**
1. **Automatic Retry:** The platform automatically detects sequence errors and retries with a fresh account state (up to 3 times)
2. **Manual Fix:** Refresh the page and try again
3. **Wait:** If you submitted multiple transactions quickly, wait 5-10 seconds between submissions

**Code Location:** 
- Frontend: `apps/web/lib/job-registry.ts` (lines 322-333)
- Backend: `backend/src/services/stellar.rs` (line 542-545)

---

### `tx_insufficient_balance` - Insufficient Funds

**Symptom:** Transaction fails with "Insufficient Funds" error

**Cause:** Your wallet doesn't have enough:
- **XLM** for transaction fees (minimum ~0.01 XLM per transaction)
- **USDC** for the escrow deposit amount

**Solution:**
1. Check your XLM balance - you need at least 1-2 XLM for gas fees
2. Verify your USDC balance matches the job budget + platform fee (2%)
3. Fund your wallet from the [Stellar Laboratory](https://laboratory.stellar.org/) (Testnet) or an exchange (Mainnet)

**Debug Command:**
```bash
# Check account balances on Testnet
curl https://horizon-testnet.stellar.org/accounts/YOUR_ADDRESS
```

---

### `tx_bad_auth` - Authentication Failed

**Symptom:** "Transaction signature is invalid" or "Authentication Failed"

**Cause:** 
- Wallet signature is invalid or corrupted
- Wrong network passphrase (Testnet vs Mainnet mismatch)
- Transaction XDR was modified after signing

**Solution:**
1. Disconnect and reconnect your wallet
2. Verify you're on the correct network (Testnet for development)
3. Clear browser cache and retry
4. Try a different wallet (Freighter, Albedo, or xBull)

---

### `tx_too_late` / `tx_too_early` - Time Bounds Error

**Symptom:** "Transaction Expired" or "Transaction Too Early"

**Cause:** Transaction time bounds have passed or haven't been reached yet

**Solution:**
1. Check your system clock - it must be synchronized
2. Retry the transaction (timeouts are set to 30 seconds by default)
3. If using a hardware wallet, sign more quickly

---

## Wallet Connection Issues

### Wallet Not Detected

**Symptom:** "Wallet extension not found" or connection fails

**Supported Wallets:**
- ✅ Freighter (recommended)
- ✅ Albedo
- ✅ xBull

**Solution:**
1. Install a supported wallet extension
2. Ensure the wallet is unlocked
3. Refresh the page after installing
4. Check browser extension permissions

**Code Location:** `apps/web/lib/stellar.ts` (line 36-43)

---

### User Rejected Connection

**Symptom:** "Wallet connection was rejected"

**Cause:** User denied the connection request in their wallet

**Solution:**
1. Click "Connect Wallet" again
2. Approve the connection in your wallet popup
3. If the popup doesn't appear, check if it's blocked by your browser

---

### Network Mismatch

**Symptom:** Wallet is on Mainnet but app expects Testnet (or vice versa)

**Solution:**
1. Open your wallet settings
2. Switch to the correct network:
   - **Development:** Stellar Testnet
   - **Production:** Stellar Mainnet (Public)
3. The app displays a network mismatch banner if detected

**Code Location:** `apps/web/components/ui/network-mismatch-banner.tsx`

---

## Smart Contract Errors

### `JobNotFound` (Error #5)

**Symptom:** Contract call fails with "job not found"

**Cause:** The job ID doesn't exist in the escrow contract

**Solution:**
1. Verify the job was created successfully on-chain
2. Check the job ID in your transaction history
3. Ensure you're querying the correct contract address

**Contract Location:** `contracts/escrow/src/lib.rs` (line 115)

---

### `InvalidState` (Error #6)

**Symptom:** "Job not in releaseable state" or "not in setup phase"

**Cause:** Attempting an operation that violates the escrow state machine

**Valid State Transitions:**
```
Setup → Funded → WorkInProgress → Completed
                  ↓                    ↓
              Disputed → Resolved    Refunded
```

**Solution:**
1. Check the current job status before attempting operations
2. Follow the correct workflow:
   - Create job (Setup)
   - Deposit funds (Funded)
   - Release milestones (WorkInProgress)
   - Complete or dispute

**Contract Location:** `contracts/escrow/src/lib.rs` (lines 38-53)

---

### `AmountMismatch` (Error #7)

**Symptom:** Deposit amount doesn't match milestone total

**Cause:** The amount you're trying to deposit doesn't equal the sum of all milestones

**Solution:**
1. Verify milestone amounts add up correctly
2. Deposit amount must equal: sum(all milestone amounts)
3. Include platform fee (2%) in your calculations

**Example:**
```
Milestone 1: 3000 USDC
Milestone 2: 3000 USDC
Milestone 3: 3000 USDC
Total to deposit: 9000 USDC (+ 180 USDC platform fee)
```

---

### `Unauthorized` (Error #3)

**Symptom:** "Only client can release" or "unauthorized: only client or freelancer can raise a dispute"

**Cause:** The caller doesn't have permission for this operation

**Permission Matrix:**
| Operation | Allowed Roles |
|-----------|--------------|
| Create Job | Client |
| Deposit Funds | Client |
| Release Milestone | Client |
| Open Dispute | Client or Freelancer |
| Resolve Dispute | Agent Judge |
| Refund | Client |

**Solution:**
1. Ensure you're connected with the correct wallet address
2. Verify your role in the job (client vs freelancer)
3. Check the job details to confirm your address matches

---

### `NoPendingMilestones` (Error #8)

**Symptom:** "No pending milestones" when trying to release funds

**Cause:** All milestones have already been released

**Solution:**
1. Check the milestone status in the job details
2. If all milestones are released, the job should be in "Completed" state
3. No further action needed

---

### `ReentrancyDetected` (Error #12)

**Symptom:** Contract call fails with reentrancy error

**Cause:** A contract function is being called recursively, which is blocked for security

**Solution:**
1. This is an internal security measure
2. Wait for the current transaction to complete
3. Retry the operation
4. Contact support if this persists

**Contract Location:** `contracts/escrow/src/lib.rs` (lines 183-192)

---

### Multisig Errors

#### `MultisigRequired` (Error #13)
**Symptom:** Operation requires multisig approval

**Solution:** Configure multisig signers and collect required signatures

#### `InsufficientSignatures` (Error #14)
**Symptom:** Not enough signatures collected

**Solution:**
1. Check how many signatures are required vs. collected
2. Have remaining signers approve the transaction
3. Use `check_multisig_ready()` to verify readiness

#### `AlreadySigned` (Error #15)
**Symptom:** Signer has already signed this job

**Solution:** Each signer can only sign once. Wait for other signers to complete.

**Contract Location:** `contracts/escrow/src/lib.rs` (lines 878-971)

---

## Network & RPC Issues

### RPC Timeout

**Symptom:** "Confirmation timed out after 60s"

**Cause:** Soroban RPC is slow or transaction is stuck in pending state

**Solution:**
1. Wait longer - some transactions take 30-60 seconds to confirm
2. Check the [Stellar Expert Explorer](https://stellar.expert/) with your transaction hash
3. Try a different RPC endpoint:
   - Testnet: `https://soroban-testnet.stellar.org`
   - Mainnet: `https://soroban-rpc.mainnet.stellar.gateway.fm`

**Code Location:** `apps/web/lib/contracts.ts` (lines 23-24, 98-110)

---

### Simulation Failed

**Symptom:** Transaction simulation fails before signing

**Cause:** 
- Invalid contract arguments
- Insufficient resources (CPU/memory)
- Contract state doesn't allow the operation

**Solution:**
1. Check the simulation error message for details
2. Verify all input parameters are correct
3. Enable dev logs to see raw XDR and simulation results:
   ```bash
   export NODE_ENV=development
   ```

**Code Location:** `apps/web/lib/job-registry.ts` (lines 230-240)

---

## Development & Debugging

### Enable Detailed Logging

For development and debugging, enable verbose logging:

```bash
# Frontend (Next.js)
export NODE_ENV=development

# Backend (Rust)
export RUST_LOG=debug
```

**What gets logged:**
- Raw XDR transactions
- Simulation results
- Sequence number retries
- Contract events

**Log Locations:**
- Frontend console: `apps/web/lib/job-registry.ts` (devLog function)
- Backend stdout: `backend/src/services/stellar.rs`

---

### Common Development Issues

#### Contract Not Deployed

**Symptom:** "NEXT_PUBLIC_ESCROW_CONTRACT_ID is not configured"

**Solution:**
1. Deploy the contract to Testnet
2. Set the environment variable:
   ```bash
   export NEXT_PUBLIC_ESCROW_CONTRACT_ID=YOUR_CONTRACT_ID
   ```

**Deployment Guide:** See `docs/contracts/` directory

---

#### Mock Mode Active

**Symptom:** Transactions return "FAKE_TX_HASH"

**Cause:** Mock mode is enabled when:
- `NEXT_PUBLIC_E2E=true`
- Contract ID is not configured
- USDC contract ID is missing (for deposits)

**Solution:**
1. Set all required environment variables
2. Ensure `NEXT_PUBLIC_E2E` is not set to "true" in production
3. Check `.env.local` file

**Code Location:** `apps/web/lib/contracts.ts` (lines 28-34)

---

### Testing Multisig Locally

```rust
// Example test for multisig configuration
#[test]
fn test_multisig_configuration() {
    let env = Env::default();
    env.mock_all_auths();
    
    // Setup
    let client = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    
    // Create job
    cc.create_job(&1u64, &client, &freelancer, &token_addr);
    
    // Configure 2-of-3 multisig
    let mut signers = Vec::new(&env);
    signers.push_back(client.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    
    cc.configure_multisig(&1u64, &signers, &2u32);
    
    // Sign with first signer
    cc.sign_multisig(&1u64, &client);
    
    // Check readiness (should be false - need 2 signatures)
    let ready = cc.check_multisig_ready(&1u64);
    assert_eq!(ready, Ok(false));
    
    // Sign with second signer
    cc.sign_multisig(&1u64, &signer1);
    
    // Now should be ready
    let ready = cc.check_multisig_ready(&1u64);
    assert_eq!(ready, Ok(true));
}
```

---

## Getting Help

If you encounter an error not covered in this guide:

1. **Check Transaction Status:**
   - Visit [Stellar Expert Explorer](https://stellar.expert/explorer/testnet/tx/YOUR_HASH)
   - Look for detailed error codes

2. **Collect Debug Information:**
   - Transaction hash
   - Wallet address (public key only)
   - Error message and stack trace
   - Network (Testnet/Mainnet)
   - Steps to reproduce

3. **Report Issues:**
   - GitHub: [github.com/DXmakers/lance/issues](https://github.com/DXmakers/lance/issues)
   - Include all debug information above

---

## Quick Reference

### Error Codes

| Code | Name | Severity | Auto-Retry |
|------|------|----------|------------|
| 1 | AlreadyInitialized | Low | No |
| 2 | NotInitialized | High | No |
| 3 | Unauthorized | Medium | No |
| 4 | InvalidInput | Medium | No |
| 5 | JobNotFound | Medium | No |
| 6 | InvalidState | Medium | No |
| 7 | AmountMismatch | Low | No |
| 8 | NoPendingMilestones | Low | No |
| 9 | JobRegistrySyncFailed | High | Yes |
| 10 | UpgradeUnauthorized | Critical | No |
| 11 | InvalidStateTransition | Medium | No |
| 12 | ReentrancyDetected | Critical | No |
| 13 | MultisigRequired | Medium | No |
| 14 | InsufficientSignatures | Medium | No |
| 15 | AlreadySigned | Low | No |

### Transaction Lifecycle

```
Build → Simulate → Sign → Submit → Confirm
  ↓         ↓         ↓        ↓        ↓
 XDR     Estimate   Wallet   RPC     On-chain
 Build    Fees      Popup   Send    Finality
```

### Support Contacts

- **Documentation:** `/docs` directory in repository
- **API Reference:** Backend OpenAPI spec at `/api/docs`
- **Contract ABI:** Generated types in `contracts/*/src/lib.rs`

---

*Last updated: April 2026*
*Version: 1.0.0*
