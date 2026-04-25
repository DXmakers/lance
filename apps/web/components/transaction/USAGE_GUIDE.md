# Transaction Status Modal - Usage Guide

Complete guide for implementing and customizing the Transaction Status Modal in your Stellar/Soroban application.

## Quick Start

### 1. Basic Implementation

```tsx
import { useState } from "react";
import { TransactionStatusModal } from "@/components/transaction/transaction-status-modal";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";
import { postJob } from "@/lib/job-registry";

function MyComponent() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { setStep, setTxHash, setRawXdr, setSimulation, reset } = useTxStatusStore();

  const handleTransaction = async () => {
    reset(); // Clear previous state
    setIsModalOpen(true);

    try {
      const result = await postJob(params, (step, detail, metadata) => {
        setStep(step, detail);
        if (metadata?.rawXdr) setRawXdr(metadata.rawXdr);
      });

      setTxHash(result.txHash);
      setSimulation(result.simulation);
    } catch (error) {
      setStep("failed", error.message);
    }
  };

  return (
    <>
      <button onClick={handleTransaction}>Submit Transaction</button>
      <TransactionStatusModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
    </>
  );
}
```

### 2. Import CSS Utilities (Optional)

Add to your global CSS or component:

```tsx
import "@/app/transaction-ui.css";
```

Or use Tailwind classes directly (the component uses Tailwind by default).

## State Management

### Store Structure

The `useTxStatusStore` manages transaction state:

```typescript
interface TxStatusState {
  step: TxLifecycleStep;           // Current lifecycle step
  detail: string | null;            // Status message or error
  txHash: string | null;            // Transaction hash (after submit)
  rawXdr: string | null;            // Base64 XDR
  simulation: SimulationResult | null; // Simulation diagnostics
  startedAt: number | null;         // Start timestamp
  finishedAt: number | null;        // End timestamp
}
```

### Store Actions

```typescript
// Update current step
setStep(step: TxLifecycleStep, detail?: string)

// Store transaction hash
setTxHash(hash: string)

// Store raw XDR
setRawXdr(xdr: string)

// Store simulation results
setSimulation(simulation: SimulationResult)

// Reset to initial state
reset()
```

## Lifecycle Steps

### Step Flow

```
idle → building → simulating → signing → submitting → confirming → confirmed/failed
```

### Step Details

| Step | Description | User Action | Common Errors |
|------|-------------|-------------|---------------|
| `idle` | No transaction | - | - |
| `building` | Constructing TX | None | Invalid parameters |
| `simulating` | Testing on network | None | Insufficient balance, auth errors |
| `signing` | Wallet signature | Sign in wallet | User rejection, timeout |
| `submitting` | Broadcasting TX | None | Network issues, seq mismatch |
| `confirming` | Waiting for ledger | None | Timeout, on-chain failure |
| `confirmed` | Success | None | - |
| `failed` | Error occurred | Retry/edit | Various |

## Advanced Usage

### Custom Transaction Flow

```tsx
const handleCustomTransaction = async () => {
  reset();
  setIsModalOpen(true);

  try {
    // Step 1: Build
    setStep("building");
    const tx = await buildTransaction();
    setRawXdr(tx.toXDR());

    // Step 2: Simulate
    setStep("simulating");
    const simResult = await simulateTransaction(tx);
    setSimulation({
      fee: simResult.minResourceFee,
      cpuInstructions: simResult.cpuInstructions,
      memoryBytes: simResult.memoryBytes,
    });

    // Step 3: Sign
    setStep("signing");
    const signedTx = await signTransaction(tx);

    // Step 4: Submit
    setStep("submitting");
    const result = await submitTransaction(signedTx);
    setTxHash(result.hash);

    // Step 5: Confirm
    setStep("confirming");
    await pollForConfirmation(result.hash);
    setStep("confirmed", result.hash);
  } catch (error) {
    setStep("failed", error.message);
  }
};
```

### Error Handling Patterns

#### 1. Simulation Errors (Most Common)

```tsx
try {
  setStep("simulating");
  const simResult = await rpc.simulateTransaction(tx);
  
  if (Api.isSimulationError(simResult)) {
    const errorMsg = simResult.error;
    
    // Parse common errors
    if (errorMsg.includes("insufficient balance")) {
      throw new Error("Insufficient balance for transaction fee");
    } else if (errorMsg.includes("auth")) {
      throw new Error("Authorization failed - check wallet permissions");
    } else {
      throw new Error(`Simulation failed: ${errorMsg}`);
    }
  }
  
  setSimulation(extractSimulationData(simResult));
} catch (error) {
  setStep("failed", error.message);
  // Modal will show "Edit Parameters" and "Retry" buttons
}
```

