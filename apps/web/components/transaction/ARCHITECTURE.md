# Transaction Status Modal - Architecture

## Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     User Interface Layer                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         TransactionStatusModal Component              │  │
│  │                                                         │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Progress Tracker (5 Steps)                     │  │  │
│  │  │  • Build → Simulate → Sign → Submit → Confirm   │  │  │
│  │  │  • Pulsing animations on active step            │  │  │
│  │  │  • Progress bar with color coding               │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │                                                         │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Status Messages                                 │  │  │
│  │  │  • Success: Green banner with tx hash           │  │  │
│  │  │  • Error: Red alert with retry buttons          │  │  │
│  │  │  • Active: Amber loading with step description  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │                                                         │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Simulation Diagnostics                          │  │  │
│  │  │  • Estimated fee (XLM)                           │  │  │
│  │  │  • CPU instructions                              │  │  │
│  │  │  • Memory bytes                                  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │                                                         │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Advanced Details (Collapsible)                  │  │  │
│  │  │  • Raw XDR (Base64)                              │  │  │
│  │  │  • Copy to clipboard                             │  │  │
│  │  │  • Security warnings                             │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │                                                         │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ reads from
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      State Management Layer                  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         useTxStatusStore (Zustand)                    │  │
│  │                                                         │  │
│  │  State:                                                 │  │
│  │  • step: TxLifecycleStep                               │  │
│  │  • detail: string | null                               │  │
│  │  • txHash: string | null                               │  │
│  │  • rawXdr: string | null                               │  │
│  │  • simulation: SimulationResult | null                 │  │
│  │  • startedAt: number | null                            │  │
│  │  • finishedAt: number | null                           │  │
│  │                                                         │  │
│  │  Actions:                                               │  │
│  │  • setStep(step, detail?)                              │  │
│  │  • setTxHash(hash)                                     │  │
│  │  • setRawXdr(xdr)                                      │  │
│  │  • setSimulation(simulation)                           │  │
│  │  • reset()                                             │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ updated by
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Transaction Logic Layer                   │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         job-registry.ts                               │  │
│  │                                                         │  │
│  │  Functions:                                             │  │
│  │  • postJob(params, onStep)                             │  │
│  │  • submitBid(params, onStep)                           │  │
│  │  • invokeJobRegistry(...)                              │  │
│  │                                                         │  │
│  │  Lifecycle Callback:                                    │  │
│  │  onStep(step, detail, metadata) {                      │  │
│  │    setStep(step, detail);                              │  │
│  │    if (metadata?.rawXdr) setRawXdr(metadata.rawXdr);   │  │
│  │  }                                                      │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ calls
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Blockchain Layer                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         Stellar SDK / Soroban RPC                     │  │
│  │                                                         │  │
│  │  • TransactionBuilder (build)                          │  │
│  │  • SorobanServer.simulateTransaction (simulate)        │  │
│  │  • Wallet.signTransaction (sign)                       │  │
│  │  • SorobanServer.sendTransaction (submit)              │  │
│  │  • SorobanServer.getTransaction (confirm/poll)         │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Transaction Initiation

```
User Action
    │
    ▼
Component calls resetAndOpen()
    │
    ▼
Store.reset() clears previous state
    │
    ▼
Modal opens (isOpen = true)
    │
    ▼
Component calls postJob(params, onStep)
```

### 2. Transaction Lifecycle

```
Step 1: BUILDING
    │
    ├─> Store.setStep("building")
    ├─> Modal shows "Building transaction..."
    ├─> TransactionBuilder creates TX
    └─> Store.setRawXdr(tx.toXDR())
    │
    ▼
Step 2: SIMULATING
    │
    ├─> Store.setStep("simulating")
    ├─> Modal shows "Simulating on Soroban..."
    ├─> RPC.simulateTransaction(tx)
    └─> Store.setSimulation({ fee, cpu, memory })
    │
    ▼
Step 3: SIGNING
    │
    ├─> Store.setStep("signing")
    ├─> Modal shows "Waiting for wallet signature..."
    ├─> Wallet prompts user
    └─> User approves/rejects
    │
    ▼
Step 4: SUBMITTING
    │
    ├─> Store.setStep("submitting")
    ├─> Modal shows "Broadcasting to network..."
    ├─> RPC.sendTransaction(signedTx)
    └─> Store.setTxHash(result.hash)
    │
    ▼
Step 5: CONFIRMING
    │
    ├─> Store.setStep("confirming")
    ├─> Modal shows "Waiting for ledger confirmation..."
    ├─> Poll RPC.getTransaction(hash) with exponential backoff
    │   • Interval: 2s → 3s → 4.5s → 6.75s → 10s (max)
    │   • Max retries: 30 (up to 5 minutes)
    └─> Transaction confirmed or failed
    │
    ▼
Step 6: TERMINAL STATE
    │
    ├─> SUCCESS: Store.setStep("confirmed", txHash)
    │   ├─> Modal shows green success banner
    │   ├─> Display transaction hash with copy button
    │   ├─> Link to block explorer
    │   ├─> Show "Indexing..." for 3 seconds (ghost state)
    │   └─> Enable close button
    │
    └─> FAILURE: Store.setStep("failed", errorMessage)
        ├─> Modal shows red error banner
        ├─> Display error details in code block
        ├─> Show retry buttons (if failed during build/simulate)
        └─> Enable close button
```

## Hook Architecture

### useTransactionModal

```
useTransactionModal(options)
    │
    ├─> Manages modal open/close state
    ├─> Monitors transaction step changes
    ├─> Implements auto-open logic
    ├─> Implements auto-close logic
    ├─> Triggers success/error callbacks
    │
    └─> Returns:
        • isModalOpen: boolean
        • openModal: () => void
        • closeModal: () => void
        • resetAndOpen: () => void
        • isTransactionActive: boolean
        • currentStep: TxLifecycleStep
        • txHash: string | null
        • error: string | null
```