#### 2. User Rejection

```tsx
try {
  setStep("signing");
  const signedXdr = await signTransaction(xdr);
} catch (error) {
  if (error.message.includes("User rejected")) {
    setStep("failed", "Transaction signature was rejected");
  } else {
    setStep("failed", `Signing failed: ${error.message}`);
  }
}
```

#### 3. Network Errors

```tsx
try {
  setStep("submitting");
  const result = await rpc.sendTransaction(signedTx);
  
  if (result.status === "ERROR") {
    throw new Error(`Submission failed: ${result.errorResult}`);
  }
} catch (error) {
  if (error.message.includes("network")) {
    setStep("failed", "Network error - please check your connection");
  } else {
    setStep("failed", error.message);
  }
}
```

### Polling with Exponential Backoff

The modal implements automatic polling, but you can customize it:

```tsx
async function pollForConfirmation(txHash: string) {
  const maxRetries = 30;
  let interval = 2000; // Start at 2s
  const maxInterval = 10000; // Cap at 10s
  const backoffMultiplier = 1.5;

  for (let i = 0; i < maxRetries; i++) {
    await new Promise(resolve => setTimeout(resolve, interval));
    
    const result = await rpc.getTransaction(txHash);
    
    if (result.status === "SUCCESS") {
      return result;
    } else if (result.status === "FAILED") {
      throw new Error("Transaction failed on-chain");
    }
    
    // Exponential backoff
    interval = Math.min(interval * backoffMultiplier, maxInterval);
  }
  
  throw new Error("Confirmation timeout");
}
```

## Customization

### Styling

#### Using Tailwind (Default)

The component uses Tailwind classes. Customize by modifying the component or extending your Tailwind config:

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        'tx-success': '#10b981',
        'tx-pending': '#f59e0b',
        'tx-error': '#ef4444',
      },
      animation: {
        'tx-pulse': 'tx-pulse 2s ease-in-out infinite',
      },
    },
  },
};
```

#### Using CSS Utilities

Import the provided CSS file for pre-built classes:

```tsx
import "@/app/transaction-ui.css";

// Use classes
<div className="tx-hash">{txHash}</div>
<div className="tx-xdr">{rawXdr}</div>
<div className="tx-metric">{fee}</div>
```

### Custom Step Labels

Modify the `STEPS` array in `transaction-status-modal.tsx`:

```tsx
const STEPS: StepDef[] = [
  { key: "building", label: "Prepare", icon: FileCode, description: "..." },
  { key: "simulating", label: "Test", icon: Cpu, description: "..." },
  // ... customize labels
];
```

### Custom Icons

Replace Lucide icons with your own:

```tsx
import { MyCustomIcon } from "@/components/icons";

const STEPS: StepDef[] = [
  { key: "building", label: "Build", icon: MyCustomIcon, description: "..." },
  // ...
];
```

### Custom Explorer URL

Change the block explorer link:

```tsx
const STELLAR_EXPLORER_URL = 
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "PUBLIC"
    ? "https://stellarchain.io/tx"  // Your custom explorer
    : "https://testnet.stellarchain.io/tx";
```

## Integration Patterns

### Pattern 1: Form Submission

```tsx
function JobPostForm() {
  const [formData, setFormData] = useState({...});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { setStep, reset } = useTxStatusStore();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    reset();
    setIsModalOpen(true);

    try {
      await postJob({
        jobId: 0n,
        clientAddress: formData.address,
        metadataHash: formData.ipfsHash,
        budgetStroops: BigInt(formData.budget),
      }, (step, detail, metadata) => {
        setStep(step, detail);
        if (metadata?.rawXdr) setRawXdr(metadata.rawXdr);
      });
    } catch (error) {
      setStep("failed", error.message);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields */}
      <button type="submit">Submit Job</button>
      <TransactionStatusModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
    </form>
  );
}
```

### Pattern 2: Multi-Step Wizard

```tsx
function MultiStepWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleFinalSubmit = async () => {
    // Collect data from all steps
    const wizardData = collectWizardData();
    
    setIsModalOpen(true);
    // ... transaction logic
  };

  return (
    <div>
      {currentStep === 1 && <Step1 />}
      {currentStep === 2 && <Step2 />}
      {currentStep === 3 && <Step3 onSubmit={handleFinalSubmit} />}
      
      <TransactionStatusModal 
        isOpen={isModalOpen} 
        onClose={() => {
          setIsModalOpen(false);
          setCurrentStep(1); // Reset wizard
        }} 
      />
    </div>
  );
}
```

### Pattern 3: Batch Transactions

```tsx
function BatchTransactions() {
  const [queue, setQueue] = useState<Transaction[]>([]);
  const [currentTx, setCurrentTx] = useState<number>(0);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const processBatch = async () => {
    setIsModalOpen(true);

    for (let i = 0; i < queue.length; i++) {
      setCurrentTx(i);
      reset();
      
      try {
        await processTransaction(queue[i]);
      } catch (error) {
        setStep("failed", `Transaction ${i + 1} failed: ${error.message}`);
        break;
      }
    }
  };

  return (
    <div>
      <p>Processing {currentTx + 1} of {queue.length}</p>
      <TransactionStatusModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
    </div>
  );
}
```

## Testing

### Unit Tests

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TransactionStatusModal } from "./transaction-status-modal";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";

test("displays success state", () => {
  useTxStatusStore.setState({
    step: "confirmed",
    txHash: "abc123",
    startedAt: Date.now() - 5000,
    finishedAt: Date.now(),
  });

  render(<TransactionStatusModal isOpen={true} onClose={() => {}} />);
  
  expect(screen.getByText("Transaction Confirmed")).toBeInTheDocument();
  expect(screen.getByText("abc123")).toBeInTheDocument();
});
```

### Integration Tests

```tsx
test("full transaction flow", async () => {
  const { setStep, setTxHash } = useTxStatusStore.getState();
  
  render(<TransactionStatusModal isOpen={true} onClose={() => {}} />);

  // Simulate lifecycle
  act(() => setStep("building"));
  expect(screen.getByText(/Building transaction/)).toBeInTheDocument();

  act(() => setStep("simulating"));
  expect(screen.getByText(/Simulating/)).toBeInTheDocument();

  act(() => setStep("confirmed"));
  act(() => setTxHash("test-hash"));
  
  await waitFor(() => {
    expect(screen.getByText("Transaction Confirmed")).toBeInTheDocument();
  });
});
```

## Performance Optimization

### 1. Memoization

```tsx
import { memo } from "react";

export const TransactionStatusModal = memo(({ isOpen, onClose }) => {
  // Component logic
}, (prevProps, nextProps) => {
  return prevProps.isOpen === nextProps.isOpen;
});
```

### 2. Lazy Loading

```tsx
import { lazy, Suspense } from "react";

const TransactionStatusModal = lazy(() => 
  import("@/components/transaction/transaction-status-modal")
);

function MyComponent() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TransactionStatusModal isOpen={isOpen} onClose={onClose} />
    </Suspense>
  );
}
```

### 3. Debounced Updates

```tsx
import { useDebouncedCallback } from "use-debounce";

const debouncedSetStep = useDebouncedCallback((step, detail) => {
  setStep(step, detail);
}, 100);
```

## Troubleshooting

### Issue: Modal doesn't appear

**Solution**: Check that `isOpen={true}` and `step !== "idle"`

```tsx
// Debug
console.log("Modal open:", isOpen);
console.log("Current step:", useTxStatusStore.getState().step);
```

### Issue: Polling never completes

**Solution**: Increase timeout or check RPC connectivity

```tsx
// In job-registry.ts
const POLL_MAX_RETRIES = 60; // Increase from 30
```

### Issue: Copy button doesn't work

**Solution**: Requires HTTPS in production

```tsx
// Fallback for HTTP
const copyToClipboard = async (text: string) => {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  } else {
    // Fallback for older browsers
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
};
```

### Issue: Animations are choppy

**Solution**: Reduce animation complexity or use CSS transforms

```css
/* Use transform instead of width for better performance */
.progress-bar {
  transform: scaleX(0.5);
  transform-origin: left;
  transition: transform 0.5s ease;
}
```

## Best Practices

1. **Always reset state** before starting a new transaction
2. **Handle all error cases** with user-friendly messages
3. **Provide context** in error messages (what failed, why, what to do)
4. **Test on testnet** before deploying to mainnet
5. **Log transactions** for debugging and support
6. **Use exponential backoff** for polling to reduce RPC load
7. **Validate inputs** before opening the modal
8. **Disable close button** during active transactions
9. **Show elapsed time** to set user expectations
10. **Link to block explorer** for transparency

## Resources

- [Stellar SDK Documentation](https://stellar.github.io/js-stellar-sdk/)
- [Soroban Documentation](https://soroban.stellar.org/docs)
- [Stellar Expert](https://stellar.expert/)
- [Component Tests](./\_\_tests\_\_/transaction-status-modal.test.tsx)
- [Example Integrations](./example-integration.tsx)