### useTransactionStep

```
useTransactionStep()
    │
    ├─> Reads current step from store
    │
    └─> Returns:
        • step: TxLifecycleStep
        • detail: string | null
        • isIdle: boolean
        • isBuilding: boolean
        • isSimulating: boolean
        • isSigning: boolean
        • isSubmitting: boolean
        • isConfirming: boolean
        • isConfirmed: boolean
        • isFailed: boolean
        • isActive: boolean
```

### useTransactionProgress

```
useTransactionProgress()
    │
    ├─> Maps step to progress percentage
    │   • idle: 0%
    │   • building: 20%
    │   • simulating: 40%
    │   • signing: 60%
    │   • submitting: 80%
    │   • confirming: 90%
    │   • confirmed: 100%
    │
    └─> Returns:
        • progress: number (0-100)
        • isComplete: boolean
        • isFailed: boolean
```

## Polling Strategy

### Exponential Backoff Algorithm

```typescript
Initial interval: 2000ms
Max interval: 10000ms
Multiplier: 1.5

Poll 1: Wait 2000ms  → Check status
Poll 2: Wait 3000ms  → Check status (2000 * 1.5)
Poll 3: Wait 4500ms  → Check status (3000 * 1.5)
Poll 4: Wait 6750ms  → Check status (4500 * 1.5)
Poll 5: Wait 10000ms → Check status (capped at max)
Poll 6: Wait 10000ms → Check status
...
Poll 30: Wait 10000ms → Timeout

Total time: ~5 minutes
Total polls: 30
Average interval: ~10s
```

### Benefits

- **Reduced RPC Load**: Fewer requests as transaction progresses
- **Responsive Start**: Quick feedback in first few seconds
- **Efficient Waiting**: Longer intervals for ledger confirmation
- **Timeout Protection**: Prevents infinite polling

## Error Handling

### Error Flow

```
Error Occurs
    │
    ├─> Catch in try/catch block
    │
    ├─> Determine error type:
    │   ├─> Build error (invalid parameters)
    │   ├─> Simulate error (insufficient balance, auth failure)
    │   ├─> Sign error (user rejection, timeout)
    │   ├─> Submit error (network issue, sequence mismatch)
    │   └─> Confirm error (timeout, on-chain failure)
    │
    ├─> Store.setStep("failed", errorMessage)
    │
    └─> Modal displays:
        ├─> Red error banner
        ├─> Error message in code block
        ├─> Retry buttons (if applicable)
        └─> Close button enabled
```

### Retry Logic

```
Sequence Mismatch Detected
    │
    ├─> Retry up to 2 times
    │   ├─> Fetch fresh account data
    │   ├─> Rebuild transaction with new sequence
    │   └─> Retry submission
    │
    └─> If still failing:
        └─> Store.setStep("failed", "Sequence mismatch after retries")
```

## Security Architecture

### Data Exposure Rules

```
✅ SAFE TO DISPLAY:
    • Transaction hash (public identifier)
    • Public addresses
    • XDR (transaction structure)
    • Simulation results (fee, resources)
    • Error messages (sanitized)

❌ NEVER DISPLAY:
    • Private keys
    • Seed phrases
    • Wallet credentials
    • Unsanitized user input
```

### XDR Display Security

```
Advanced Details Section
    │
    ├─> Collapsible (hidden by default)
    ├─> Security warning displayed
    ├─> Read-only display
    ├─> Copy button (user-initiated)
    └─> No automatic logging
```

## Performance Considerations

### Rendering Optimization

```
Modal Rendering
    │
    ├─> Only renders when: isOpen && step !== "idle"
    ├─> Conditional rendering of sections
    ├─> CSS transforms for animations (GPU-accelerated)
    ├─> Debounced state updates
    └─> Cleanup on unmount
```

### Memory Management

```
Component Lifecycle
    │
    ├─> Mount: Subscribe to store
    ├─> Update: React to step changes
    ├─> Unmount: Clear timers, unsubscribe
    │
    └─> Store Lifecycle:
        ├─> reset() clears all state
        ├─> No memory leaks from timers
        └─> Efficient Zustand subscriptions
```

## Testing Architecture

### Test Coverage

```
Unit Tests
    ├─> Component rendering
    ├─> State transitions
    ├─> User interactions
    ├─> Copy functionality
    └─> Close behavior

Integration Tests
    ├─> Full transaction flow
    ├─> Error scenarios
    ├─> Polling behavior
    └─> Store integration

E2E Tests (Future)
    ├─> Real wallet connection
    ├─> Real RPC calls
    └─> Real transaction submission
```

## Deployment Checklist

- [ ] Environment variables configured
  - `NEXT_PUBLIC_SOROBAN_RPC_URL`
  - `NEXT_PUBLIC_STELLAR_NETWORK`
  - `NEXT_PUBLIC_JOB_REGISTRY_CONTRACT_ID`

- [ ] Dependencies installed
  - React 19
  - Zustand
  - Lucide React
  - Stellar SDK

- [ ] Tests passing
  - `npm test -- transaction-status-modal.test.tsx`

- [ ] HTTPS enabled (for clipboard API)

- [ ] Error tracking configured
  - Sentry, LogRocket, etc.

- [ ] Analytics events added
  - Transaction started
  - Transaction confirmed
  - Transaction failed

- [ ] Accessibility tested
  - Screen reader compatibility
  - Keyboard navigation
  - Color contrast

- [ ] Performance profiled
  - React DevTools
  - Lighthouse audit
  - Bundle size check
